import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, relative, resolve, sep } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const packageJson = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'));
const vendorManifest = JSON.parse(await readFile(resolve(root, 'THIRD_PARTY_COMPONENTS.json'), 'utf8'));
const pnpmLock = await readFile(resolve(root, 'pnpm-lock.yaml'), 'utf8');
const cargoLock = await readFile(resolve(root, 'src-tauri', 'Cargo.lock'), 'utf8');
const args = process.argv.slice(2);
let output = resolve(root, 'sbom', `reader-v${packageJson.version}.spdx.json`);
for (let index = 0; index < args.length; index += 1) {
  if (args[index] !== '--output' || !args[index + 1])
    throw new Error(`Unknown or incomplete argument: ${args[index]}`);
  output = resolve(args[index + 1]);
  index += 1;
}

function hash(value, algorithm = 'sha256') {
  return createHash(algorithm).update(value).digest('hex');
}

function run(command, commandArgs) {
  const windowsShim = process.platform === 'win32' && command.endsWith('.cmd');
  const executable = windowsShim ? (process.env.ComSpec ?? 'cmd.exe') : command;
  const executableArgs = windowsShim ? ['/d', '/s', '/c', [command, ...commandArgs].join(' ')] : commandArgs;
  const result = spawnSync(executable, executableArgs, {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.status !== 0) {
    throw new Error(`${command} failed:\n${result.error?.message ?? result.stderr ?? result.stdout}`);
  }
  return result.stdout;
}

function spdxId(kind, name, version) {
  const suffix = hash(`${kind}:${name}@${version}`).slice(0, 16);
  return `SPDXRef-${kind}-${name.replace(/[^A-Za-z0-9.-]/g, '-').slice(0, 40)}-${suffix}`;
}

function normalizeLicense(value) {
  const license = String(value ?? '').trim();
  if (!license || /^(?:unknown|unlicensed|see license)/i.test(license)) return 'NOASSERTION';
  return license.replace(/\s*\/\s*/g, ' OR ');
}

function npmPurl(name, version) {
  const encodedName = name.startsWith('@')
    ? `${encodeURIComponent(name.split('/')[0])}/${encodeURIComponent(name.split('/')[1])}`
    : encodeURIComponent(name);
  return `pkg:npm/${encodedName}@${encodeURIComponent(version)}`;
}

function parsePnpmIntegrities(source) {
  const values = new Map();
  let inside = false;
  let current = null;
  for (const line of source.split(/\r?\n/)) {
    if (line === 'packages:') {
      inside = true;
      continue;
    }
    if (inside && /^\S/.test(line)) break;
    if (!inside) continue;
    const packageMatch = line.match(/^ {2}['"]?(.+@[^:'"]+)['"]?:$/);
    if (packageMatch) {
      current = packageMatch[1];
      continue;
    }
    const integrityMatch = line.match(/^ {4}resolution: \{integrity: (sha(?:256|384|512)-[^}]+)\}/);
    if (current && integrityMatch) values.set(current, integrityMatch[1]);
  }
  return values;
}

function checksumFromIntegrity(integrity) {
  if (!integrity) return null;
  const separator = integrity.indexOf('-');
  const algorithm = integrity.slice(0, separator).toUpperCase();
  const value = Buffer.from(integrity.slice(separator + 1), 'base64').toString('hex');
  return { algorithm, checksumValue: value };
}

const packages = [];
const relationships = [];
const rootId = 'SPDXRef-Package-Reader';
const projectLicense = normalizeLicense(packageJson.license);
packages.push({
  SPDXID: rootId,
  name: packageJson.name,
  versionInfo: packageJson.version,
  downloadLocation: 'NOASSERTION',
  filesAnalyzed: false,
  licenseConcluded: projectLicense,
  licenseDeclared: projectLicense,
  copyrightText: `Copyright (c) 2026 ${packageJson.author}`,
  primaryPackagePurpose: 'APPLICATION',
  comment:
    'Reader is licensed under MIT. package.json remains private to prevent accidental npm publication.',
});

const integrities = parsePnpmIntegrities(pnpmLock);
const pnpmCommand = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
const licenseGroups = JSON.parse(run(pnpmCommand, ['licenses', 'list', '--json']));
const npmSeen = new Set();
for (const entries of Object.values(licenseGroups)) {
  for (const entry of entries) {
    for (const version of entry.versions ?? []) {
      const key = `${entry.name}@${version}`;
      if (npmSeen.has(key)) continue;
      npmSeen.add(key);
      const id = spdxId('NPM', entry.name, version);
      const checksum = checksumFromIntegrity(integrities.get(key));
      packages.push({
        SPDXID: id,
        name: entry.name,
        versionInfo: version,
        downloadLocation: 'NOASSERTION',
        filesAnalyzed: false,
        licenseConcluded: normalizeLicense(entry.license),
        licenseDeclared: normalizeLicense(entry.license),
        copyrightText: 'NOASSERTION',
        primaryPackagePurpose: 'OTHER',
        ...(entry.homepage ? { homepage: entry.homepage } : {}),
        ...(checksum ? { checksums: [checksum] } : {}),
        externalRefs: [
          {
            referenceCategory: 'PACKAGE-MANAGER',
            referenceType: 'purl',
            referenceLocator: npmPurl(entry.name, version),
          },
        ],
      });
      relationships.push({ spdxElementId: rootId, relationshipType: 'DEPENDS_ON', relatedSpdxElement: id });
    }
  }
}

