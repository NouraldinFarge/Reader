import assert from 'node:assert/strict';
import test from 'node:test';
import {
  coverForTitle,
  detectFormat,
  escapeHtml,
  formatBytes,
  formatTime,
  progressPercent,
  safeFilename,
  searchSnippet,
  titleFromFilename,
} from '../app/src/core.js';

test('detectFormat recognizes the supported publication families', () => {
  assert.equal(detectFormat('novel.epub'), 'epub');
  assert.equal(detectFormat('paper.PDF'), 'pdf');
  assert.equal(detectFormat('notes.md'), 'markdown');
  assert.equal(detectFormat('lesson.aax'), 'aax');
  assert.equal(detectFormat('recording.bin', 'audio/mpeg'), 'audio');
  assert.equal(detectFormat('installer.exe'), 'unsupported');
});

test('display helpers produce compact, stable values', () => {
  assert.equal(formatBytes(1536), '1.5 KB');
  assert.equal(formatTime(65), '1:05');
  assert.equal(formatTime(3661), '1:01:01');
  assert.equal(titleFromFilename('how_to-read-well.epub'), 'How To Read Well');
  assert.equal(safeFilename('  A/B: Reader?  '), 'A-B-Reader');
});

test('progressPercent handles text, PDF, and audio without overflow', () => {
  assert.equal(
    progressPercent({
      format: 'epub',
      sections: [{}, {}],
      progress: { sectionIndex: 1, sectionFraction: 0.5 },
    }),
    75,
  );
  assert.equal(progressPercent({ format: 'pdf', progress: { page: 4, pageCount: 10 } }), 40);
  assert.equal(progressPercent({ format: 'audio', duration: 100, progress: { audioTime: 120 } }), 100);
});

test('user strings are escaped and snippets stay bounded', () => {
  assert.equal(escapeHtml('<script>"x"</script>'), '&lt;script&gt;&quot;x&quot;&lt;/script&gt;');
  const snippet = searchSnippet('One two three four five six seven eight nine', 'five', 8);
  assert.match(snippet, /five/i);
  assert.ok(snippet.length < 40);
});

test('generated cover palette is deterministic', () => {
  assert.deepEqual(coverForTitle('The Quiet Library'), coverForTitle('The Quiet Library'));
  assert.match(coverForTitle('The Quiet Library'), /^linear-gradient\(/);
});
