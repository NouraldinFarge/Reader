const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { readFileSync, mkdirSync, writeFileSync } = require('node:fs');
const { join } = require('node:path');
const { performance } = require('node:perf_hooks');
const {
  createEpub2,
  createEpub3,
  createInvalidEpub,
  createPasswordProtectedPdf,
  createSyntheticAaxHeader,
  createSyntheticPdf,
  createTraversalEpub,
} = require('./fixtures/synthetic-fixtures.cjs');

let playwright;
try {
  playwright = require('playwright');
} catch (error) {
  const runtimeModules = process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES;
  if (!runtimeModules) throw error;
  playwright = require(join(runtimeModules, 'playwright'));
}
const AxeBuilder = require('@axe-core/playwright').default;
const { chromium } = playwright;

const port = Number(process.env.READER_TEST_PORT || 4174);
const baseUrl = `http://127.0.0.1:${port}`;
const outputDir = join(process.cwd(), 'test-results');
mkdirSync(outputDir, { recursive: true });

const report = {
  startedAt: new Date().toISOString(),
  baseUrl,
  cases: [],
  accessibility: [],
};

async function waitForServer() {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      const response = await fetch(baseUrl);
      if (response.ok) return;
    } catch {
      // The loopback server may still be binding its port.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('Reader test server did not become ready.');
}

function monitorPage(page, label) {
  const errors = [];
  const outbound = [];
  const popups = [];
  page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(`console: ${message.text()}`);
  });
  page.on('request', (request) => {
    const url = request.url();
    if (/^https?:/i.test(url) && !url.startsWith(`${baseUrl}/`) && url !== baseUrl) outbound.push(url);
  });
  page.on('popup', (popup) => {
    popups.push(popup.url());
    void popup.close();
  });
  return {
    assertClean() {
      assert.deepEqual(errors, [], `${label} emitted browser errors`);
      assert.deepEqual(outbound, [], `${label} made an unintended outbound request`);
      assert.deepEqual(popups, [], `${label} opened an auxiliary browser window`);
    },
    errors,
    outbound,
    popups,
  };
}

async function boot(page) {
  await page.goto(baseUrl, { waitUntil: 'networkidle' });
  await page.getByRole('heading', { name: 'Your library' }).waitFor();
  await page.locator('#app').waitFor({ state: 'visible' });
}

async function severeAccessibilityScan(page, label) {
  const result = await new AxeBuilder({ page }).analyze();
  const severe = result.violations.filter((violation) => ['serious', 'critical'].includes(violation.impact));
  report.accessibility.push({
    label,
    violations: result.violations.map(({ id, impact, nodes }) => ({ id, impact, nodes: nodes.length })),
    seriousOrCritical: severe.length,
  });
  assert.deepEqual(
    severe.map(({ id, impact, nodes }) => ({
      id,
      impact,
      nodes: nodes.map(({ target, failureSummary }) => ({ target, failureSummary })),
    })),
    [],
    `${label} has serious or critical axe findings`,
  );
}

async function importPublication(page, { name, mimeType, buffer, title }) {
  await page.locator('#file-input').setInputFiles({ name, mimeType, buffer });
  const openButton = page.getByRole('button', { name: `Open ${title}`, exact: true });
  await openButton.waitFor({ timeout: 45_000 });
  const card = openButton.locator('xpath=ancestor::article[@data-book-card]');
  return { id: await card.getAttribute('data-book-card'), openButton };
}

async function expectImportFailure(page, { name, mimeType, buffer }, expectedMessage) {
  const before = await page.locator('[data-book-card]').count();
  await page.locator('#file-input').setInputFiles({ name, mimeType, buffer });
  const toast = page.locator('.toast').filter({ hasText: 'Could not import file' }).last();
  await toast.waitFor({ timeout: 45_000 });
  if (expectedMessage) assert.match(await toast.innerText(), new RegExp(expectedMessage, 'i'));
  assert.equal(await page.locator('[data-book-card]').count(), before);
  await toast.getByRole('button', { name: 'Dismiss notification' }).click();
}

