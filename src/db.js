// Простая обёртка над IndexedDB без зависимостей.
// База: reader-db, версия 1.
// Stores:
//   books     — { id, title, author, cover (Blob|null), file (Blob), addedAt }
//   progress  — { bookId, cfi, percentage, updatedAt }
//   settings  — key/value (key = 'app')

const DB_NAME = 'reader-db';
const DB_VERSION = 1;

let dbPromise = null;

function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('books')) {
        const store = db.createObjectStore('books', { keyPath: 'id' });
        store.createIndex('addedAt', 'addedAt');
      }
      if (!db.objectStoreNames.contains('progress')) {
        db.createObjectStore('progress', { keyPath: 'bookId' });
      }
      if (!db.objectStoreNames.contains('settings')) {
        db.createObjectStore('settings');
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function tx(storeName, mode = 'readonly') {
  return openDB().then((db) => db.transaction(storeName, mode).objectStore(storeName));
}

function toPromise(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

// ------- Books -------

export async function addBook(book) {
  const store = await tx('books', 'readwrite');
  return toPromise(store.put(book));
}

export async function getBook(id) {
  const store = await tx('books');
  return toPromise(store.get(id));
}

export async function listBooks() {
  const store = await tx('books');
  const books = await toPromise(store.getAll());
  books.sort((a, b) => (b.addedAt || 0) - (a.addedAt || 0));
  return books;
}

export async function deleteBook(id) {
  const [bStore, pStore] = await Promise.all([
    tx('books', 'readwrite'),
    tx('progress', 'readwrite'),
  ]);
  await Promise.all([toPromise(bStore.delete(id)), toPromise(pStore.delete(id))]);
}

// ------- Progress -------

export async function saveProgress(bookId, cfi, percentage) {
  const store = await tx('progress', 'readwrite');
  return toPromise(
    store.put({ bookId, cfi, percentage, updatedAt: Date.now() })
  );
}

export async function getProgress(bookId) {
  const store = await tx('progress');
  return toPromise(store.get(bookId));
}

// ------- Settings -------

export async function loadSettings() {
  const store = await tx('settings');
  const val = await toPromise(store.get('app'));
  return val || null;
}

export async function saveSettings(settings) {
  const store = await tx('settings', 'readwrite');
  return toPromise(store.put(settings, 'app'));
}
