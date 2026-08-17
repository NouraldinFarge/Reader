import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const readText = (path) => readFile(resolve(root, path), 'utf8');
const readJson = async (path) => JSON.parse(await readText(path));
const facts = await readJson('docs/PROJECT_FACTS.json');
const packageJson = await readJson('package.json');
const tauri = await readJson('src-tauri/tauri.conf.json');
const cargo = await readText('src-tauri/Cargo.toml');
const cargoLock = await readText('src-tauri/Cargo.lock');
const version = facts.product.developmentVersion;

assert.equal(packageJson.version, version, 'package.json version drifted');
assert.equal(packageJson.private, true, 'npm publication guard must remain enabled');
assert.equal(tauri.version, version, 'Tauri version drifted');
assert.match(cargo, new RegExp(`^version = "${version.replaceAll('.', '\\.')}"$`, 'm'));
assert.match(
  cargoLock,
  new RegExp(`name = "reader"\\r?\\nversion = "${version.replaceAll('.', '\\.')}"`),
  'Cargo.lock root package version drifted',
);
assert.equal(facts.product.latestPublicRelease, null, 'No public release has been approved');
assert.equal(facts.product.repositoryUrl, null, 'No public repository has been approved');
assert.equal(facts.release.projectLicense, 'not-selected-owner-approval-required');
assert.equal(facts.release.signingStatus, 'unsigned-owner-approval-and-certificate-required');

const synchronizedFiles = [
  'README.md',
  'CHANGELOG.md',
  'docs/RELEASE_NOTES.md',
  'docs/RECRUITER_COPY.md',
  'docs/TESTING.md',
];
for (const path of synchronizedFiles) {
  const content = await readText(path);
  assert.ok(content.includes(version), `${path} does not name ${version}`);
}

const readme = await readText('README.md');
const recruiter = await readText('docs/RECRUITER_COPY.md');
for (const content of [readme, recruiter]) {
  assert.match(content, /private|not published/i, 'Publication status must remain explicit');
  assert.doesNotMatch(content, /\b(?:React|TypeScript|Vite|SQLite)-backed\b/i);
  assert.doesNotMatch(
    content,
    /\b(?:production-ready|vulnerability-free|fully accessible|WCAG-conformant)\b/i,
  );
}

try {
  const browser = await readJson('test-results/browser-report.json');
  assert.equal(browser.status, 'passed', 'Latest browser report did not pass');
  assert.equal(browser.cases.length, facts.verification.browserScenarioGroups);
  assert.equal(
    browser.cases.filter((entry) => entry.status === 'passed').length,
    facts.verification.browserScenarioGroupsPassed,
  );
  assert.equal(browser.accessibility.length, facts.verification.axeScans);
  assert.equal(
    browser.accessibility.reduce((sum, entry) => sum + entry.seriousOrCritical, 0),
    facts.verification.axeSeriousOrCriticalFindings,
  );
} catch (error) {
  if (error?.code !== 'ENOENT') throw error;
}

try {
  const coverage = await readJson('test-results/coverage/coverage-summary.json');
  for (const metric of ['lines', 'branches', 'functions', 'statements']) {
    assert.equal(coverage.total[metric].pct, facts.verification.coverage[`${metric}Percent`]);
  }
} catch (error) {
  if (error?.code !== 'ENOENT') throw error;
}

console.log(
  `Facts verification passed for Reader ${version}; private status, versions, and measured claims agree.`,
);
