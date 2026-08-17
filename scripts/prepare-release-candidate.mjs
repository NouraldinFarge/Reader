import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { constants, copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { basename, dirname, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { inspectAuthenticode } from './authenticode.mjs';
import { assertWindowsGuiPe } from './windows-pe.mjs';

const root = resolve(import.meta.dirname, '..');
const args = process.argv.slice(2);
const options = new Map();
for (let index = 0; index < args.length; index += 2) {
  const key = args[index];
  const value = args[index + 1];
  if (!key?.startsWith('--') || !value) throw new Error(`Unknown or incomplete argument: ${key}`);
  options.set(key.slice(2), resolve(value));
}
for (const required of ['directory', 'source-archive', 'installer', 'executable']) {
  if (!options.has(required)) throw new Error(`--${required} is required`);
}

const packageJson = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'));
const facts = JSON.parse(await readFile(resolve(root, 'docs', 'PROJECT_FACTS.json'), 'utf8'));
const directory = options.get('directory');

function run(command, commandArgs) {
  const executable = process.platform === 'win32' && command.endsWith('.cmd') ? process.env.ComSpec : command;
  const executableArgs =
    executable === process.env.ComSpec
      ? ['/d', '/s', '/c', [command, ...commandArgs].join(' ')]
      : commandArgs;
  const result = spawnSync(executable, executableArgs, {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 8 * 1024 * 1024,
  });
  if (result.status !== 0) {
    throw new Error(`${command} failed:\n${result.error?.message ?? result.stderr ?? result.stdout}`);
  }
  return result.stdout.trim();
}

function sha256(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

assert.equal(packageJson.version, facts.product.developmentVersion);
assert.equal(packageJson.license, 'MIT');
assert.equal(run('git', ['status', '--porcelain=v1']), '', 'Git worktree must be clean');
const sourceCommit = run('git', ['rev-parse', 'HEAD']);

await mkdir(dirname(directory), { recursive: true });
await mkdir(directory);

const inputs = [
  {
    kind: 'source-archive',
    source: options.get('source-archive'),
    filename: basename(options.get('source-archive')),
  },
  {
    kind: 'windows-nsis-installer',
    source: options.get('installer'),
    filename: basename(options.get('installer')),
  },
  {
    kind: 'windows-executable',
    source: options.get('executable'),
    filename: `Reader_${packageJson.version}_x64.exe`,
  },
  {
    kind: 'spdx-sbom',
    source: resolve(root, facts.release.sbom),
    filename: basename(facts.release.sbom),
  },
  {
    kind: 'third-party-notices',
    source: resolve(root, 'THIRD_PARTY_NOTICES.md'),
    filename: 'THIRD_PARTY_NOTICES.md',
  },
  {
    kind: 'release-notes',
    source: resolve(root, 'docs', 'RELEASE_NOTES.md'),
    filename: 'RELEASE_NOTES.md',
  },
];

const artifacts = [];
for (const input of inputs) {
  const output = resolve(directory, input.filename);
  await copyFile(input.source, output, constants.COPYFILE_EXCL);
  const buffer = await readFile(output);
  artifacts.push({
    kind: input.kind,
    filename: input.filename,
    bytes: buffer.byteLength,
    sha256: sha256(buffer),
  });
}

const executablePath = resolve(directory, `Reader_${packageJson.version}_x64.exe`);
const installerPath = resolve(directory, basename(options.get('installer')));
const pe = assertWindowsGuiPe(await readFile(executablePath));
const installerSignature = inspectAuthenticode(installerPath);
const executableSignature = inspectAuthenticode(executablePath);
const createdAt = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
const manifest = {
  schemaVersion: 1,
  product: 'Reader',
  version: packageJson.version,
  createdAt,
  sourceCommit,
  repositoryUrl: facts.product.repositoryUrl,
  publicationStatus: facts.product.publicStatus,
  publicationDecision: facts.product.publicationDecision,
  projectLicense: packageJson.license,
  buildEnvironment: {
    os: `${process.platform}-${process.arch}`,
    node: process.version,
    pnpm: run(process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm', ['--version']),
    rustc: run('rustc', ['--version']),
    cargo: run('cargo', ['--version']),
  },
  windowsBinary: {
    filename: basename(executablePath),
    ...pe,
  },
  authenticode: installerSignature,
  signatures: {
    installer: installerSignature,
    executable: executableSignature,
  },
  releaseGates: {
    localPackagedSmoke: facts.verification.packagedApplicationMatrix,
    cleanWindowsMatrix: facts.verification.cleanWindowsMatrix,
    stableBinaryDistribution: 'blocked',
  },
  artifacts,
};

const checksums = `${artifacts
  .slice()
  .sort((left, right) => left.filename.localeCompare(right.filename))
  .map((artifact) => `${artifact.sha256}  ${artifact.filename}`)
  .join('\n')}\n`;
const signatureStatus = [
  `Reader ${packageJson.version} Authenticode status`,
  `Installer: ${installerSignature.status}`,
  `Executable: ${executableSignature.status}`,
  'No signing certificate or signing authorization was provided for this candidate.',
  '',
].join('\n');
const report = `# Reader ${packageJson.version} private release-candidate report

Generated: ${createdAt}  
Source commit: \`${sourceCommit}\`  
Publication decision: **NOT READY for public release**

## Passed local evidence

- ${facts.verification.nodeTestsPassed}/${facts.verification.nodeTests} Node tests.
- ${facts.verification.browserScenarioGroupsPassed}/${facts.verification.browserScenarioGroups} Chromium scenario groups.
- ${facts.verification.axeScans} axe scans with ${facts.verification.axeSeriousOrCriticalFindings} serious/critical findings.
- Release executable PE subsystem: ${pe.subsystem} (${pe.subsystemName}); normal direct launch does not create a terminal.
- Local two-launch smoke: one Reader process and one Reader window.
- Local NSIS current-user installer build completed.
- Project license: ${packageJson.license}.

## Blocking evidence

- Installer Authenticode: ${installerSignature.status}.
- Executable Authenticode: ${executableSignature.status}.
- Clean Windows 10/11 install, offline launch, upgrade, uninstall, and residual-data matrix: not run.
- Manual screen-reader, Windows high-contrast, 400% zoom, and packaged audio/PDF checks: incomplete.

This directory is a private staging candidate, not an approved public release or download channel.
`;

await writeFile(resolve(directory, 'CHECKSUMS.sha256'), checksums, { flag: 'wx' });
await writeFile(resolve(directory, 'AUTHENTICODE-STATUS.txt'), signatureStatus, { flag: 'wx' });
await writeFile(resolve(directory, 'test-and-release-report.md'), report, { flag: 'wx' });
await writeFile(resolve(directory, 'build-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, {
  flag: 'wx',
});

console.log(
  `Private release candidate prepared: ${artifacts.length} immutable artifacts; source commit ${sourceCommit}; installer ${installerSignature.status}; executable subsystem ${pe.subsystem}.`,
);
