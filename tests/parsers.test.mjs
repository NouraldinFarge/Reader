import assert from 'node:assert/strict';
import test from 'node:test';
import { parsePublicationFile } from '../app/src/parsers.js';

function fixtureFile(name, type, content) {
  const blob = content instanceof Blob ? content : new Blob([content], { type });
  return {
    name,
    type,
    size: blob.size,
    lastModified: 1_700_000_000_000,
    arrayBuffer: () => blob.arrayBuffer(),
    slice: (...arguments_) => blob.slice(...arguments_),
  };
}

function writeAscii(bytes, offset, value) {
  [...value].forEach((character, index) => {
    bytes[offset + index] = character.charCodeAt(0);
  });
}

function syntheticAaxHeader({ atomSize = 24, byteLength = 24 } = {}) {
  const bytes = new Uint8Array(byteLength);
  new DataView(bytes.buffer).setUint32(0, atomSize);
  writeAscii(bytes, 4, 'ftyp');
  writeAscii(bytes, 8, 'aax ');
  writeAscii(bytes, 16, 'aax ');
  return bytes;
}

test('protected AAX handling stores bounded metadata but never returns a payload blob', async () => {
  const file = fixtureFile('Synthetic Protected Sample.aax', 'audio/aax', syntheticAaxHeader());
  const { book, blobRecord } = await parsePublicationFile(file);

  assert.equal(book.format, 'aax');
  assert.equal(book.access, 'restricted');
  assert.equal(book.accessReason, 'protected-aax');
  assert.equal(book.sections.length, 0);
  assert.equal(blobRecord, null);
  assert.doesNotMatch(JSON.stringify(book), /activation|password|account/i);
});

test('AAX atom bounds reject malformed outer headers and safely ignore truncated metadata atoms', async () => {
  const malformed = fixtureFile('Malformed.aax', 'audio/aax', syntheticAaxHeader({ atomSize: 4_096 }));
  await assert.rejects(parsePublicationFile(malformed), /recognizable protected-audio header/);

  const withTruncatedMetadata = syntheticAaxHeader({ byteLength: 40 });
  new DataView(withTruncatedMetadata.buffer).setUint32(24, 65_535);
  withTruncatedMetadata.set([0xa9, 0x6e, 0x61, 0x6d], 28);
  const safeFallback = await parsePublicationFile(
    fixtureFile('Bounded Fallback.aax', 'audio/aax', withTruncatedMetadata),
  );
  assert.equal(safeFallback.book.title, 'Bounded Fallback');
  assert.equal(safeFallback.blobRecord, null);
});

test('PDF imports require a matching MIME family, header, and final trailer', async () => {
  const complete = new TextEncoder().encode('%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\n%%EOF\n');
  const imported = await parsePublicationFile(fixtureFile('Synthetic.pdf', 'application/pdf', complete));
  assert.equal(imported.book.format, 'pdf');
  assert.ok(imported.blobRecord?.blob);

  await assert.rejects(
    parsePublicationFile(fixtureFile('Mismatched.pdf', 'text/html', complete)),
    /does not agree/,
  );
  await assert.rejects(
    parsePublicationFile(fixtureFile('Truncated.pdf', 'application/pdf', '%PDF-1.7\nno trailer')),
    /complete, recognizable PDF/,
  );
});

test('unprotected audio must have a recognizable extension-specific header', async () => {
  const mp3Header = new Uint8Array(32);
  writeAscii(mp3Header, 0, 'ID3');
  const imported = await parsePublicationFile(fixtureFile('Synthetic.mp3', 'audio/mpeg', mp3Header));
  assert.equal(imported.book.format, 'audio');
  assert.ok(imported.blobRecord?.blob);

  await assert.rejects(
    parsePublicationFile(fixtureFile('Corrupt.mp3', 'audio/mpeg', new Uint8Array(32))),
    /recognizable unprotected-audio header/,
  );
  await assert.rejects(
    parsePublicationFile(fixtureFile('Disguised.mp3', 'application/pdf', mp3Header)),
    /does not agree/,
  );
});

test('an already-cancelled import exits before parsing or persistence output', async () => {
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    parsePublicationFile(fixtureFile('Cancelled.txt', 'text/plain', 'cancel me'), undefined, {
      signal: controller.signal,
    }),
    { name: 'AbortError' },
  );
});