async function databaseSnapshot(page) {
  return page.evaluate(async () => {
    const database = await new Promise((resolve, reject) => {
      const request = indexedDB.open('reader-local-library');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const transaction = database.transaction(
      ['books', 'blobs', 'annotations', 'collections', 'settings'],
      'readonly',
    );
    const request = (value) =>
      new Promise((resolve, reject) => {
        value.onsuccess = () => resolve(value.result);
        value.onerror = () => reject(value.error);
      });
    const [books, blobIds, annotations, collections, settings] = await Promise.all([
      request(transaction.objectStore('books').getAll()),
      request(transaction.objectStore('blobs').getAllKeys()),
      request(transaction.objectStore('annotations').getAll()),
      request(transaction.objectStore('collections').getAll()),
      request(transaction.objectStore('settings').getAll()),
    ]);
    const stores = [...database.objectStoreNames];
    const bookIndexes = [...transaction.objectStore('books').indexNames];
    const annotationIndexes = [...transaction.objectStore('annotations').indexNames];
    return {
      version: database.version,
      stores,
      bookIndexes,
      annotationIndexes,
      books: books.map(({ id, title, format, demo, progress, bookmarks, access }) => ({
        id,
        title,
        format,
        demo,
        progress,
        bookmarks,
        access,
      })),
      blobIds,
      annotations,
      collections,
      settings,
    };
  });
}

async function addSyntheticAnnotation(page, bookId) {
  await page.evaluate(async (id) => {
    const database = await new Promise((resolve, reject) => {
      const request = indexedDB.open('reader-local-library');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const transaction = database.transaction('annotations', 'readwrite');
    transaction.objectStore('annotations').put({
      id: `annotation-race-${id}`,
      bookId: id,
      type: 'highlight',
      quote: 'Synthetic deletion-race annotation.',
      note: 'Generated only inside an isolated browser test.',
      sectionIndex: 0,
      sectionTitle: 'Synthetic section',
      createdAt: new Date().toISOString(),
    });
    await new Promise((resolve, reject) => {
      transaction.oncomplete = resolve;
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
  }, bookId);
}

async function storageIntegrity(page) {
  return page.evaluate(async () => {
    const { inspectStorageIntegrity } = await import('./src/db.js');
    return inspectStorageIntegrity();
  });
}

async function runCase(browser, name, callback, contextOptions = {}) {
  const started = performance.now();
  const context = await browser.newContext({
    viewport: { width: 1440, height: 940 },
    deviceScaleFactor: 1,
    acceptDownloads: true,
    ...contextOptions,
  });
  try {
    await callback(context);
    report.cases.push({ name, status: 'passed', durationMs: Math.round(performance.now() - started) });
    console.log(`PASS ${name}`);
  } catch (error) {
    report.cases.push({
      name,
      status: 'failed',
      durationMs: Math.round(performance.now() - started),
      error: error.stack || error.message,
    });
    throw error;
  } finally {
    await context.close();
  }
}

async function coreJourney(context) {
  const page = await context.newPage();
  const monitor = monitorPage(page, 'core journey');
  await boot(page);
  assert.equal(await page.locator('[data-book-card]').count(), 3);

  const search = page.locator('#library-search');
  await search.fill('attention');
  assert.equal(await page.locator('[data-book-card]').count(), 2);
  await page.getByRole('button', { name: 'Open The Practice of Attention', exact: true }).click();
  await page.locator('#reader-view').waitFor({ state: 'visible' });
  await page.locator('#reader-title').filter({ hasText: 'The Practice of Attention' }).waitFor();
  assert.equal(await page.locator('#reader-title').textContent(), 'The Practice of Attention');
  await page.getByRole('button', { name: 'Add bookmark' }).click();
  await page.getByRole('button', { name: 'Remove bookmark' }).waitFor();
  await page.getByRole('button', { name: 'Next' }).click();
  await page.getByText('2 of 2', { exact: true }).waitFor();

  await page.locator('#appearance-button').click();
  await page.getByRole('button', { name: 'Night', exact: true }).click();
  assert.equal(await page.locator('#reader-view').getAttribute('data-theme'), 'night');
  await page.locator('#font-size-range').fill('23');
  await page.keyboard.press('Control+f');
  await page.locator('#book-search-input').fill('margin');
  await page.locator('[data-search-section]').first().waitFor();
  await severeAccessibilityScan(page, 'night reader with search panel');
  await page.keyboard.press('Escape');
  await page.locator('#close-reader').click();

  await page.reload({ waitUntil: 'networkidle' });
  await page.getByRole('heading', { name: 'Your library' }).waitFor();
  await page.locator('#library-search').fill('attention');
  await page.getByRole('button', { name: 'Open The Practice of Attention', exact: true }).click();
  await page.getByText('2 of 2', { exact: true }).waitFor();
  await page.getByRole('button', { name: 'Previous' }).click();
  await page.getByRole('button', { name: 'Remove bookmark' }).waitFor();
  await page.getByRole('button', { name: 'Next' }).click();
  assert.equal(await page.locator('#reader-view').getAttribute('data-theme'), 'night');
  assert.equal(await page.locator('#font-size-range').inputValue(), '23');
  await page.locator('#close-reader').click();

  await page.locator('#settings-button').click();
  await page.getByRole('heading', { name: 'Settings' }).waitFor();
  await severeAccessibilityScan(page, 'library settings dialog');
  page.once('dialog', async (dialog) => {
    assert.match(dialog.message(), /private titles, filenames, reading progress, quotes, and notes/i);
    assert.match(dialog.message(), /cannot restore/i);
    await dialog.accept();
  });
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export metadata' }).click();
  const download = await downloadPromise;
  const exported = JSON.parse(readFileSync(await download.path(), 'utf8'));
  assert.equal(exported.schemaVersion, '1.0');
  assert.ok(exported.books.some((book) => book.title === 'The Practice of Attention'));
  assert.ok(exported.books.every((book) => !Object.hasOwn(book, 'sections')));
  assert.ok(exported.books.every((book) => !Object.hasOwn(book, 'coverDataUrl')));
  await page.getByRole('button', { name: 'Close' }).click();

  await page.keyboard.press('Control+k');
  assert.equal(await page.evaluate(() => document.activeElement?.id), 'library-search');
  await context.setOffline(true);
  await search.fill('welcome');
  await page.getByRole('button', { name: 'Open Welcome to Reader', exact: true }).click();
  await page.locator('#reader-content h1').waitFor();
  await page.getByRole('button', { name: 'Next' }).click();
  await page.locator('#close-reader').click();
  await context.setOffline(false);

  await page.locator('#library-search').fill('');
  await severeAccessibilityScan(page, 'library overview');
  await page.screenshot({ path: join(outputDir, 'browser-library-evidence.png'), fullPage: true });
  monitor.assertClean();
}

async function hostileInputJourney(context) {
  const page = await context.newPage();
  const monitor = monitorPage(page, 'hostile input journey');
  await boot(page);

  const maliciousHtml =
    Buffer.from(`<!doctype html><html><head><base href="https://example.invalid/"><meta http-equiv="refresh" content="0;url=https://example.invalid"><style>@import url(https://example.invalid/x.css)</style></head><body>
    <h1>Markup Boundary Study</h1>
    <script>window.__readerFixtureExecuted = true</script>
    <iframe srcdoc="<script>top.__readerFixtureExecuted=true</script>"></iframe>
    <object data="https://example.invalid/object"></object><embed src="https://example.invalid/embed">
    <form action="https://example.invalid"><input autofocus formaction="https://example.invalid"></form>
    <svg onload="window.__readerFixtureExecuted=true"><script>window.__readerFixtureExecuted=true</script></svg>
    <math><annotation-xml encoding="text/html"><script>window.__readerFixtureExecuted=true</script></annotation-xml></math>
    <div id="window" class="reader-view" style="background:url(https://example.invalid)">Clobbering removed</div>
    <a href="javascript&#58;alert(1)" target="_blank" ping="https://example.invalid">Unsafe scheme</a>
    <a href="https://example.invalid/blocked" target="_blank">External handoff</a>
    <a id="safe-anchor" href="#safe-anchor">Safe anchor</a>
    <img src="data:image/svg+xml,<svg onload=alert(1)>"><img src="https://example.invalid/tracker.png" srcset="https://example.invalid/2x 2x">
  </body></html>`);
  const imported = await importPublication(page, {
    name: 'Markup Boundary Study.html',
    mimeType: 'text/html',
    buffer: maliciousHtml,
    title: 'Markup Boundary Study',
  });
  await imported.openButton.click();
  await page.locator('#reader-view').waitFor({ state: 'visible' });
  const safety = await page.locator('#reader-content').evaluate((root) => ({
    forbiddenElements: root.querySelectorAll(
      'script,iframe,object,embed,form,input,svg,math,style,meta,base,link,a[href],img',
    ).length,
    forbiddenAttributes: [...root.querySelectorAll('*')].flatMap((element) =>
      [...element.attributes]
        .filter((attribute) =>
          /^(on|style$|srcdoc$|target$|ping$|formaction$|class$|name$|xlink:)/i.test(attribute.name),
        )
        .map((attribute) => `${element.tagName}:${attribute.name}`),
    ),
    clobberId: Boolean(root.querySelector('#window')),
    externalLinks: root.querySelectorAll('[data-external-href]').length,
    internalAnchors: root.querySelectorAll('[data-reader-anchor]').length,
  }));
  assert.deepEqual(safety, {
    forbiddenElements: 0,
    forbiddenAttributes: [],
    clobberId: false,
    externalLinks: 1,
    internalAnchors: 1,
  });
  assert.equal(await page.evaluate(() => window.__readerFixtureExecuted), undefined);
  await page.locator('[data-external-href]').click();
  await page.getByText('External link blocked', { exact: true }).waitFor();

  const fuzzResult = await page.evaluate(async () => {
    const { sanitizeImportedHtml } = await import('./src/parsers.js');
    const payloads = [
      '<ScRiPt>alert(1)</sCrIpT><p onclick=alert(1)>text</p>',
      '<svg><a xlink:href="javascript:alert(1)"><text>bad</text></a></svg>',
      '<math><mtext><img src=x onerror=alert(1)></mtext></math>',
      '<a href="java&#x0A;script:alert(1)" target=_blank>bad</a>',
      '<div id=window></div><div id=same></div><div id=same></div>',
      '<template><img src="https://example.invalid"></template><x-reader style="color:red">kept text</x-reader>',
      '<form><button formaction="file:///secret">bad</button></form><p>safe</p>',
    ];
    const failures = [];
    for (const payload of payloads) {
      const { html } = await sanitizeImportedHtml(payload);
      const document = new DOMParser().parseFromString(html, 'text/html');
      const forbidden = document.querySelector(
        'script,iframe,object,embed,form,input,button,svg,math,style,meta,base,link,template,[onclick],[onerror],[style],[srcdoc],[target],[ping],[formaction],a[href],img',
      );
      if (forbidden || document.querySelector('#window') || document.querySelectorAll('#same').length > 1) {
        failures.push(html);
      }
    }
    return failures;
  });
  assert.deepEqual(fuzzResult, []);
  await page.locator('#close-reader').click();

  const epub3 = await importPublication(page, {
    name: 'harbor-light.epub',
    mimeType: 'application/epub+zip',
    buffer: await createEpub3({ maliciousChapter: true }),
    title: 'Harbor Light Field Notes',
  });
  await epub3.openButton.click();
  await page.getByText('1 of 2', { exact: true }).waitFor();
  assert.equal(
    await page.locator('#reader-content script, #reader-content svg, #reader-content img').count(),
    0,
  );
  await page.locator('[data-reader-href]').click();
  await page.getByText('2 of 2', { exact: true }).waitFor();
  await page.locator('#close-reader').click();

  const epub2 = await importPublication(page, {
    name: 'lantern-index.epub',
    mimeType: 'application/epub+zip',
    buffer: await createEpub2(),
    title: 'Lantern Index',
  });
  await epub2.openButton.click();
  await page.locator('#reader-toc-button').click();
  await page.getByRole('button', { name: /Indexed light/ }).waitFor();
  await page.locator('#close-reader').click();

  const spoof = await importPublication(page, {
    name: 'spoofed-cover.epub',
    mimeType: 'application/epub+zip',
    buffer: await createInvalidEpub('cover-spoof'),
    title: 'Invalid cover-spoof',
  });
  const spoofCard = page.locator(`[data-book-card="${spoof.id}"]`);
  assert.equal(await spoofCard.locator('.book-cover.has-image').count(), 0);

  await expectImportFailure(
    page,
    { name: 'traversal.epub', mimeType: 'application/epub+zip', buffer: await createTraversalEpub() },
    'archive path',
  );
  for (const kind of [
    'malformed-container',
    'missing-package',
    'duplicate-manifest',
    'broken-spine',
    'empty-content',
    'oversized-entry',
  ]) {
    await expectImportFailure(page, {
      name: `${kind}.epub`,
      mimeType: 'application/epub+zip',
      buffer: await createInvalidEpub(kind),
    });
  }

  const aax = await importPublication(page, {
    name: 'Synthetic Protected Lesson.aax',
    mimeType: 'audio/aax',
    buffer: createSyntheticAaxHeader(),
    title: 'Synthetic Protected Lesson',
  });
  const aaxSnapshot = await databaseSnapshot(page);
  assert.equal(aaxSnapshot.blobIds.includes(aax.id), false);
  await aax.openButton.click();
  await page.getByRole('heading', { name: 'Protected audiobook' }).waitFor();
  await page.getByText('Reader does not request activation data', { exact: false }).waitFor();
  await severeAccessibilityScan(page, 'protected-content boundary');
  await page.locator('#close-reader').click();

  assert.deepEqual(await storageIntegrity(page), {
    orphanBlobIds: [],
    orphanAnnotationIds: [],
    missingBlobBookIds: [],
  });
  assert.deepEqual(monitor.outbound, []);
  assert.deepEqual(monitor.popups, []);
  assert.ok(
    monitor.errors.every((message) => /base URI.*Content Security Policy|base-uri 'none'/i.test(message)),
    `unexpected hostile-input browser error: ${monitor.errors.join('\n')}`,
  );
}

async function persistenceJourney(context) {
  const page = await context.newPage();
  const monitor = monitorPage(page, 'persistence journey');
  await boot(page);

  const closeFixture = Buffer.from(
    `# Close Flush Study\n\nOpening paragraph.\n\n## Final Position\n\n${'A long final paragraph for deterministic scrolling. '.repeat(600)}`,
  );
  const closeBook = await importPublication(page, {
    name: 'Close Flush Study.md',
    mimeType: 'text/markdown',
    buffer: closeFixture,
    title: 'Close Flush Study',
  });
  await closeBook.openButton.click();
  await page.getByRole('button', { name: 'Next' }).click();
  await page.getByText('2 of 2', { exact: true }).waitFor();
  const closeScroll = await page.locator('#reader-stage').evaluate((stage) => {
    stage.style.scrollBehavior = 'auto';
    const maximum = stage.scrollHeight - stage.clientHeight;
    stage.scrollTop = Math.max(1, maximum * 0.62);
    stage.dispatchEvent(new Event('scroll'));
    return {
      maximum,
      scrollTop: stage.scrollTop,
      clientHeight: stage.clientHeight,
      scrollHeight: stage.scrollHeight,
    };
  });
  assert.ok(closeScroll.maximum > 0, `fixture did not overflow: ${JSON.stringify(closeScroll)}`);
  assert.ok(
    closeScroll.scrollTop / closeScroll.maximum > 0.4,
    `fixture did not scroll: ${JSON.stringify(closeScroll)}`,
  );
  await page.locator('#close-reader').click();
  await page.getByRole('heading', { name: 'Your library' }).waitFor();
  await page.reload({ waitUntil: 'networkidle' });
  await page.getByRole('heading', { name: 'Your library' }).waitFor();
  const afterClose = await databaseSnapshot(page);
  const closed = afterClose.books.find((book) => book.id === closeBook.id);
  assert.equal(closed.progress.sectionIndex, 1);
  assert.ok(
    closed.progress.sectionFraction > 0.4,
    `final progress was ${JSON.stringify(closed.progress)} after ${JSON.stringify(closeScroll)}`,
  );

  const raceHtml = Buffer.from(
    `<h1>Delete Race Study</h1>${'<p>Queued progress must never recreate this local record after deletion.</p>'.repeat(900)}`,
  );
  const deleteBook = await importPublication(page, {
    name: 'Delete Race Study.html',
    mimeType: 'text/html',
    buffer: raceHtml,
    title: 'Delete Race Study',
  });
  await addSyntheticAnnotation(page, deleteBook.id);
  await deleteBook.openButton.click();
  await page.locator('#reader-stage').evaluate((stage) => {
    stage.style.scrollBehavior = 'auto';
    stage.scrollTop = Math.max(1, (stage.scrollHeight - stage.clientHeight) * 0.7);
    stage.dispatchEvent(new Event('scroll'));
  });
  await page.locator('#reader-more-button').click();
  page.once('dialog', (dialog) => dialog.accept());
  await page.locator('#book-menu-delete').click();
  await page.getByRole('heading', { name: 'Your library' }).waitFor();
  await page.waitForTimeout(900);
  await page.reload({ waitUntil: 'networkidle' });
  await page.getByRole('heading', { name: 'Your library' }).waitFor();
  const afterDelete = await databaseSnapshot(page);
  assert.equal(
    afterDelete.books.some((book) => book.id === deleteBook.id),
    false,
  );
  assert.equal(afterDelete.blobIds.includes(deleteBook.id), false);
  assert.equal(
    afterDelete.annotations.some((annotation) => annotation.bookId === deleteBook.id),
    false,
  );

  const duplicateBuffer = Buffer.from(
    '# Duplicate Study\n\nExactly the same bytes identify one local publication.',
  );
  const duplicate = await importPublication(page, {
    name: 'Duplicate Study.md',
    mimeType: 'text/markdown',
    buffer: duplicateBuffer,
    title: 'Duplicate Study',
  });
  const countBeforeDuplicate = await page.locator('[data-book-card]').count();
  await page.locator('#file-input').setInputFiles({
    name: 'Duplicate Study.md',
    mimeType: 'text/markdown',
    buffer: duplicateBuffer,
  });
  await page.getByText('Already in your library', { exact: true }).waitFor();
  assert.equal(await page.locator('[data-book-card]').count(), countBeforeDuplicate);

  const resetRace = await importPublication(page, {
    name: 'Reset Race Study.html',
    mimeType: 'text/html',
    buffer: Buffer.from(
      `<h1>Reset Race Study</h1>${'<p>A pending renderer update cannot cross the reset epoch.</p>'.repeat(900)}`,
    ),
    title: 'Reset Race Study',
  });
  await addSyntheticAnnotation(page, resetRace.id);
  await resetRace.openButton.click();
  await page.locator('#reader-stage').evaluate((stage) => {
    stage.style.scrollBehavior = 'auto';
    stage.scrollTop = Math.max(1, (stage.scrollHeight - stage.clientHeight) * 0.55);
    stage.dispatchEvent(new Event('scroll'));
  });
  await page.evaluate(() => document.querySelector('#settings-button').click());
  page.once('dialog', (dialog) => dialog.accept());
  await page.locator('#reset-library-button').click();
  await page.getByText('Library reset', { exact: true }).waitFor();
  await page.waitForTimeout(900);
  await page.reload({ waitUntil: 'networkidle' });
  await page.getByRole('heading', { name: 'Your library' }).waitFor();
  const afterReset = await databaseSnapshot(page);
  assert.equal(afterReset.books.length, 3);
  assert.ok(afterReset.books.every((book) => book.demo));
  assert.equal(
    afterReset.books.some((book) => book.id === resetRace.id),
    false,
  );
  assert.equal(afterReset.blobIds.includes(resetRace.id), false);
  assert.equal(
    afterReset.annotations.some((annotation) => annotation.bookId === resetRace.id),
    false,
  );
  assert.equal(afterReset.version, 1);
  assert.deepEqual(afterReset.stores, ['annotations', 'blobs', 'books', 'collections', 'settings']);
  assert.deepEqual(afterReset.bookIndexes, ['format', 'lastOpenedAt']);
  assert.deepEqual(afterReset.annotationIndexes, ['bookId']);
  assert.deepEqual(await storageIntegrity(page), {
    orphanBlobIds: [],
    orphanAnnotationIds: [],
    missingBlobBookIds: [],
  });
  assert.ok(duplicate.id);
  monitor.assertClean();
}

async function quotaRollbackJourney(context) {
  const page = await context.newPage();
  const monitor = monitorPage(page, 'quota rollback journey');
  await boot(page);
  const before = await databaseSnapshot(page);
  await page.evaluate(() => {
    const originalPut = IDBObjectStore.prototype.put;
    window.__readerRestoreFixturePut = () => {
      IDBObjectStore.prototype.put = originalPut;
      delete window.__readerRestoreFixturePut;
    };
    IDBObjectStore.prototype.put = function putWithSyntheticQuotaFailure(value, ...arguments_) {
      if (this.name === 'blobs' && value?.fileName === 'Quota Rollback Study.html') {
        throw new DOMException('Synthetic storage quota reached.', 'QuotaExceededError');
      }
      return originalPut.call(this, value, ...arguments_);
    };
  });
  await page.locator('#file-input').setInputFiles({
    name: 'Quota Rollback Study.html',
    mimeType: 'text/html',
    buffer: Buffer.from(
      `<h1>Quota Rollback Study</h1><p>${'Atomic write must roll back. '.repeat(100_000)}</p>`,
    ),
  });
  await page
    .locator('.toast')
    .filter({ hasText: 'Could not import file' })
    .last()
    .waitFor({ timeout: 30_000 });
  await page.evaluate(() => window.__readerRestoreFixturePut?.());
  const after = await databaseSnapshot(page);
  assert.equal(
    after.books.some((book) => book.title === 'Quota Rollback Study'),
    false,
  );
  assert.equal(after.books.length, before.books.length);
  assert.deepEqual(await storageIntegrity(page), {
    orphanBlobIds: [],
    orphanAnnotationIds: [],
    missingBlobBookIds: [],
  });
  monitor.assertClean();
}

async function pdfJourney(context) {
  const page = await context.newPage();
  const monitor = monitorPage(page, 'PDF journey');
  await boot(page);

  const actionPdf = await importPublication(page, {
    name: 'PDF Action Safety.pdf',
    mimeType: 'application/pdf',
    buffer: createSyntheticPdf({ pages: 3, withJavaScriptAction: true }),
    title: 'PDF Action Safety',
  });
  await actionPdf.openButton.click();
  const canvas = page.locator('#reader-content canvas');
  await canvas.waitFor({ timeout: 30_000 });
  assert.match(await canvas.getAttribute('aria-label'), /PDF page 1 of 3/);
  const firstWidth = await canvas.evaluate((element) => element.width);
  await page.getByRole('button', { name: 'Next' }).click();
  await page.getByText('2 of 3', { exact: true }).waitFor();
  await page.keyboard.press('Control++');
  await page.waitForFunction(
    (width) => document.querySelector('#reader-content canvas')?.width > width,
    firstWidth,
  );
  await severeAccessibilityScan(page, 'PDF reading view');
  await page.locator('#close-reader').click();

  const secondPdf = await importPublication(page, {
    name: 'Rapid Switch Target.pdf',
    mimeType: 'application/pdf',
    buffer: createSyntheticPdf({ pages: 1, label: 'Rapid switch target' }),
    title: 'Rapid Switch Target',
  });
  await actionPdf.openButton.click();
  await page.locator('#close-reader').click();
  await secondPdf.openButton.click();
  await page.locator('#reader-title').filter({ hasText: 'Rapid Switch Target' }).waitFor();
  await page.locator('#reader-content canvas[aria-label="PDF page 1 of 1"]').waitFor({ timeout: 30_000 });
  assert.equal(await page.locator('#reader-title').textContent(), 'Rapid Switch Target');
  await page.locator('#close-reader').click();

  const encrypted = await importPublication(page, {
    name: 'Password Protected Fixture.pdf',
    mimeType: 'application/pdf',
    buffer: createPasswordProtectedPdf(),
    title: 'Password Protected Fixture',
  });
  await encrypted.openButton.click();
  await page.getByRole('heading', { name: 'Unable to open publication' }).waitFor({ timeout: 30_000 });
  await page.locator('#close-reader').click();

  const malformed = await importPublication(page, {
    name: 'Malformed Renderer Fixture.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from('%PDF-1.7\nsynthetic malformed object graph\n%%EOF\n'),
    title: 'Malformed Renderer Fixture',
  });
  await malformed.openButton.click();
  await page.getByRole('heading', { name: 'Unable to open publication' }).waitFor({ timeout: 30_000 });
  await page.locator('#close-reader').click();

  const missingBlob = await importPublication(page, {
    name: 'Missing Blob Recovery.pdf',
    mimeType: 'application/pdf',
    buffer: createSyntheticPdf({ pages: 1 }),
    title: 'Missing Blob Recovery',
  });
  await page.evaluate(async (bookId) => {
    const database = await new Promise((resolve, reject) => {
      const request = indexedDB.open('reader-local-library');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const transaction = database.transaction('blobs', 'readwrite');
    transaction.objectStore('blobs').delete(bookId);
    await new Promise((resolve, reject) => {
      transaction.oncomplete = resolve;
      transaction.onerror = () => reject(transaction.error);
    });
  }, missingBlob.id);
  await missingBlob.openButton.click();
  await page
    .locator('#reader-content')
    .getByText('The PDF file is no longer available in the local library.', { exact: true })
    .waitFor();
  await page.locator('#close-reader').click();
  const integrity = await storageIntegrity(page);
  assert.deepEqual(integrity.missingBlobBookIds, [missingBlob.id]);
  assert.deepEqual(integrity.orphanBlobIds, []);
  assert.deepEqual(integrity.orphanAnnotationIds, []);
  monitor.assertClean();
}

async function pdfWorkerFailureJourney(context) {
  const page = await context.newPage();
  const monitor = monitorPage(page, 'PDF worker failure journey');
  await page.route('**/vendor/pdfjs/pdf.worker.min.mjs', (route) => route.abort('failed'));
  await boot(page);
  const imported = await importPublication(page, {
    name: 'Worker Failure Fixture.pdf',
    mimeType: 'application/pdf',
    buffer: createSyntheticPdf({ pages: 1 }),
    title: 'Worker Failure Fixture',
  });
  await imported.openButton.click();
  await page.getByRole('heading', { name: 'Unable to open publication' }).waitFor({ timeout: 30_000 });
  assert.deepEqual(monitor.outbound, []);
  assert.deepEqual(monitor.popups, []);
  // Chromium may report the deliberately aborted local worker request to the console.
  assert.ok(
    monitor.errors.every((message) => /pdf\.worker|min\.mjs|worker|net::ERR_FAILED/i.test(message)),
    `unexpected worker-failure console output: ${monitor.errors.join('\n')}`,
  );
}

async function responsiveKeyboardJourney(context) {
  const page = await context.newPage();
  const monitor = monitorPage(page, 'responsive and keyboard journey');
  await boot(page);
  await page.setViewportSize({ width: 375, height: 812 });
  await page.locator('.mobile-nav').waitFor({ state: 'visible' });
  await page.getByRole('button', { name: 'Open navigation' }).click();
  assert.equal(await page.locator('#app').getAttribute('class'), 'app-shell is-menu-open');
  await page.keyboard.press('Escape');
  await page.keyboard.press('Control+k');
  assert.equal(await page.evaluate(() => document.activeElement?.id), 'library-search');
  await page.locator('#library-search').fill('welcome');
  await page.keyboard.press('Tab');
  await severeAccessibilityScan(page, 'narrow library viewport');

  await page.setViewportSize({ width: 1440, height: 940 });
  await page.evaluate(() => {
    document.documentElement.style.zoom = '2';
  });
  await page.locator('#library-search').fill('attention');
  await page.getByRole('button', { name: 'Open The Practice of Attention', exact: true }).click();
  await page.locator('#reader-view').waitFor({ state: 'visible' });
  assert.equal(await page.locator('#close-reader').isVisible(), true);
  assert.equal(await page.locator('#reader-stage').isVisible(), true);
  await page.keyboard.press('ArrowRight');
  await page.getByText('2 of 2', { exact: true }).waitFor();
  await page.keyboard.press('Escape');
  await page.getByRole('heading', { name: 'Your library' }).waitFor();
  monitor.assertClean();
}

(async () => {
  const server = spawn(process.execPath, ['scripts/serve.mjs', '--port', String(port)], {
    cwd: process.cwd(),
    stdio: 'pipe',
    windowsHide: true,
  });
  let browser;
  try {
    await waitForServer();
    browser = await chromium.launch({ headless: true });
    const selected = new Set(
      String(process.env.READER_E2E_CASES || '')
        .split(',')
        .map((value) => value.trim())
        .filter(Boolean),
    );
    const runSelected = async (key, name, callback, options) => {
      if (selected.size && !selected.has(key)) return;
      await runCase(browser, name, callback, options);
    };
    await runSelected('core', 'core reading, reload, export, offline, and accessibility', coreJourney);
    await runSelected(
      'hostile',
      'hostile markup, EPUB 2/3, malformed archives, and protected content',
      hostileInputJourney,
    );
    await runSelected(
      'persistence',
      'IndexedDB persistence, duplicate, delete race, and reset race',
      persistenceJourney,
    );
    await runSelected(
      'quota',
      'quota-style IndexedDB abort leaves no partial book or blob',
      quotaRollbackJourney,
    );
    await runSelected(
      'pdf',
      'PDF rendering, actions disabled, switching, password, corruption, and recovery',
      pdfJourney,
    );
    await runSelected('worker', 'local PDF worker failure is contained', pdfWorkerFailureJourney);
    await runSelected(
      'responsive',
      'responsive layout, keyboard navigation, and 200% zoom',
      responsiveKeyboardJourney,
      { reducedMotion: 'reduce' },
    );
    report.completedAt = new Date().toISOString();
    report.status = 'passed';
    console.log(`E2E PASS: ${report.cases.length} browser cases; zero serious/critical axe findings.`);
  } finally {
    if (browser) await browser.close();
    server.kill('SIGTERM');
    report.completedAt ??= new Date().toISOString();
    report.status ??= 'failed';
    writeFileSync(join(outputDir, 'browser-report.json'), `${JSON.stringify(report, null, 2)}\n`);
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
