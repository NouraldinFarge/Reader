import assert from 'node:assert/strict';
import test from 'node:test';
import { createBookSaveCoordinator } from '../app/src/save-coordinator.js';

class FakeClock {
  #nextId = 1;
  #now = 0;
  #timers = new Map();

  setTimeout = (callback, delay = 0) => {
    const id = this.#nextId;
    this.#nextId += 1;
    this.#timers.set(id, { callback, due: this.#now + Math.max(0, Number(delay) || 0) });
    return id;
  };

  clearTimeout = (id) => {
    this.#timers.delete(id);
  };

  async tick(milliseconds) {
    const end = this.#now + milliseconds;
    while (true) {
      const next = [...this.#timers.entries()]
        .filter(([, timer]) => timer.due <= end)
        .sort((left, right) => left[1].due - right[1].due || left[0] - right[0])[0];
      if (!next) break;
      const [id, timer] = next;
      this.#timers.delete(id);
      this.#now = timer.due;
      timer.callback();
      await Promise.resolve();
    }
    this.#now = end;
    await Promise.resolve();
  }
}

function createHarness(saveOverride) {
  const clock = new FakeClock();
  const writes = [];
  const errors = [];
  const save =
    saveOverride ??
    (async (book) => {
      writes.push(structuredClone(book));
    });
  const coordinator = createBookSaveCoordinator({
    save,
    onError: (error) => errors.push(error),
    setTimer: clock.setTimeout,
    clearTimer: clock.clearTimeout,
  });
  return { clock, coordinator, errors, writes };
}

test('the coordinator validates inputs and can revive a failed deletion', async () => {
  assert.throws(() => createBookSaveCoordinator(), /save function is required/);
  const { clock, coordinator, writes } = createHarness();
  assert.equal(coordinator.schedule(null), false);
  assert.equal(await coordinator.flush({}), false);
  await coordinator.invalidateBook('missing-book');
  await coordinator.invalidateBook('');

  const book = { id: 'book-revive', progress: { page: 1 } };
  coordinator.schedule(book, -50);
  await coordinator.invalidateBook(book.id);
  assert.equal(coordinator.isTombstoned(book.id), true);
  coordinator.reviveBook(book.id);
  assert.equal(coordinator.isTombstoned(book.id), false);
  assert.equal(coordinator.schedule(book, 'immediate'), true);
  await clock.tick(0);
  await coordinator.waitForIdle();
  assert.equal(writes.length, 1);
});

test('error reporting failures and clone fallback cannot produce unhandled rejections', async () => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'structuredClone');
  Object.defineProperty(globalThis, 'structuredClone', { configurable: true, value: undefined });
  const clock = new FakeClock();
  const coordinator = createBookSaveCoordinator({
    save: async () => {
      throw new Error('synthetic save failure');
    },
    onError: () => {
      throw new Error('synthetic reporter failure');
    },
    setTimer: clock.setTimeout,
    clearTimer: clock.clearTimeout,
  });
  const unhandled = [];
  const listener = (error) => unhandled.push(error);
  process.on('unhandledRejection', listener);
  try {
    coordinator.schedule({ id: 'fallback-clone', nested: { page: 7 } }, 0);
    await clock.tick(0);
    await coordinator.waitForIdle();
    await new Promise((resolve) => setImmediate(resolve));
  } finally {
    process.off('unhandledRejection', listener);
    if (descriptor) Object.defineProperty(globalThis, 'structuredClone', descriptor);
  }
  assert.deepEqual(unhandled, []);
});

test('queued progress cannot save after book invalidation and deletion delay', async () => {
  const { clock, coordinator, writes } = createHarness();
  const book = { id: 'book-delete', progress: { page: 4 } };

  coordinator.schedule(book, 50);
  await coordinator.invalidateBook(book.id);
  await clock.tick(100);
  await coordinator.waitForIdle();

  assert.deepEqual(writes, []);
  assert.equal(coordinator.isTombstoned(book.id), true);
  assert.equal(coordinator.schedule({ ...book, progress: { page: 9 } }, 0), false);
});

