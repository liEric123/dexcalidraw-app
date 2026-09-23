import { dataUrlToBlob } from "./file";

const DB_NAME = "excalidraw-video-deck-blobs";
const STORE = "videos";
const VERSION = 1;

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, VERSION);
      req.onupgradeneeded = () => {
        if (!req.result.objectStoreNames.contains(STORE)) {
          req.result.createObjectStore(STORE);
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  return dbPromise;
}

// Records are Blobs. Legacy records written by older builds are data URL
// strings; they are converted and overwritten in place on read (see
// loadVideoBlobs), so both shapes must be tolerated everywhere records
// are fetched.
type StoredRecord = Blob | string | undefined;

function getRecord(id: string): Promise<StoredRecord> {
  return openDb().then(
    (db) =>
      new Promise((resolve, reject) => {
        const tx = db.transaction(STORE, "readonly");
        const req = tx.objectStore(STORE).get(id);
        req.onsuccess = () => {
          const value = req.result;
          resolve(value instanceof Blob || typeof value === "string" ? value : undefined);
        };
        req.onerror = () => reject(req.error);
      })
  );
}

export async function saveVideoBlob(id: string, blob: Blob): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put(blob, id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

// Loads one record, migrating a legacy string (data URL) record to a Blob.
// The read, conversion, and overwrite all happen inside a single readwrite
// transaction: IndexedDB serializes overlapping readwrite transactions, so a
// concurrent write to the same id (e.g. the user filling this video while
// hydration runs) can never be clobbered: it lands either entirely before
// this transaction (the get then sees a Blob and nothing is written) or
// entirely after it (the user's write wins).
function loadAndMigrateRecord(db: IDBDatabase, id: string): Promise<Blob | undefined> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    const store = tx.objectStore(STORE);
    const req = store.get(id);
    let readOk = false;
    let result: Blob | undefined;
    req.onsuccess = () => {
      readOk = true;
      const value = req.result;
      if (value instanceof Blob) {
        result = value;
      } else if (typeof value === "string") {
        try {
          result = dataUrlToBlob(value); // synchronous — the tx stays open
        } catch {
          return; // unreadable legacy record — omit ("Video missing")
        }
        store.put(result, id);
      }
    };
    tx.oncomplete = () => resolve(result);
    const onFailure = () => {
      // If the read succeeded but the migration write aborted (e.g. quota),
      // keep the converted Blob for playback this session; the legacy string
      // record is untouched and migration retries on the next load.
      if (readOk) resolve(result);
      else reject(tx.error);
    };
    tx.onerror = onFailure;
    tx.onabort = onFailure;
  });
}

// Loads stored videos as Blobs, migrating legacy string records sequentially,
// one video at a time. A record that fails conversion is omitted from the
// result (callers show "Video missing").
export async function loadVideoBlobs(ids: string[]): Promise<Map<string, Blob>> {
  const map = new Map<string, Blob>();
  if (ids.length === 0) return map;
  const db = await openDb();
  for (const id of ids) {
    const blob = await loadAndMigrateRecord(db, id);
    if (blob) map.set(id, blob);
  }
  return map;
}

// Copies a stored video to a new key without materializing its bytes in JS,
// since Blob records are disk-backed handles. Returns the copied Blob so the
// caller can create a playback URL, or null when the source is missing.
export async function copyVideoBlob(sourceId: string, targetId: string): Promise<Blob | null> {
  const record = await getRecord(sourceId);
  let blob: Blob;
  if (record instanceof Blob) {
    blob = record;
  } else if (typeof record === "string") {
    try {
      blob = dataUrlToBlob(record);
    } catch {
      return null;
    }
  } else {
    return null;
  }
  await saveVideoBlob(targetId, blob);
  return blob;
}

export async function deleteVideo(id: string): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}
