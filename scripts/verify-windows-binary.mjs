import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { assertWindowsGuiPe } from './windows-pe.mjs';

const args = process.argv.slice(2);
if (args.length !== 2 || args[0] !== '--file') {
  throw new Error('Usage: node scripts/verify-windows-binary.mjs --file <reader.exe>');
}

const file = resolve(args[1]);
const details = assertWindowsGuiPe(await readFile(file));
console.log(
  `Windows binary verification passed: ${details.machine}, optional header ${details.optionalMagic}, subsystem ${details.subsystem} (${details.subsystemName}).`,
);
