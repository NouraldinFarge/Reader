function defaultClone(value) {
  if (typeof globalThis.structuredClone === 'function') return globalThis.structuredClone(value);
  return JSON.parse(JSON.stringify(value));
}

function safelyReportError(onError, error, context) {
  try {
    onError?.(error, context);
  } catch {
    // Error reporting must never create a second unhandled failure.
  }
}

/**
 * Coordinates debounced metadata saves with destructive library operations.
 *
 * A per-book generation invalidates superseded callbacks. A library epoch
 * invalidates every callback captured before reset. Tombstones reject renderer
 * callbacks that arrive after deletion. In-flight work is serialized per book,
 * and invalidation drains work that already began before storage is deleted.
 */
export function createBookSaveCoordinator({
  save,
  onError,
  clone = defaultClone,
  setTimer = globalThis.setTimeout.bind(globalThis),
  clearTimer = globalThis.clearTimeout.bind(globalThis),
} = {}) {
  if (typeof save !== 'function') throw new TypeError('A save function is required.');

  const entries = new Map();
  const tombstones = new Set();
  let libraryEpoch = 0;

  function entryFor(bookId) {
    let entry = entries.get(bookId);
    if (!entry) {
      entry = {
        generation: 0,
        timer: null,
        inFlight: null,
        latestSnapshot: null,
      };
      entries.set(bookId, entry);
    }
    return entry;
  }

  function isCurrent(bookId, entry, epoch, generation) {
    return (
      !tombstones.has(bookId) &&
      libraryEpoch === epoch &&
      entries.get(bookId) === entry &&
      entry.generation === generation
    );
  }

  function queueSnapshot(bookId, entry, snapshot, epoch, generation) {
    const previous = entry.inFlight ?? Promise.resolve(true);
    const operation = previous
      .catch(() => false)
      .then(async () => {
        if (!isCurrent(bookId, entry, epoch, generation)) return false;
        await save(snapshot);
        return true;
      })
      .catch((error) => {
        safelyReportError(onError, error, { bookId, operation: 'save' });
        return false;
      });

    entry.inFlight = operation;
    void operation.finally(() => {
      if (entry.inFlight === operation) entry.inFlight = null;
    });
    return operation;
  }

  function capture(book) {
    if (!book?.id) throw new TypeError('A book with an id is required.');
    return clone(book);
  }

  function schedule(book, delay = 550) {
    const bookId = book?.id;
    if (!bookId || tombstones.has(bookId)) return false;

    const entry = entryFor(bookId);
    if (entry.timer !== null) clearTimer(entry.timer);
    entry.generation += 1;
    entry.latestSnapshot = capture(book);
    const epoch = libraryEpoch;
    const generation = entry.generation;

    entry.timer = setTimer(
      () => {
        entry.timer = null;
        const snapshot = entry.latestSnapshot;
        if (!snapshot || !isCurrent(bookId, entry, epoch, generation)) return;
        void queueSnapshot(bookId, entry, snapshot, epoch, generation);
      },
      Math.max(0, Number(delay) || 0),
    );
    return true;
  }

  async function flush(book) {
    const bookId = book?.id;
    if (!bookId || tombstones.has(bookId)) return false;

    const entry = entryFor(bookId);
    if (entry.timer !== null) {
      clearTimer(entry.timer);
      entry.timer = null;
    }
    entry.generation += 1;
    entry.latestSnapshot = capture(book);
    return queueSnapshot(bookId, entry, entry.latestSnapshot, libraryEpoch, entry.generation);
  }

  async function invalidateBook(bookId) {
    if (!bookId) return;
    tombstones.add(bookId);
    const entry = entries.get(bookId);
    if (!entry) return;

    entry.generation += 1;
    entry.latestSnapshot = null;
    if (entry.timer !== null) {
      clearTimer(entry.timer);
      entry.timer = null;
    }
    await (entry.inFlight ?? Promise.resolve());
    entries.delete(bookId);
  }

  async function invalidateAll(bookIds = []) {
    libraryEpoch += 1;
    for (const bookId of bookIds) {
      if (bookId) tombstones.add(bookId);
    }

    const draining = [];
    for (const [bookId, entry] of entries) {
      tombstones.add(bookId);
      entry.generation += 1;
      entry.latestSnapshot = null;
      if (entry.timer !== null) {
        clearTimer(entry.timer);
        entry.timer = null;
      }
      if (entry.inFlight) draining.push(entry.inFlight);
    }
    await Promise.all(draining);
    entries.clear();
  }

  async function waitForIdle() {
    while (true) {
      const pending = [...entries.values()].map((entry) => entry.inFlight).filter(Boolean);
      if (!pending.length) return;
      await Promise.all(pending);
    }
  }

  function isTombstoned(bookId) {
    return tombstones.has(bookId);
  }

  function reviveBook(bookId) {
    if (bookId) tombstones.delete(bookId);
  }

  function pendingTimerCount() {
    return [...entries.values()].filter((entry) => entry.timer !== null).length;
  }

  return {
    flush,
    invalidateAll,
    invalidateBook,
    isTombstoned,
    pendingTimerCount,
    reviveBook,
    schedule,
    waitForIdle,
  };
}
