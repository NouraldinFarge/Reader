import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { chromium } from 'playwright';

const repositoryRoot = resolve(import.meta.dirname, '..');
const sourceUrl = pathToFileURL(
  resolve(repositoryRoot, 'docs', 'media', 'social', 'preview-source.html'),
).href;
const targets = [
  {
    name: 'GitHub social preview',
    path: resolve(repositoryRoot, 'docs', 'media', 'social', 'github-social-preview.png'),
    width: 1280,
    height: 720,
  },
  {
    name: 'portfolio Open Graph preview',
    path: resolve(repositoryRoot, 'docs', 'media', 'social', 'portfolio-og-preview.png'),
    width: 1200,
    height: 630,
  },
];

const browser = await chromium.launch();
try {
  for (const target of targets) {
    const page = await browser.newPage({
      deviceScaleFactor: 1,
      viewport: { width: target.width, height: target.height },
    });
    await page.goto(sourceUrl, { waitUntil: 'load' });
    await page.screenshot({ path: target.path, type: 'png' });
    await page.close();
    console.log(`Rendered ${target.name} at ${target.width}×${target.height}.`);
  }
} finally {
  await browser.close();
}
