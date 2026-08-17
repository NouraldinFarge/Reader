import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile, readdir, stat } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import JSZip from 'jszip';

const root = resolve(import.meta.dirname, '..');
const args = process.argv.slice(2);
let directory = null;
for (let index = 0; index < args.length; index += 1) {
  if (args[index] !== '--directory' || !args[index + 1])
    throw new Error(`Unknown or incomplete argument: ${args[index]}`);
  directory = resolve(args[index + 1]);
  index += 1;
}
if (!directory)
  throw new Error('Usage: node scripts/verify-release-artifacts.mjs --directory <candidate-directory>');

const packageJson = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'));
const facts = JSON.parse(await readFile(resolve(root, 'docs', 'PROJECT_FACTS.json'), 'utf8'));
const manifestPath = resolve(directory, 'build-manifest.json');
const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
assert.equal(manifest.version, packageJson.version);
assert.equal(manifest.version, facts.product.developmentVersion);
assert.equal(manifest.publicationStatus, 'private-github-staging-candidate');
assert.equal(manifest.projectLicense, 'MIT');

function sha256(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

function insideCandidate(path) {
  return path === directory || path.startsWith(`${directory}${sep}`);
}

const verified = [];
for (const artifact of manifest.artifacts) {
  assert.match(artifact.filename, /^[^/\\]+$/, `Artifact filename must be a basename: ${artifact.filename}`);
  const path = resolve(directory, artifact.filename);
  assert.ok(insideCandidate(path), `Artifact escapes candidate directory: ${artifact.filename}`);
  const buffer = await readFile(path);
  assert.equal(buffer.byteLength, artifact.bytes, `${artifact.filename} size drifted`);
  assert.equal(sha256(buffer), artifact.sha256, `${artifact.filename} hash drifted`);
  verified.push({ ...artifact, path, buffer });
}

for (const kind of [
  'source-archive',
  'windows-nsis-installer',
  'spdx-sbom',
  'third-party-notices',
  'release-notes',
]) {
  assert.ok(
    verified.some((artifact) => artifact.kind === kind),
    `Missing required artifact kind: ${kind}`,
  );
}

const checksums = await readFile(resolve(directory, 'CHECKSUMS.sha256'), 'utf8');
for (const artifact of verified) {
  assert.ok(
    checksums.split(/\r?\n/).includes(`${artifact.sha256}  ${artifact.filename}`),
    `CHECKSUMS.sha256 is missing ${artifact.filename}`,
  );
}

const source = verified.find((artifact) => artifact.kind === 'source-archive');
assert.deepEqual([...source.buffer.subarray(0, 2)], [0x50, 0x4b], 'Source archive is not a ZIP');
const zip = await JSZip.loadAsync(source.buffer, { checkCRC32: true, createFolders: false });
const archiveEntries = Object.keys(zip.files);
assert.ok(archiveEntries.length > 0, 'Source archive is empty');
assert.ok(archiveEntries.every((entry) => entry === 'reader/' || entry.startsWith('reader/')));
const forbiddenArchiveParts = [
  '/.git/',
  '/node_modules/',
  '/test-results/',
  '/release-artifacts/',
  '/target/',
];
for (const entry of archiveEntries) {
  const normalized = `/${entry.toLocaleLowerCase('en-US').replaceAll('\\', '/')}`;
  assert.ok(
    !forbiddenArchiveParts.some((part) => normalized.includes(part)),
    `Forbidden archive entry: ${entry}`,
  );
  assert.doesNotMatch(
    normalized,
    /\.(?:exe|msi|pdb|dmp|map)$/i,
    `Generated binary entered source archive: ${entry}`,
  );
}

const installer = verified.find((artifact) => artifact.kind === 'windows-nsis-installer');
assert.deepEqual([...installer.buffer.subarray(0, 2)], [0x4d, 0x5a], 'Installer is not a Windows PE file');
if (process.platform === 'win32') {
  const escaped = installer.path.replaceAll("'", "''");
  const result = spawnSync(
    'powershell.exe',
    [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      `(Get-AuthenticodeSignature -LiteralPath '${escaped}' | Select-Object Status,StatusMessage,SignerCertificate | ConvertTo-Json -Compress -Depth 4)`,
    ],
    { encoding: 'utf8' },
  );
  assert.equal(result.status, 0, result.stderr);
  const signature = JSON.parse(result.stdout.trim());
  assert.equal(signature.Status, manifest.authenticode.status);
  if (manifest.authenticode.status === 'NotSigned') assert.equal(signature.SignerCertificate, null);
}

const sbomArtifact = verified.find((artifact) => artifact.kind === 'spdx-sbom');
const sbom = JSON.parse(sbomArtifact.buffer.toString('utf8'));
assert.equal(sbom.spdxVersion, 'SPDX-2.3');
assert.ok(
  sbom.packages.some((item) => item.name === packageJson.name && item.versionInfo === packageJson.version),
);
for (const name of ['JSZip', 'Marked', 'Mozilla PDF.js']) {
  assert.ok(
    sbom.packages.some((item) => item.name === name),
    `SBOM lacks ${name}`,
  );
}

const actualFiles = (await readdir(directory, { withFileTypes: true }))
  .filter((entry) => entry.isFile())
  .map((entry) => entry.name);
for (const required of [
  'build-manifest.json',
  'CHECKSUMS.sha256',
  'AUTHENTICODE-STATUS.txt',
  'test-and-release-report.md',
]) {
  assert.ok(actualFiles.includes(required), `Candidate directory lacks ${required}`);
}
assert.ok((await stat(manifestPath)).size > 0);

console.log(
  `Release verification passed for ${manifest.version}: ${verified.length} checksummed artifacts, ${archiveEntries.length} source entries, signature status ${manifest.authenticode.status}.`,
);
