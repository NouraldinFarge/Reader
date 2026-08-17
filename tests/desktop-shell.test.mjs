import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const cargo = await readFile(new URL('../src-tauri/Cargo.toml', import.meta.url), 'utf8');
const main = await readFile(new URL('../src-tauri/src/main.rs', import.meta.url), 'utf8');
const lib = await readFile(new URL('../src-tauri/src/lib.rs', import.meta.url), 'utf8');
const config = JSON.parse(await readFile(new URL('../src-tauri/tauri.conf.json', import.meta.url), 'utf8'));
const capability = JSON.parse(
  await readFile(new URL('../src-tauri/capabilities/default.json', import.meta.url), 'utf8'),
);
const html = await readFile(new URL('../app/index.html', import.meta.url), 'utf8');
const application = await readFile(new URL('../app/src/app.js', import.meta.url), 'utf8');
const parsers = await readFile(new URL('../app/src/parsers.js', import.meta.url), 'utf8');

test('every Windows build uses the GUI subsystem without a console', () => {
  assert.match(main, /cfg_attr\(target_os = "windows", windows_subsystem = "windows"\)/);
  assert.doesNotMatch(main, /not\(debug_assertions\)/);
});

test('the desktop shell declares exactly one manually-created main window', () => {
  assert.equal(config.app.windows.length, 1);
  assert.equal(config.app.windows[0].label, 'main');
  assert.equal(config.app.windows[0].create, false);
  assert.equal(config.app.windows[0].visible, true);
  assert.equal(config.app.windows[0].devtools, false);
  assert.match(lib, /WebviewWindowBuilder::from_config\(app\.handle\(\), main_config\)/);
  assert.match(lib, /\.visible\(true\)/);
  assert.match(lib, /\.focused\(true\)/);
  assert.match(lib, /main_window\.show\(\)\?/);
  assert.match(lib, /main_window\.set_focus\(\)\?/);
  assert.equal((lib.match(/\.build\(\)\?/g) ?? []).length, 1);
});

test('second launches focus the existing window through the first plugin', () => {
  assert.match(cargo, /tauri-plugin-single-instance = "2"/);
  assert.match(lib, /builder\.plugin\(tauri_plugin_single_instance::init/);
  assert.match(lib, /get_webview_window\("main"\)/);
  assert.match(lib, /window\.unminimize\(\)/);
  assert.match(lib, /window\.show\(\)/);
  assert.match(lib, /window\.set_focus\(\)/);
  assert.equal((lib.match(/\.plugin\(/g) ?? []).length, 1);
});

test('native and capability boundaries deny auxiliary windows', () => {
  assert.match(lib, /\.on_new_window\(/);
  assert.match(lib, /NewWindowResponse::Deny/);
  assert.match(lib, /\.on_navigation\(is_reader_navigation\)/);
  assert.ok(capability.permissions.includes('core:window:deny-create'));
  assert.ok(capability.permissions.includes('core:webview:deny-create-webview'));
  assert.ok(capability.permissions.includes('core:webview:deny-create-webview-window'));
  assert.ok(capability.permissions.includes('core:webview:deny-internal-toggle-devtools'));
});

test('publication content cannot retain browser popup affordances', () => {
  assert.doesNotMatch(html, /target\s*=\s*["']_blank/i);
  assert.doesNotMatch(application, /window\.open\s*\(/);
  assert.doesNotMatch(parsers, /anchor\.target\s*=|setAttribute\(['"]target/i);
  assert.match(parsers, /SAFE_GLOBAL_ATTRIBUTES = new Set\(\['dir', 'id', 'lang', 'title'\]\)/);
  assert.match(parsers, /anchor\.removeAttribute\('href'\)/);
  assert.match(parsers, /anchor\.setAttribute\('role', 'link'\)/);
  assert.match(application, /event\.key === 'Enter'/);
});

test('the native shell cannot spawn terminal or child processes', () => {
  assert.doesNotMatch(lib, /std::process|process::Command|\.spawn\s*\(/);
  assert.doesNotMatch(main, /std::process|process::Command|\.spawn\s*\(/);
});
