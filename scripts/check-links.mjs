import { readFile, readdir, stat } from 'node:fs/promises';
import { dirname, extname, relative, resolve, sep } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const excluded = new Set(['.git', 'node_modules', 'src-tauri/target', 'target', 'test-results']);

function fromRoot(path) {
  return relative(root, path).split(sep).join('/');
}

function ignored(path) {
  const local = fromRoot(path);
  return [...excluded].some((item) => local === item || local.startsWith(`${item}/`));
}

async function walk(path) {
  const files = [];
  for (const entry of await readdir(path, { withFileTypes: true })) {
    const child = resolve(path, entry.name);
    if (ignored(child)) continue;
    if (entry.isDirectory()) files.push(...(await walk(child)));
    else if (entry.isFile() && extname(entry.name).toLowerCase() === '.md') files.push(child);
  }
  return files;
}

const failures = [];
let localLinks = 0;
let externalLinks = 0;
for (const file of await walk(root)) {
  const markdown = await readFile(file, 'utf8');
  const withoutFences = markdown.replace(/```[\s\S]*?```/g, '');
  for (const match of withoutFences.matchAll(/!?\[[^\]]*\]\(([^)]+)\)/g)) {
    const rawTarget = match[1]
      .trim()
      .replace(/^<|>$/g, '')
      .split(/\s+["']/)[0];
    if (!rawTarget || rawTarget.startsWith('#')) continue;
    if (/^(?:https?:|mailto:)/i.test(rawTarget)) {
      externalLinks += 1;
      continue;
    }
    localLinks += 1;
    const decoded = decodeURIComponent(rawTarget.split('#')[0].split('?')[0]);
    const target = resolve(dirname(file), decoded);
    if (!(target === root || target.startsWith(`${root}${sep}`))) {
      failures.push(`${fromRoot(file)}: link escapes the repository (${rawTarget})`);
      continue;
    }
    try {
      await stat(target);
    } catch {
      failures.push(`${fromRoot(file)}: missing link target (${rawTarget})`);
    }
  }
}

if (failures.length) {
  console.error(
    `Repository link verification failed:\n${failures.map((failure) => `- ${failure}`).join('\n')}`,
  );
  process.exitCode = 1;
} else {
  console.log(
    `Repository link verification passed: ${localLinks} local targets exist; ${externalLinks} external URLs identified.`,
  );
}