const cargoCommand = process.platform === 'win32' ? 'cargo.exe' : 'cargo';
const cargoMetadata = JSON.parse(
  run(cargoCommand, [
    'metadata',
    '--manifest-path',
    'src-tauri/Cargo.toml',
    '--locked',
    '--format-version',
    '1',
  ]),
);
const rootManifest = resolve(root, 'src-tauri', 'Cargo.toml').toLocaleLowerCase('en-US');
for (const component of cargoMetadata.packages) {
  if (resolve(component.manifest_path).toLocaleLowerCase('en-US') === rootManifest) continue;
  const id = spdxId('Cargo', component.name, component.version);
  packages.push({
    SPDXID: id,
    name: component.name,
    versionInfo: component.version,
    downloadLocation: component.source?.startsWith('registry+')
      ? `https://crates.io/crates/${encodeURIComponent(component.name)}/${encodeURIComponent(component.version)}/download`
      : 'NOASSERTION',
    filesAnalyzed: false,
    licenseConcluded: normalizeLicense(component.license),
    licenseDeclared: normalizeLicense(component.license),
    copyrightText: 'NOASSERTION',
    primaryPackagePurpose: 'LIBRARY',
    ...(component.homepage ? { homepage: component.homepage } : {}),
    ...(component.checksum
      ? { checksums: [{ algorithm: 'SHA256', checksumValue: component.checksum }] }
      : {}),
    externalRefs: [
      {
        referenceCategory: 'PACKAGE-MANAGER',
        referenceType: 'purl',
        referenceLocator: `pkg:cargo/${encodeURIComponent(component.name)}@${encodeURIComponent(component.version)}`,
      },
    ],
  });
  relationships.push({ spdxElementId: rootId, relationshipType: 'DEPENDS_ON', relatedSpdxElement: id });
}

for (const component of vendorManifest.components.filter((item) => item.vendoredFiles?.length)) {
  const id = spdxId('Vendor', component.package, component.version);
  packages.push({
    SPDXID: id,
    name: component.name,
    versionInfo: component.version,
    downloadLocation: component.sourceTarball,
    filesAnalyzed: true,
    licenseConcluded: component.licenseExpression,
    licenseDeclared: component.licenseExpression,
    copyrightText: 'See the preserved license file listed in THIRD_PARTY_COMPONENTS.json.',
    primaryPackagePurpose: 'LIBRARY',
    checksums: [{ algorithm: 'SHA256', checksumValue: component.sourceTarballSha256 }],
    comment: `Vendored files: ${component.vendoredFiles
      .map((file) => `${file.path} (SHA-256 ${file.sha256})`)
      .join('; ')}.`,
    externalRefs: [
      {
        referenceCategory: 'PACKAGE-MANAGER',
        referenceType: 'purl',
        referenceLocator: npmPurl(component.package, component.version),
      },
    ],
  });
  relationships.push({ spdxElementId: rootId, relationshipType: 'CONTAINS', relatedSpdxElement: id });
}

packages.sort((left, right) => left.SPDXID.localeCompare(right.SPDXID));
relationships.sort((left, right) => left.relatedSpdxElement.localeCompare(right.relatedSpdxElement));
const namespaceSeed = hash(
  `${packageJson.version}:${hash(pnpmLock)}:${hash(cargoLock)}:${hash(JSON.stringify(vendorManifest))}`,
);
const document = {
  spdxVersion: 'SPDX-2.3',
  dataLicense: 'CC0-1.0',
  SPDXID: 'SPDXRef-DOCUMENT',
  name: `Reader ${packageJson.version} dependency SBOM`,
  documentNamespace: `https://spdx.org/spdxdocs/reader-${packageJson.version}-${namespaceSeed.slice(0, 24)}`,
  creationInfo: {
    created: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
    creators: ['Tool: Reader scripts/generate-sbom.mjs', `Person: ${packageJson.author}`],
  },
  documentComment:
    `Exact dependency inventory generated from pnpm-lock.yaml (SHA-256 ${hash(pnpmLock)}), ` +
    `src-tauri/Cargo.lock (SHA-256 ${hash(cargoLock)}), and THIRD_PARTY_COMPONENTS.json ` +
    `(SHA-256 ${hash(JSON.stringify(vendorManifest))}). Cargo entries include the cross-platform lock; ` +
    'the release manifest separately records the Windows-resolved build graph.',
  packages,
  relationships: [
    { spdxElementId: 'SPDXRef-DOCUMENT', relationshipType: 'DESCRIBES', relatedSpdxElement: rootId },
    ...relationships,
  ],
};

const serialized = `${JSON.stringify(document, null, 2)}\n`;
const localPathPattern = new RegExp(['(?<![A-Za-z])[A-Za-z]:', '[\\\\/]'].join(''));
if (localPathPattern.test(serialized)) throw new Error('SBOM contains an absolute Windows path');
for (const required of ['jszip', 'marked', 'mozilla pdf.js', 'tauri', 'playwright']) {
  if (!packages.some((item) => item.name.toLocaleLowerCase('en-US') === required)) {
    throw new Error(`SBOM is missing required component: ${required}`);
  }
}

await mkdir(dirname(output), { recursive: true });
await writeFile(output, serialized);
const relativeOutput = relative(root, output).split(sep).join('/');
console.log(
  `SPDX 2.3 SBOM written to ${relativeOutput}: ${packages.length} packages; SHA-256 ${hash(serialized)}.`,
);
