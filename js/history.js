/**
 * Signature history storage using IndexedDB.
 */

const DB_NAME = 'FirmaDB';
const DB_VERSION = 1;
const STORE_NAME = 'signatures';

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: 'id', autoIncrement: true });
        store.createIndex('cedula', 'cedula', { unique: false });
        store.createIndex('date', 'date', { unique: false });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function tx(mode, fn) {
  return openDB().then(db => {
    return new Promise((resolve, reject) => {
      const t = db.transaction(STORE_NAME, mode);
      const store = t.objectStore(STORE_NAME);
      const result = fn(store);
      t.oncomplete = () => { db.close(); resolve(result._result); };
      t.onerror = () => { db.close(); reject(t.error); };
    });
  });
}

export async function saveSignature(entry) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE_NAME, 'readwrite');
    const store = t.objectStore(STORE_NAME);
    const req = store.add({
      imageData: entry.imageData,
      cedula: entry.cedula,
      date: Date.now(),
      method: entry.method,
      pipelineLog: entry.pipelineLog,
      width: entry.width,
      height: entry.height,
    });
    req.onsuccess = () => { db.close(); resolve(req.result); };
    req.onerror = () => { db.close(); reject(req.error); };
  });
}

export async function getAllSignatures() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE_NAME, 'readonly');
    const store = t.objectStore(STORE_NAME);
    const req = store.getAll();
    req.onsuccess = () => { db.close(); resolve(req.result.reverse()); };
    req.onerror = () => { db.close(); reject(req.error); };
  });
}

export async function deleteSignature(id) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE_NAME, 'readwrite');
    const store = t.objectStore(STORE_NAME);
    const req = store.delete(id);
    req.onsuccess = () => { db.close(); resolve(); };
    req.onerror = () => { db.close(); reject(req.error); };
  });
}

export async function clearAllSignatures() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE_NAME, 'readwrite');
    const store = t.objectStore(STORE_NAME);
    const req = store.clear();
    req.onsuccess = () => { db.close(); resolve(); };
    req.onerror = () => { db.close(); reject(req.error); };
  });
}

export async function getCount() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE_NAME, 'readonly');
    const store = t.objectStore(STORE_NAME);
    const req = store.count();
    req.onsuccess = () => { db.close(); resolve(req.result); };
    req.onerror = () => { db.close(); reject(req.error); };
  });
}
