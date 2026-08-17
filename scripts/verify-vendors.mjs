import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const manifest = JSON.parse(await readFile(resolve(root, 'THIRD_PARTY_COMPONENTS.json'), 'utf8'));
const failures = [];

async function sha256(path) {
  return createHash('sha256')
    .update(await readFile(path))
    .digest('hex');
}

for (const component of manifest.components) {
  for (const file of component.vendoredFiles ?? []) {
    const actual = await sha256(resolve(root, file.path));
    if (actual !== file.sha256) failures.push(`${file.path}: expected ${file.sha256}, received ${actual}`);
  }
  if (component.licenseFile) {
    const actual = await sha256(resolve(root, component.licenseFile.path));
    if (actual !== component.licenseFile.sha256) {
      failures.push(
        `${component.licenseFile.path}: expected ${component.licenseFile.sha256}, received ${actual}`,
      );
    }
  }
}

const jszip = manifest.components.find((component) => component.package === 'jszip');
const marked = manifest.components.find((component) => component.package === 'marked');
const pdfjs = manifest.components.find((component) => component.package === 'pdfjs-dist');
const jszipSource = await readFile(resolve(root, jszip.vendoredFiles[0].path), 'utf8');
const markedSource = await readFile(resolve(root, marked.vendoredFiles[0].path), 'utf8');
const pdfSources = await Promise.all(
  pdfjs.vendoredFiles.map((file) => readFile(resolve(root, file.path), 'utf8')),
);

assert.match(jszipSource, new RegExp(`JSZip v${jszip.version.replaceAll('.', '\\.')}`));
assert.match(markedSource, new RegExp(`marked v${marked.version.replaceAll('.', '\\.')}`));
for (const source of pdfSources) {
  assert.match(source, new RegExp(`pdfjsVersion = ${pdfjs.version.replaceAll('.', '\\.')}`));
  assert.match(source, new RegExp(`pdfjsBuild = ${pdfjs.build}`));
}

if (failures.length) {
  console.error(`Vendor verification failed:\n${failures.map((failure) => `- ${failure}`).join('\n')}`);
  process.exitCode = 1;
} else {
  console.log(
    `Vendor verification passed for ${manifest.components.filter((component) => component.vendoredFiles).length} runtime components and ${manifest.components.flatMap((component) => component.vendoredFiles ?? []).length} files.`,
  );
}
