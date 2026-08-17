import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const html = await readFile(new URL('../app/index.html', import.meta.url), 'utf8');
const app = await readFile(new URL('../app/src/app.js', import.meta.url), 'utf8');

test('static HTML ids are unique', () => {
  const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]);
  const duplicates = ids.filter((id, index) => ids.indexOf(id) !== index);
  assert.deepEqual([...new Set(duplicates)], []);
});

test('every static id queried by the application exists in the shell', () => {
  const queried = [...app.matchAll(/querySelector\(['"]#([A-Za-z0-9_-]+)['"]\)/g)].map((match) => match[1]);
  const ids = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]));
  const missing = [...new Set(queried)].filter((id) => !ids.has(id));
  assert.deepEqual(missing, []);
});

test('the shell pins local scripts and a deny-by-default CSP', () => {
  assert.match(html, /connect-src 'none'/);
  assert.match(html, /object-src 'none'/);
  assert.doesNotMatch(html, /<script[^>]+src="https?:/i);
  assert.doesNotMatch(html, /<link[^>]+href="https?:/i);
});
