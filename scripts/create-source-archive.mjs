import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { access, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const args = process.argv.slice(2);
if (args.length !== 2 || args[0] !== '--output') {
  throw new Error('Usage: node scripts/create-source-archive.mjs --output <source.zip>');
}

const output = resolve(args[1]);
try {
  await access(output);
  throw new Error(`Refusing to overwrite existing archive: ${output}`);
} catch (error) {
  if (error?.code !== 'ENOENT') throw error;
}

function run(command, commandArgs) {
  const result = spawnSync(command, commandArgs, {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 8 * 1024 * 1024,
  });
  if (result.status !== 0) {
    throw new Error(`${command} failed:\n${result.error?.message ?? result.stderr ?? result.stdout}`);
  }
  return result.stdout.trim();
}

assert.equal(run('git', ['status', '--porcelain=v1']), '', 'Git worktree must be clean');
const commit = run('git', ['rev-parse', 'HEAD']);
await mkdir(dirname(output), { recursive: true });
run('git', ['archive', '--format=zip', '--prefix=reader/', `--output=${output}`, commit]);

console.log(`Immutable source archive created from commit ${commit}: ${output}`);
