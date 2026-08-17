import { createHash } from 'node:crypto';
import { readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { basename, extname, relative, resolve, sep } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const excludedDirectories = new Set([
  '.git',
  '.pnpm-store',
  'node_modules',
  'release-artifacts',
  'src-tauri/target',
  'target',
  'test-results',
]);
const args = process.argv.slice(2);
const privateSources = [];
let outputPath = null;
for (let index = 0; index < args.length; index += 1) {
  if (args[index] === '--private-source') {
    if (!args[index + 1]) throw new Error('--private-source requires a path');
    privateSources.push(resolve(args[index + 1]));
    index += 1;
  } else if (args[index] === '--output') {
    if (!args[index + 1]) throw new Error('--output requires a path');
    outputPath = resolve(args[index + 1]);
    index += 1;
  } else {
    throw new Error(`Unknown argument: ${args[index]}`);
  }
}

function relativePath(path) {
  return relative(root, path).split(sep).join('/');
}

function isExcluded(path) {
  const pathFromRoot = relativePath(path);
  return [...excludedDirectories].some(
    (directory) => pathFromRoot === directory || pathFromRoot.startsWith(`${directory}/`),
  );
}

async function walk(path, { applyExclusions = true } = {}) {
  const details = await stat(path);
  if (details.isFile()) return [path];
  const files = [];
  for (const entry of await readdir(path, { withFileTypes: true })) {
    const child = resolve(path, entry.name);
    if (applyExclusions && isExcluded(child)) continue;
    if (entry.isDirectory()) files.push(...(await walk(child, { applyExclusions })));
    else if (entry.isFile()) files.push(child);
  }
  return files;
}

function normalizedPhrase(value) {
  return String(value)
    .normalize('NFKC')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^[`'"\s]+|[`'"\s]+$/g, '')
    .trim();
}

function usefulPrivatePhrase(value) {
  const phrase = normalizedPhrase(value);
  const words = phrase.split(' ').filter(Boolean);
  if (phrase.length < 10 || words.length < 2 || words.length > 18) return null;
  if (
    /^(protected|private|reference|source|sample|audiobook|reader)(\s+(file|input|media|metadata|sample))*$/i.test(
      phrase,
    )
  ) {
    return null;
  }
  return phrase;
}

async function derivePrivatePhrases(paths) {
  const phrases = new Map();
  const add = (value, category) => {
    const phrase = usefulPrivatePhrase(value);
    if (!phrase) return;
    phrases.set(phrase.toLocaleLowerCase('en-US'), {
      category,
      fingerprint: createHash('sha256').update(phrase.toLocaleLowerCase('en-US')).digest('hex').slice(0, 12),
    });
  };

  for (const path of paths) {
    let files;
    try {
      files = await walk(path, { applyExclusions: false });
    } catch {
      throw new Error(`Private scan source is unavailable: ${path}`);
    }
    for (const file of files) {
      add(basename(file), 'private-reference-filename');
      add(basename(file, extname(file)), 'private-reference-filename');
      if (!['.md', '.txt', '.json', '.yaml', '.yml'].includes(extname(file).toLowerCase())) continue;
      const details = await stat(file);
      if (details.size > 2 * 1024 * 1024) continue;
      const source = await readFile(file, 'utf8');
      for (const line of source.split(/\r?\n/)) {
        if (!/(title|author|file\s*name|filename|protected\s+sample|source\s+media)/i.test(line)) continue;
        for (const match of line.matchAll(/[`'"]([^`'"]{8,})[`'"]/g))
          add(match[1], 'private-reference-metadata');
        const value = line.split(/:\s*/, 2)[1];
        if (value) add(value.replace(/[*_`]/g, ''), 'private-reference-metadata');
      }
    }
  }
  return phrases;
}

const privatePhrases = await derivePrivatePhrases(privateSources);
// Assemble signatures from fragments so this scanner does not report its own
// rule definitions as credentials or private-key material.
const beginPrivateKey = ['-----BE', 'GIN (?:RSA |EC |OPENSSH )?PRI', 'VATE KEY-----'].join('');
const genericRules = [
  {
    id: 'windows-user-path',
    pattern: /[a-z]:[\\/](?:users|documents and settings)[\\/][^\\/\s"'<>]+/gi,
  },
  { id: 'unix-user-path', pattern: /\/(?:home|users)\/[^/\s"'<>]+\//gi },
  { id: 'sandbox-path', pattern: /sandbox:\/\/|sandbox:\/workspace/gi },
  { id: 'private-key', pattern: new RegExp(beginPrivateKey, 'g') },
  { id: 'aws-access-key', pattern: /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g },
  { id: 'github-token', pattern: /\bgh(?:p|o|u|s|r)_[A-Za-z0-9_]{30,}\b/g },
  { id: 'openai-token', pattern: /\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}\b/g },
  { id: 'slack-token', pattern: /\bxox[baprs]-[A-Za-z0-9-]{20,}\b/g },
  { id: 'credential-in-url', pattern: /https?:\/\/[^\s/:]+:[^\s/@]+@/gi },
  {
    id: 'literal-secret-assignment',
    pattern: /\b(?:password|passwd|secret|api[_-]?key|access[_-]?token)\s*[:=]\s*["'][^"'\r\n]{4,}["']/gi,
  },
];

const findings = [];
const files = await walk(root);
for (const file of files) {
  const path = relativePath(file);
  if (/^\.env(?:\.|$)/i.test(basename(file))) findings.push({ path, rule: 'environment-file' });
  const details = await stat(file);
  if (details.size > 32 * 1024 * 1024) {
    findings.push({ path, rule: 'unexpected-large-public-file', bytes: details.size });
    continue;
  }
  const buffer = await readFile(file);
  const content = buffer.toString('utf8');
  for (const rule of genericRules) {
    rule.pattern.lastIndex = 0;
    if (rule.pattern.test(content)) findings.push({ path, rule: rule.id });
  }
  const lower = normalizedPhrase(content).toLocaleLowerCase('en-US');
  for (const [phrase, metadata] of privatePhrases) {
    if (lower.includes(phrase)) {
      findings.push({ path, rule: metadata.category, fingerprint: metadata.fingerprint });
    }
  }
}

const uniqueFindings = [
  ...new Map(
    findings.map((finding) => [`${finding.path}:${finding.rule}:${finding.fingerprint ?? ''}`, finding]),
  ).values(),
];
const result = {
  scannedAt: new Date().toISOString(),
  root: '.',
  filesScanned: files.length,
  privateSourcesApplied: privateSources.length,
  privateValuesReported: false,
  findingCount: uniqueFindings.length,
  findings: uniqueFindings,
};
if (outputPath) await writeFile(outputPath, `${JSON.stringify(result, null, 2)}\n`);
if (uniqueFindings.length) {
  console.error(JSON.stringify(result, null, 2));
  process.exitCode = 1;
} else {
  console.log(
    `Public-tree scan passed: ${files.length} files; ${privateSources.length} private reference source(s); no values printed.`,
  );
}
