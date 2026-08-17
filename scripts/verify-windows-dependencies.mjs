import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const manifest = resolve(root, 'src-tauri', 'Cargo.toml');
const result = spawnSync(
  process.platform === 'win32' ? 'cargo.exe' : 'cargo',
  [
    'tree',
    '--manifest-path',
    manifest,
    '--locked',
    '--target',
    'x86_64-pc-windows-msvc',
    '--edges',
    'normal,build',
    '--prefix',
    'none',
  ],
  { cwd: root, encoding: 'utf8' },
);

if (result.status !== 0) {
  process.stderr.write(result.stderr || result.stdout);
  process.exit(result.status || 1);
}

const targetExcludedFamilies = [
  'atk',
  'atk-sys',
  'cairo-rs',
  'gdk',
  'gdk-sys',
  'gdkwayland-sys',
  'gdkx11-sys',
  'gio',
  'glib',
  'glib-sys',
  'gobject-sys',
  'gtk',
  'gtk-sys',
  'pango',
  'pango-sys',
];
const packages = result.stdout
  .split(/\r?\n/)
  .map((line) => line.trim().match(/^([^\s]+) v(\d[^\s]*)/)?.[1])
  .filter(Boolean);
const forbidden = [...new Set(packages.filter((name) => targetExcludedFamilies.includes(name)))];

if (forbidden.length) {
  console.error(`Windows dependency verification failed: ${forbidden.join(', ')} reached the Windows graph.`);
  process.exitCode = 1;
} else {
  console.log(
    `Windows dependency verification passed: ${new Set(packages).size} packages; GTK/GLib families are target-excluded.`,
  );
}
