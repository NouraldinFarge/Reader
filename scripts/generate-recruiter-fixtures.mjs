import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const require = createRequire(import.meta.url);
const {
  createEpub3,
  createSyntheticAaxHeader,
  createSyntheticPdf,
} = require('../tests/fixtures/synthetic-fixtures.cjs');
const output = resolve(import.meta.dirname, '..', 'test-results', 'recruiter-fixtures');
await mkdir(output, { recursive: true });

const fixtures = [
  [
    'Synthetic Reader Verification.pdf',
    createSyntheticPdf({ pages: 3, withJavaScriptAction: true, label: 'Reader verification document' }),
  ],
  ['Harbor Light Field Notes.epub', await createEpub3()],
  ['Protected Content Boundary.aax', createSyntheticAaxHeader()],
];
for (const [name, bytes] of fixtures) await writeFile(resolve(output, name), bytes);

console.log(`Generated ${fixtures.length} original recruiter fixtures in test-results/recruiter-fixtures.`);
