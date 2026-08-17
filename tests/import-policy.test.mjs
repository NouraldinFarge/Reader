import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ImportPolicyError,
  boundedText,
  classifyPublicationHref,
  createExtractionBudget,
  decodePublicationText,
  detectRasterImageMime,
  fingerprintPublicationFile,
  normalizeArchiveEntryName,
  readZipEntryBytes,
  readZipEntryText,
  resolvePublicationPath,
} from '../app/src/import-policy.js';

test('archive entry policy rejects traversal, absolute, UNC, drive, encoded, mixed, and null paths', () => {
  const unsafe = [
    '../outside.xhtml',
    '..\\outside.xhtml',
    '/absolute.xhtml',
    '\\\\server\\share.xhtml',
    'C:\\book\\chapter.xhtml',
    '%2e%2e/outside.xhtml',
    '%252e%252e%252foutside.xhtml',
    'safe\\..\\outside.xhtml',
    'safe/../../outside.xhtml',
    `safe/${String.fromCharCode(0)}name.xhtml`,
  ];
  unsafe.forEach((value) => assert.throws(() => normalizeArchiveEntryName(value), ImportPolicyError));
  assert.equal(normalizeArchiveEntryName('OPS\\chapters/./one.xhtml'), 'OPS/chapters/one.xhtml');
  assert.throws(() => normalizeArchiveEntryName('%E0%A4%A'), /malformed encoded path/);
  assert.throws(() => normalizeArchiveEntryName('.'), /empty or control-character path/);
});

