import { createDemoLibrary, createId } from './core.js';

const DB_NAME = 'reader-local-library';
const DB_VERSION = 1;

let databasePromise;

function requestAsPromise(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Database request failed'));
  });
}

function transactionDone(transaction) {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error('Database transaction failed'));
    transaction.onabort = () => reject(transaction.error ?? new Error('Database transaction was aborted'));
  });
}

export function openDatabase() {
  if (databasePromise) return databasePromise;

  databasePromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const database = request.result;

      if (!database.objectStoreNames.contains('books')) {
        const books = database.createObjectStore('books', { keyPath: 'id' });
        books.createIndex('lastOpenedAt', 'lastOpenedAt');
        books.createIndex('format', 'format');
      }

      if (!database.objectStoreNames.contains('blobs')) {
        database.createObjectStore('blobs', { keyPath: 'id' });
      }

      if (!database.objectStoreNames.contains('annotations')) {
        const annotations = database.createObjectStore('annotations', { keyPath: 'id' });
        annotations.createIndex('bookId', 'bookId');
      }

      if (!database.objectStoreNames.contains('collections')) {
        database.createObjectStore('collections', { keyPath: 'id' });
      }

      if (!database.objectStoreNames.contains('settings')) {
        database.createObjectStore('settings', { keyPath: 'key' });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Unable to open the local library'));
    request.onblocked = () => reject(new Error('The local library is open in another Reader window'));
  });

  return databasePromise;
}

async function getAll(storeName) {
  const database = await openDatabase();
  const transaction = database.transaction(storeName, 'readonly');
  const result = await requestAsPromise(transaction.objectStore(storeName).getAll());
  await transactionDone(transaction);
  return result;
}

async function getOne(storeName, key) {
  const database = await openDatabase();
  const transaction = database.transaction(storeName, 'readonly');
  const result = await requestAsPromise(transaction.objectStore(storeName).get(key));
  await transactionDone(transaction);
  return result;
}

async function putOne(storeName, value) {
  const database = await openDatabase();
  const transaction = database.transaction(storeName, 'readwrite');
  transaction.objectStore(storeName).put(value);
  await transactionDone(transaction);
  return value;
}

async function deleteOne(storeName, key) {
  const database = await openDatabase();
  const transaction = database.transaction(storeName, 'readwrite');
  transaction.objectStore(storeName).delete(key);
  await transactionDone(transaction);
}

function seedLibraryTransaction(transaction) {
  const { books, annotations } = createDemoLibrary();
  const bookStore = transaction.objectStore('books');
  const annotationStore = transaction.objectStore('annotations');
  books.forEach((book) => bookStore.put(book));
  annotations.forEach((annotation) => annotationStore.put(annotation));
  transaction.objectStore('collections').put({
    id: createId('collection'),
    name: 'Thoughtful reads',
    createdAt: new Date().toISOString(),
  });
  transaction.objectStore('settings').put({ key: 'appTheme', value: 'system' });
  transaction.objectStore('settings').put({ key: 'viewMode', value: 'grid' });
  transaction.objectStore('settings').put({ key: 'readerTheme', value: 'paper' });
  transaction.objectStore('settings').put({ key: 'readerFontSize', value: 19 });
  transaction.objectStore('settings').put({ key: 'readerLineHeight', value: 1.7 });
  transaction.objectStore('settings').put({ key: 'readerFont', value: 'serif' });
  transaction.objectStore('settings').put({ key: 'focusMode', value: false });
}

export async function initializeLibrary() {
  const existingBooks = await getAll('books');
  if (existingBooks.length) return loadLibrary();

  const database = await openDatabase();
  const transaction = database.transaction(['books', 'annotations', 'collections', 'settings'], 'readwrite');
  seedLibraryTransaction(transaction);
  await transactionDone(transaction);
  return loadLibrary();
}

export async function loadLibrary() {
  const [books, annotations, collections, settingsRows] = await Promise.all([
    getAll('books'),
    getAll('annotations'),
    getAll('collections'),
    getAll('settings'),
  ]);
  const settings = Object.fromEntries(settingsRows.map(({ key, value }) => [key, value]));
  return { books, annotations, collections, settings };
}

export async function inspectStorageIntegrity() {
  const [books, blobs, annotations] = await Promise.all([
    getAll('books'),
    getAll('blobs'),
    getAll('annotations'),
  ]);
  const bookIds = new Set(books.map((book) => book.id));
  const blobIds = new Set(blobs.map((record) => record.id));
  return {
    orphanBlobIds: blobs.filter((record) => !bookIds.has(record.id)).map((record) => record.id),
    orphanAnnotationIds: annotations
      .filter((annotation) => !bookIds.has(annotation.bookId))
      .map((annotation) => annotation.id),
    missingBlobBookIds: books
      .filter((book) => !book.demo && book.access !== 'restricted' && !blobIds.has(book.id))
      .map((book) => book.id),
  };
}

export async function saveBook(book) {
  const database = await openDatabase();
  const transaction = database.transaction('books', 'readwrite');
  const store = transaction.objectStore('books');
  const existing = await requestAsPromise(store.get(book.id));

  // Progress callbacks are allowed to arrive late, but they may never recreate
  // metadata after an atomic deletion or reset has removed the record.
  if (existing) store.put({ ...book, updatedAt: new Date().toISOString() });
  await transactionDone(transaction);
  return Boolean(existing);
}

export async function saveBookWithBlob(book, blobRecord) {
  const database = await openDatabase();
  const stores = blobRecord ? ['books', 'blobs'] : ['books'];
  const transaction = database.transaction(stores, 'readwrite');
  const completion = transactionDone(transaction);
  try {
    transaction.objectStore('books').put({ ...book, updatedAt: new Date().toISOString() });
    if (blobRecord) transaction.objectStore('blobs').put(blobRecord);
  } catch (error) {
    try {
      transaction.abort();
    } catch {
      // An IndexedDB implementation may already have aborted the transaction.
    }
    await completion.catch(() => {});
    throw error;
  }
  await completion;
  return book;
}

export function getBookBlob(bookId) {
  return getOne('blobs', bookId);
}

export function saveAnnotation(annotation) {
  return putOne('annotations', annotation);
}

export function deleteAnnotation(annotationId) {
  return deleteOne('annotations', annotationId);
}

export function saveCollection(collection) {
  return putOne('collections', collection);
}

export function deleteCollection(collectionId) {
  return deleteOne('collections', collectionId);
}

export function saveSetting(key, value) {
  return putOne('settings', { key, value });
}

export async function deleteBookAndData(bookId) {
  const database = await openDatabase();
  const transaction = database.transaction(['books', 'blobs', 'annotations'], 'readwrite');
  transaction.objectStore('books').delete(bookId);
  transaction.objectStore('blobs').delete(bookId);

  const annotationIndex = transaction.objectStore('annotations').index('bookId');
  const range = IDBKeyRange.only(bookId);
  annotationIndex.openKeyCursor(range).onsuccess = (event) => {
    const cursor = event.target.result;
    if (!cursor) return;
    transaction.objectStore('annotations').delete(cursor.primaryKey);
    cursor.continue();
  };

  await transactionDone(transaction);
}

export async function resetLibrary() {
  const database = await openDatabase();
  const stores = ['books', 'blobs', 'annotations', 'collections', 'settings'];
  const transaction = database.transaction(stores, 'readwrite');
  stores.forEach((store) => transaction.objectStore(store).clear());
  seedLibraryTransaction(transaction);
  await transactionDone(transaction);
  return loadLibrary();
}
