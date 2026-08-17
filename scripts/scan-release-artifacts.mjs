import { createHash } from 'node:crypto';
import { readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { basename, extname, relative, resolve, sep } from 'node:path';
import JSZip from 'jszip';

const args = process.argv.slice(2);
let directory = null;
let output = null;
const privateSources = [];
for (let index = 0; index < args.length; index += 1) {
  if (args[index] === '--directory' && args[index + 1]) directory = resolve(args[++index]);
  else if (args[index] === '--output' && args[index + 1]) output = resolve(args[++index]);
  else if (args[index] === '--private-source' && args[index + 1]) privateSources.push(resolve(args[++index]));
  else throw new Error(`Unknown or incomplete argument: ${args[index]}`);
}
if (!directory) throw new Error('--directory is required');

async function walk(path) {
  const details = await stat(path);
  if (details.isFile()) return [path];
  const files = [];
  for (const entry of await readdir(path, { withFileTypes: true })) {
    const child = resolve(path, entry.name);
    if (entry.isDirectory()) files.push(...(await walk(child)));
    else if (entry.isFile()) files.push(child);
  }
  return files;
}

function normalized(value) {
  return String(value).normalize('NFKC').replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function useful(value) {
  const phrase = normalized(value);
  const words = phrase.split(' ').filter(Boolean);
  if (phrase.length < 10 || words.length < 2 || words.length > 18) return null;
  if (
    /^(?:protected|private|reference|source|sample|audiobook|reader)(?:\s+(?:file|input|media|metadata|sample))*$/i.test(
      phrase,
    )
  ) {
    return null;
  }
  return phrase;
}

const privatePhrases = new Map();
function addPrivate(value, rule) {
  const phrase = useful(value);
  if (!phrase) return;
  const lower = phrase.toLocaleLowerCase('en-US');
  privatePhrases.set(lower, {
    rule,
    fingerprint: createHash('sha256').update(lower).digest('hex').slice(0, 12),
  });
}
for (const source of privateSources) {
  for (const file of await walk(source)) {
    addPrivate(basename(file), 'private-reference-filename');
    addPrivate(basename(file, extname(file)), 'private-reference-filename');
    if (!['.md', '.txt', '.json', '.yaml', '.yml'].includes(extname(file).toLowerCase())) continue;
    if ((await stat(file)).size > 2 * 1024 * 1024) continue;
    for (const line of (await readFile(file, 'utf8')).split(/\r?\n/)) {
      if (!/(?:title|author|file\s*name|filename|protected\s+sample|source\s+media)/i.test(line)) continue;
      for (const match of line.matchAll(/[`'"]([^`'"]{8,})[`'"]/g))
        addPrivate(match[1], 'private-reference-metadata');
      const value = line.split(/:\s*/, 2)[1];
      if (value) addPrivate(value.replace(/[*_`]/g, ''), 'private-reference-metadata');
    }
  }
}

const beginPrivateKey = ['-----BE', 'GIN (?:RSA |EC |OPENSSH )?PRI', 'VATE KEY-----'].join('');
const genericRules = [
  ['windows-user-path', /[a-z]:[\\/](?:users|documents and settings)[\\/][^\\/\s"'<>]+/gi],
  ['unix-user-path', /\/(?:home|users)\/[^/\s"'<>]+\//gi],
  ['sandbox-path', /sandbox:\/\/|sandbox:\/workspace/gi],
  ['private-key', new RegExp(beginPrivateKey, 'g')],
  ['aws-access-key', /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g],
  ['github-token', /\bgh(?:p|o|u|s|r)_[A-Za-z0-9_]{30,}\b/g],
  ['openai-token', /\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}\b/g],
  ['slack-token', /\bxox[baprs]-[A-Za-z0-9-]{20,}\b/g],
  ['credential-in-url', /https?:\/\/[^\s/:]+:[^\s/@]+@/gi],
];
const findings = [];

function scanText(label, content) {
  for (const [rule, pattern] of genericRules) {
    pattern.lastIndex = 0;
    if (pattern.test(content)) findings.push({ artifact: label, rule });
  }
  const lower = normalized(content).toLocaleLowerCase('en-US');
  for (const [phrase, metadata] of privatePhrases) {
    if (lower.includes(phrase)) findings.push({ artifact: label, ...metadata });
  }
}

for (const file of await walk(directory)) {
  const label = relative(directory, file).split(sep).join('/');
  scanText(label, basename(file));
  const buffer = await readFile(file);
  if (extname(file).toLowerCase() === '.zip') {
    const zip = await JSZip.loadAsync(buffer, { checkCRC32: true });
    for (const [name, entry] of Object.entries(zip.files)) {
      scanText(`${label}!${name}`, name);
      if (entry.dir || /\.(?:png|jpe?g|gif|webp|ico|zip|exe|woff2?)$/i.test(name)) continue;
      const bytes = await entry.async('uint8array');
      if (bytes.byteLength <= 32 * 1024 * 1024)
        scanText(`${label}!${name}`, Buffer.from(bytes).toString('utf8'));
    }
  } else if (buffer.byteLength <= 32 * 1024 * 1024) {
    scanText(label, buffer.toString('utf8'));
    if (/\.(?:exe|dll|msi)$/i.test(file)) scanText(label, buffer.toString('utf16le'));
  }
}

const unique = [
  ...new Map(
    findings.map((item) => [`${item.artifact}:${item.rule}:${item.fingerprint ?? ''}`, item]),
  ).values(),
];
const result = {
  scannedAt: new Date().toISOString(),
  directory: '.',
  privateSourcesApplied: privateSources.length,
  privateValuesReported: false,
  findingCount: unique.length,
  findings: unique,
};
if (output) await writeFile(output, `${JSON.stringify(result, null, 2)}\n`);
if (unique.length) {
  console.error(JSON.stringify(result, null, 2));
  process.exitCode = 1;
} else {
  console.log(
    `Release private-data scan passed: ${privateSources.length} private reference source(s); no values printed.`,
  );
}