test('deterministic path-policy fuzz never permits a generated root escape', () => {
  let state = 0x51f15e;
  const random = () => {
    state = (state * 1_664_525 + 1_013_904_223) >>> 0;
    return state;
  };
  const dangerous = ['..', '%2e%2e', '%252e%252e', 'C:', '', '.', '\\server', '/root'];
  for (let index = 0; index < 500; index += 1) {
    const separator = random() % 2 ? '/' : '\\';
    const token = dangerous[random() % dangerous.length];
    const candidate = ['OPS', token, `chapter-${random() % 20}.xhtml`].join(separator);
    try {
      const normalized = normalizeArchiveEntryName(candidate);
      assert.doesNotMatch(normalized, /(^|\/)\.\.($|\/)|^[a-z]:|^\//i);
    } catch (error) {
      assert.ok(error instanceof ImportPolicyError);
    }
  }
});

test('relative publication paths can normalize within but never escape the package root', () => {
  assert.equal(
    resolvePublicationPath('OPS/text/chapter.xhtml', '../images/cover.png?x=1#top'),
    'OPS/images/cover.png',
  );
  assert.equal(resolvePublicationPath('chapter.xhtml', '../outside.xhtml'), null);
  assert.equal(resolvePublicationPath('OPS/chapter.xhtml', 'file:///secret.txt'), null);
  assert.equal(resolvePublicationPath('OPS/chapter.xhtml', '//example.test/track'), null);
  assert.equal(resolvePublicationPath('OPS/chapter.xhtml', '#anchor'), 'OPS/chapter.xhtml');
  assert.equal(resolvePublicationPath('OPS/chapter.xhtml', 'bad%ZZ.xhtml'), null);
  assert.equal(resolvePublicationPath('../bad.xhtml', 'chapter.xhtml'), null);
  assert.equal(resolvePublicationPath('chapter.xhtml', ''), 'chapter.xhtml');
});

test('publication links preserve safe internal intent and reject unusual schemes or controls', () => {
  assert.deepEqual(classifyPublicationHref('#section-one', 'OPS/chapter.xhtml'), {
    kind: 'anchor',
    target: 'section-one',
  });
  assert.deepEqual(classifyPublicationHref('../chapter2.xhtml#part', 'OPS/text/chapter.xhtml'), {
    kind: 'internal',
    path: 'OPS/chapter2.xhtml',
  });
  assert.equal(classifyPublicationHref('https://example.test/read', '').kind, 'external');
  assert.equal(classifyPublicationHref('#1-invalid', '').kind, 'unsafe');
  assert.equal(classifyPublicationHref('https://[invalid', '').kind, 'unsafe');
  for (const value of [
    'javascript:alert(1)',
    'file:///secret',
    'data:text/html,x',
    'blob:https://example.test/x',
    '//example.test/x',
    'java\nscript:alert(1)',
  ]) {
    assert.equal(classifyPublicationHref(value, 'OPS/chapter.xhtml').kind, 'unsafe');
  }
});

test('actual streamed ZIP bytes enforce per-entry and total budgets without trusting metadata', async () => {
  function fakeEntry(chunks, declaredSize) {
    return {
      _data: declaredSize === undefined ? {} : { uncompressedSize: declaredSize },
      internalStream() {
        const listeners = {};
        return {
          on(name, callback) {
            listeners[name] = callback;
            return this;
          },
          pause() {},
          resume() {
            queueMicrotask(() => {
              try {
                for (const chunk of chunks) listeners.data.call(this, chunk);
                listeners.end();
              } catch (error) {
                listeners.error(error);
              }
            });
            return this;
          },
        };
      },
    };
  }

  const budget = createExtractionBudget(8, 'fixture');
  const bytes = await readZipEntryBytes(fakeEntry([new Uint8Array([1, 2]), new Uint8Array([3])]), {
    budget,
    maximumBytes: 4,
  });
  assert.deepEqual([...bytes], [1, 2, 3]);
  assert.equal(budget.usedBytes, 3);

  await assert.rejects(
    readZipEntryBytes(fakeEntry([new Uint8Array(3), new Uint8Array(3)], 0), {
      budget: createExtractionBudget(20),
      maximumBytes: 5,
    }),
    /extracted-byte limit/,
  );
  assert.deepEqual(
    [
      ...(await readZipEntryBytes(fakeEntry([], 99), {
        budget: createExtractionBudget(100),
        maximumBytes: 5,
      })),
    ],
    [],
  );
  await assert.rejects(
    readZipEntryBytes(fakeEntry([new Uint8Array(6)], 1), {
      budget: createExtractionBudget(20),
      maximumBytes: 5,
    }),
    /extracted-byte limit/,
  );
});

test('streamed ZIP reads stop promptly when an import is cancelled', async () => {
  let paused = false;
  const entry = {
    internalStream() {
      const listeners = {};
      return {
        on(name, callback) {
          listeners[name] = callback;
          return this;
        },
        pause() {
          paused = true;
        },
        resume() {
          return this;
        },
      };
    },
  };
  const controller = new AbortController();
  const read = readZipEntryBytes(entry, { signal: controller.signal });
  controller.abort();
  await assert.rejects(read, { name: 'AbortError' });
  assert.equal(paused, true);
});

test('streamed ZIP reads reject unavailable and failed streams and decode bounded text', async () => {
  assert.throws(() => readZipEntryBytes(null), /unavailable/);
  const controller = new AbortController();
  controller.abort();
  assert.throws(() => readZipEntryBytes({ internalStream() {} }, { signal: controller.signal }), {
    name: 'AbortError',
  });

  const error = new Error('synthetic stream error');
  const failingEntry = {
    internalStream() {
      const listeners = {};
      return {
        on(name, callback) {
          listeners[name] = callback;
          return this;
        },
        resume() {
          queueMicrotask(() => listeners.error(error));
          return this;
        },
      };
    },
  };
  await assert.rejects(readZipEntryBytes(failingEntry), error);

  const textEntry = {
    internalStream() {
      const listeners = {};
      return {
        on(name, callback) {
          listeners[name] = callback;
          return this;
        },
        resume() {
          queueMicrotask(() => {
            listeners.data.call(this, [0x4f, 0x4b]);
            listeners.end();
          });
          return this;
        },
      };
    },
  };
  assert.equal(await readZipEntryText(textEntry, { label: 'fixture text' }), 'OK');
});

test('extraction budgets reject invalid and excessive accounting', () => {
  const budget = createExtractionBudget(5, 'fixture');
  assert.equal(budget.maximumBytes, 5);
  assert.equal(budget.consume(2), 2);
  assert.throws(() => budget.consume(Number.NaN), /invalid extracted size/);
  assert.throws(() => budget.consume(-1), /invalid extracted size/);
  assert.throws(() => budget.consume(4), /expands beyond/);
  assert.equal(budget.usedBytes, 2);
});

test('text decoding rejects invalid Unicode and accepts UTF-8/UTF-16 byte order marks', () => {
  assert.equal(decodePublicationText(new TextEncoder().encode('Quiet text')), 'Quiet text');
  assert.equal(decodePublicationText(new Uint8Array([0xff, 0xfe, 0x48, 0x00, 0x69, 0x00])), 'Hi');
  assert.equal(decodePublicationText(new Uint8Array([0xfe, 0xff, 0x00, 0x48, 0x00, 0x69])), 'Hi');
  assert.equal(decodePublicationText(new Uint8Array([0xef, 0xbb, 0xbf, 0x48, 0x69])), 'Hi');
  assert.throws(() => decodePublicationText(new Uint8Array([0xc3, 0x28])), /valid Unicode/);
});

test('raster image detection uses byte signatures rather than filename claims', () => {
  assert.equal(
    detectRasterImageMime(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0])),
    'image/png',
  );
  assert.equal(
    detectRasterImageMime(new Uint8Array([0xff, 0xd8, 0xff, 0, 0, 0, 0, 0, 0, 0, 0, 0])),
    'image/jpeg',
  );
  assert.equal(detectRasterImageMime(new TextEncoder().encode('GIF89a......')), 'image/gif');
  assert.equal(detectRasterImageMime(new TextEncoder().encode('RIFF....WEBP')), 'image/webp');
  assert.equal(detectRasterImageMime(new TextEncoder().encode('....ftypavif')), 'image/avif');
  assert.equal(detectRasterImageMime('not bytes'), null);
  assert.equal(detectRasterImageMime(new TextEncoder().encode('<svg><script>')), null);
});

test('large-file fingerprints process all content and cannot collide on file metadata alone', async () => {
  function publication(name, content) {
    const blob = new Blob([content]);
    return {
      name,
      size: blob.size,
      lastModified: 123,
      arrayBuffer: () => blob.arrayBuffer(),
      slice: (...args) => blob.slice(...args),
    };
  }
  const first = publication('same.pdf', 'AAAA-BBBB-CCCC');
  const second = publication('same.pdf', 'AAAA-BBBX-CCCC');
  const options = { directHashLimit: 2, chunkBytes: 4 };
  const firstFingerprint = await fingerprintPublicationFile(first, options);
  const secondFingerprint = await fingerprintPublicationFile(second, options);
  assert.match(firstFingerprint, /^chunked-sha256-v1:/);
  assert.notEqual(firstFingerprint, secondFingerprint);
  assert.equal(firstFingerprint, await fingerprintPublicationFile(first, options));
  assert.match(await fingerprintPublicationFile(first), /^[a-f0-9]{64}$/);
  await assert.rejects(fingerprintPublicationFile({ size: -1 }), /invalid file size/);
});

test('metadata normalization is bounded and stable', () => {
  assert.equal(boundedText('  A   calm title  ', 20), 'A calm title');
  assert.equal(boundedText('x'.repeat(40), 12).length, 12);
  assert.equal(boundedText('', 10, 'Fallback'), 'Fallback');
});