test('library reset invalidates every captured callback and rejects old renderer updates', async () => {
  const { clock, coordinator, writes } = createHarness();
  const first = { id: 'book-reset-a', progress: { sectionIndex: 1 } };
  const second = { id: 'book-reset-b', progress: { audioTime: 18 } };

  coordinator.schedule(first, 25);
  coordinator.schedule(second, 35);
  await coordinator.invalidateAll([first.id, second.id]);
  await clock.tick(100);

  assert.deepEqual(writes, []);
  assert.equal(coordinator.schedule({ ...second, progress: { audioTime: 99 } }, 0), false);
});

test('multiple queued updates are superseded and deletion cancels the latest snapshot', async () => {
  const { clock, coordinator, writes } = createHarness();
  const book = { id: 'book-many', progress: { page: 1 } };

  for (let page = 2; page <= 20; page += 1) {
    book.progress.page = page;
    coordinator.schedule(book, 40);
  }
  assert.equal(coordinator.pendingTimerCount(), 1);
  await coordinator.invalidateBook(book.id);
  await clock.tick(80);

  assert.deepEqual(writes, []);
});

test('in-flight saves drain before destructive deletion continues', async () => {
  let releaseSave;
  const saveStarted = new Promise((resolve) => {
    releaseSave = resolve;
  });
  let markStarted;
  const started = new Promise((resolve) => {
    markStarted = resolve;
  });
  const writes = [];
  const { clock, coordinator } = createHarness(async (book) => {
    markStarted();
    await saveStarted;
    writes.push(structuredClone(book));
  });
  const book = { id: 'book-in-flight', progress: { page: 3 } };

  coordinator.schedule(book, 10);
  await clock.tick(10);
  await started;
  let invalidationFinished = false;
  const invalidation = coordinator.invalidateBook(book.id).then(() => {
    invalidationFinished = true;
  });
  await Promise.resolve();
  assert.equal(invalidationFinished, false);

  releaseSave();
  await invalidation;
  assert.equal(invalidationFinished, true);
  assert.equal(writes.length, 1, 'the already-started save finishes before storage deletion may run');
});

test('closing a valid book flushes the final immutable progress snapshot', async () => {
  const { clock, coordinator, writes } = createHarness();
  const book = { id: 'book-close', progress: { sectionIndex: 0, sectionFraction: 0.1 } };

  coordinator.schedule(book, 500);
  book.progress.sectionFraction = 0.83;
  assert.equal(await coordinator.flush(book), true);
  book.progress.sectionFraction = 0.99;
  await clock.tick(600);

  assert.equal(writes.length, 1);
  assert.equal(writes[0].progress.sectionFraction, 0.83);
});

test('save failures are handled without unhandled promise rejections', async () => {
  const rejection = new Error('synthetic storage failure');
  const { clock, coordinator, errors } = createHarness(async () => {
    throw rejection;
  });
  const unhandled = [];
  const listener = (error) => unhandled.push(error);
  process.on('unhandledRejection', listener);
  try {
    coordinator.schedule({ id: 'book-error', progress: {} }, 5);
    await clock.tick(5);
    await coordinator.waitForIdle();
    await new Promise((resolve) => setImmediate(resolve));
  } finally {
    process.off('unhandledRejection', listener);
  }

  assert.deepEqual(errors, [rejection]);
  assert.deepEqual(unhandled, []);
});

test('delete and reset race scenarios remain deterministic over repeated runs', async () => {
  for (let iteration = 0; iteration < 40; iteration += 1) {
    const { clock, coordinator, writes } = createHarness();
    const book = { id: `book-repeat-${iteration}`, progress: { audioTime: iteration } };
    coordinator.schedule(book, 10);
    if (iteration % 2 === 0) await coordinator.invalidateBook(book.id);
    else await coordinator.invalidateAll([book.id]);
    await clock.tick(20);
    await coordinator.waitForIdle();
    assert.deepEqual(writes, []);
  }
});
