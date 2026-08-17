import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
assert.equal(process.platform, 'win32', 'The Windows release build must run on Windows');
assert.ok(process.env.USERPROFILE, 'USERPROFILE is required to sanitize Windows build paths');
assert.ok(
  !process.env.RUSTFLAGS || process.env.CARGO_ENCODED_RUSTFLAGS,
  'Use CARGO_ENCODED_RUSTFLAGS instead of RUSTFLAGS for an unambiguous release build',
);

const prefixes = [
  [root, 'reader-source'],
  [process.env.CARGO_HOME, 'cargo-home'],
  [process.env.USERPROFILE, 'build-user'],
]
  .filter(([path]) => path)
  .map(([path, replacement]) => [resolve(path), replacement])
  .sort(([left], [right]) => right.length - left.length)
  .filter(([path], index, entries) => entries.findIndex(([candidate]) => candidate === path) === index);
const existingFlags = process.env.CARGO_ENCODED_RUSTFLAGS?.split('\u001f').filter(Boolean) ?? [];
const remapFlags = prefixes.map(
  ([path, replacement]) => `--remap-path-prefix=${path.replaceAll('\\', '/')}=${replacement}`,
);
const cli = resolve(root, 'node_modules', '@tauri-apps', 'cli', 'tauri.js');
const result = spawnSync(
  process.execPath,
  [cli, 'build', '--bundles', 'nsis', '--config', JSON.stringify({ bundle: { useLocalToolsDir: true } })],
  {
    cwd: root,
    env: {
      ...process.env,
      CARGO_ENCODED_RUSTFLAGS: [...existingFlags, ...remapFlags].join('\u001f'),
    },
    stdio: 'inherit',
  },
);
if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status ?? 1);

const executable = readFileSync(resolve(root, 'src-tauri', 'target', 'release', 'reader.exe'));
const profile = resolve(process.env.USERPROFILE).toLocaleLowerCase('en-US');
for (const encoding of ['utf8', 'utf16le']) {
  assert.ok(
    !executable.toString(encoding).toLocaleLowerCase('en-US').includes(profile),
    `Release executable contains the build user profile path in ${encoding}`,
  );
}

console.log(`Windows release build passed path-remapping checks for ${prefixes.length} build roots.`);
