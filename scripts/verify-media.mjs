import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const repositoryRoot = resolve(import.meta.dirname, '..');

function jpegDimensions(image, relativePath) {
  const startOfFrameMarkers = new Set([
    0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf,
  ]);
  let offset = 2;
  while (offset + 8 < image.length) {
    if (image[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    while (image[offset] === 0xff) offset += 1;
    const marker = image[offset];
    offset += 1;
    if (marker === 0xd8 || marker === 0xd9) continue;
    if (marker === 0xda) break;
    const segmentLength = image.readUInt16BE(offset);
    if (startOfFrameMarkers.has(marker)) {
      return {
        format: 'jpeg',
        width: image.readUInt16BE(offset + 5),
        height: image.readUInt16BE(offset + 3),
      };
    }
    offset += segmentLength;
  }
  assert.fail(`${relativePath} has no JPEG start-of-frame marker`);
}

async function imageDimensions(relativePath) {
  const image = await readFile(resolve(repositoryRoot, relativePath));
  const pngSignature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  if (image.subarray(0, 8).equals(pngSignature)) {
    assert.equal(image.subarray(12, 16).toString('ascii'), 'IHDR', `${relativePath} has no IHDR`);
    return {
      format: 'png',
      width: image.readUInt32BE(16),
      height: image.readUInt32BE(20),
    };
  }
  if (image[0] === 0xff && image[1] === 0xd8) return jpegDimensions(image, relativePath);
  assert.fail(`${relativePath} is not a supported PNG or JPEG image`);
}

const expectedDimensions = new Map([
  ['docs/media/screenshots/library-overview.jpg', { format: 'jpeg', width: 1440, height: 900 }],
  ['docs/media/screenshots/focused-reading.jpg', { format: 'jpeg', width: 1440, height: 900 }],
  ['docs/media/screenshots/notes-and-search.jpg', { format: 'jpeg', width: 1440, height: 900 }],
  ['docs/media/screenshots/appearance-controls.jpg', { format: 'jpeg', width: 1440, height: 900 }],
  ['docs/media/screenshots/pdf-view.jpg', { format: 'jpeg', width: 1280, height: 720 }],
  ['docs/media/screenshots/protected-content-boundary.jpg', { format: 'jpeg', width: 1280, height: 720 }],
  ['docs/media/demo/reader-alpha4-demo-thumbnail.jpg', { format: 'jpeg', width: 1280, height: 720 }],
  ['docs/media/social/github-social-preview.png', { format: 'png', width: 1280, height: 720 }],
  ['docs/media/social/portfolio-og-preview.png', { format: 'png', width: 1200, height: 630 }],
]);

for (const [relativePath, expected] of expectedDimensions) {
  assert.deepEqual(
    await imageDimensions(relativePath),
    expected,
    `${relativePath} format or dimensions drifted`,
  );
}

const source = await readFile(
  resolve(repositoryRoot, 'docs', 'media', 'social', 'preview-source.html'),
  'utf8',
);
assert.match(source, /Public-source alpha · 0\.1\.0-alpha\.4/);
assert.doesNotMatch(source, /Private alpha/i);

console.log(`Verified ${expectedDimensions.size} media dimensions and public-source preview wording.`);
