const DATABASE = 'club-draft-media';
const STORE = 'photos';
const MARKER = 'club:kept-draft:media:';

let pending = Promise.resolve();
let generation = 0;

export function draftMediaGeneration() {
  return generation;
}

export function mayHaveDraftMedia(key: string): boolean {
  try {
    return localStorage.getItem(MARKER + key) !== null;
  } catch {
    return true;
  }
}

function mark(key: string, kept: boolean) {
  try {
    if (kept) localStorage.setItem(MARKER + key, '1');
    else localStorage.removeItem(MARKER + key);
  } catch {
    // IndexedDB may still be available.
  }
}

function openMedia() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DATABASE, 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore(STORE);
    };
    request.onsuccess = () => {
      request.result.onversionchange = () => {
        request.result.close();
      };
      resolve(request.result);
    };
    request.onblocked = request.onerror = () => {
      reject(new Error('Draft storage did not open.'));
    };
  });
}

function transact<T>(
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const task = pending.then(async () => {
    const db = await openMedia();
    try {
      return await new Promise<T>((resolve, reject) => {
        const transaction = db.transaction(STORE, mode);
        const request = run(transaction.objectStore(STORE));
        transaction.oncomplete = () => {
          resolve(request.result);
        };
        transaction.onerror = transaction.onabort = () => {
          reject(transaction.error ?? new Error('Draft storage did not save.'));
        };
      });
    } finally {
      db.close();
    }
  });
  pending = task.then(
    () => undefined,
    () => undefined,
  );
  return task;
}

export function readDraftMedia(key: string): Promise<unknown> {
  return transact('readonly', (store) => store.get(key));
}

export async function writeDraftMedia(
  key: string,
  value: unknown,
  scope: number,
): Promise<boolean> {
  if (scope !== generation) return false;
  mark(key, value !== undefined);
  try {
    if (value === undefined) await transact('readwrite', (store) => store.delete(key));
    else await transact('readwrite', (store) => store.put(value, key));
    return scope === generation;
  } catch {
    return false;
  }
}

export function forgetDraftMedia(): Promise<unknown> {
  generation += 1;
  if (typeof indexedDB === 'undefined') return Promise.resolve();
  return transact('readwrite', (store) => store.clear()).catch(() => undefined);
}
