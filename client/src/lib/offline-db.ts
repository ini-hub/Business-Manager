const DB_NAME = "business_manager_offline";
// v3 added the `punches` store. IMPORTANT: sw.js opens the same database and must
// declare the identical set of stores at the same version — whichever context
// opens it first runs the upgrade, and the other then gets a missing-store error
// for the lifetime of the install.
const DB_VERSION = 3;
const STORE_NAME = "checkouts";
const PUNCH_STORE = "punches";

export type OfflineCheckoutStatus = "pending" | "syncing" | "failed" | "done";

export interface OfflineCheckout {
  id: string;
  storeId: string;
  payload: any;
  createdAt: number;
  sequence: number;         // insertion order for ordered submission
  status: OfflineCheckoutStatus;
  attempts: number;
  lastError: string | null;
  lastAttemptAt: number | null;
  nextRetryAt: number | null;
  syncedCheckoutIds: string[] | null; // receipt IDs returned from server on success
}

function upgrade(db: IDBDatabase) {
  if (!db.objectStoreNames.contains(STORE_NAME)) {
    const store = db.createObjectStore(STORE_NAME, { keyPath: "id" });
    store.createIndex("sequence", "sequence", { unique: false });
    store.createIndex("status", "status", { unique: false });
  }
  if (!db.objectStoreNames.contains(PUNCH_STORE)) {
    const store = db.createObjectStore(PUNCH_STORE, { keyPath: "id" });
    store.createIndex("status", "status", { unique: false });
  }
}

export type OfflinePunchStatus = "pending" | "syncing" | "failed" | "done";

export interface OfflinePunch {
  id: string;              // also the clientPunchId — the server's replay guard
  payload: any;
  createdAt: number;
  status: OfflinePunchStatus;
  attempts: number;
  lastError: string | null;
  nextRetryAt: number | null;
}

/**
 * Queues a clock-in taken while the phone had no data.
 *
 * GPS works without a network, so the geofence has already been checked on the
 * device and the coordinates travel with the punch — the server re-checks them,
 * so a tampered client still cannot punch in from home. What the server will not
 * take on trust is the timestamp: the payload carries `queued: true` and the
 * device's own clock, and the server decides whether to honour it.
 */
export async function saveOfflinePunch(payload: any): Promise<string> {
  const db = await openOfflineDB();
  const id: string = payload.clientPunchId ?? (crypto.randomUUID
    ? crypto.randomUUID()
    : `punch_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`);

  const record: OfflinePunch = {
    id,
    payload: { ...payload, clientPunchId: id, queued: true },
    createdAt: Date.now(),
    status: "pending",
    attempts: 0,
    lastError: null,
    nextRetryAt: Date.now(),
  };

  return new Promise((resolve, reject) => {
    const tx = db.transaction(PUNCH_STORE, "readwrite");
    const req = tx.objectStore(PUNCH_STORE).put(record);
    req.onerror = () => reject(req.error);
    req.onsuccess = () => {
      if ("serviceWorker" in navigator && "SyncManager" in window) {
        navigator.serviceWorker.ready
          .then((sw) => (sw as any).sync.register("punch-sync"))
          .catch(() => undefined); // non-fatal; the foreground sync still runs
      }
      resolve(id);
    };
  });
}

export async function getOfflinePunches(): Promise<OfflinePunch[]> {
  const db = await openOfflineDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(PUNCH_STORE, "readonly");
    const req = tx.objectStore(PUNCH_STORE).getAll();
    req.onerror = () => reject(req.error);
    req.onsuccess = () => {
      const all = (req.result ?? []) as OfflinePunch[];
      resolve(all.filter(r => r.status !== "done").sort((a, b) => a.createdAt - b.createdAt));
    };
  });
}

export async function updateOfflinePunch(id: string, changes: Partial<OfflinePunch>): Promise<void> {
  const db = await openOfflineDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(PUNCH_STORE, "readwrite");
    const store = tx.objectStore(PUNCH_STORE);
    const getReq = store.get(id);
    getReq.onerror = () => reject(getReq.error);
    getReq.onsuccess = () => {
      const existing = getReq.result;
      if (!existing) { resolve(); return; }
      const putReq = store.put({ ...existing, ...changes });
      putReq.onerror = () => reject(putReq.error);
      putReq.onsuccess = () => resolve();
    };
  });
}

export async function deleteOfflinePunch(id: string): Promise<void> {
  const db = await openOfflineDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(PUNCH_STORE, "readwrite");
    const req = tx.objectStore(PUNCH_STORE).delete(id);
    req.onerror = () => reject(req.error);
    req.onsuccess = () => resolve();
  });
}

// Monotonically increasing counter stored in localStorage per store
function nextSequence(storeId: string): number {
  const key = `offline_seq_${storeId}`;
  const prev = parseInt(localStorage.getItem(key) ?? "0", 10);
  const next = prev + 1;
  localStorage.setItem(key, String(next));
  return next;
}

export function openOfflineDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
    request.onupgradeneeded = () => upgrade(request.result);
  });
}

export async function saveOfflineCheckout(payload: any, storeId: string): Promise<string> {
  const db = await openOfflineDB();
  const id = crypto.randomUUID
    ? crypto.randomUUID()
    : `offline_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;

  const record: OfflineCheckout = {
    id,
    storeId,
    payload,
    createdAt: Date.now(),
    sequence: nextSequence(storeId),
    status: "pending",
    attempts: 0,
    lastError: null,
    lastAttemptAt: null,
    nextRetryAt: Date.now(), // ready immediately
    syncedCheckoutIds: null,
  };

  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    const req = tx.objectStore(STORE_NAME).put(record);
    req.onerror = () => reject(req.error);
    req.onsuccess = () => {
      // Register Background Sync so the SW can submit even if the tab closes
      if ("serviceWorker" in navigator && "SyncManager" in window) {
        navigator.serviceWorker.ready
          .then((sw) => (sw as any).sync.register("checkout-sync"))
          .catch(() => undefined); // non-fatal
      }
      resolve(id);
    };
  });
}

export async function getOfflineCheckouts(): Promise<OfflineCheckout[]> {
  const db = await openOfflineDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    const req = tx.objectStore(STORE_NAME).getAll();
    req.onerror = () => reject(req.error);
    req.onsuccess = () => {
      const all = (req.result ?? []) as OfflineCheckout[];
      // Return in insertion order; exclude permanently done items
      resolve(all.filter(r => r.status !== "done").sort((a, b) => a.sequence - b.sequence));
    };
  });
}

export async function updateOfflineCheckout(id: string, changes: Partial<OfflineCheckout>): Promise<void> {
  const db = await openOfflineDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);
    const getReq = store.get(id);
    getReq.onerror = () => reject(getReq.error);
    getReq.onsuccess = () => {
      const existing = getReq.result;
      if (!existing) { resolve(); return; }
      const putReq = store.put({ ...existing, ...changes });
      putReq.onerror = () => reject(putReq.error);
      putReq.onsuccess = () => resolve();
    };
  });
}

export async function deleteOfflineCheckout(id: string): Promise<void> {
  const db = await openOfflineDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    const req = tx.objectStore(STORE_NAME).delete(id);
    req.onerror = () => reject(req.error);
    req.onsuccess = () => resolve();
  });
}

export async function clearDoneCheckouts(): Promise<void> {
  const db = await openOfflineDB();
  const all: OfflineCheckout[] = await new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    const req = tx.objectStore(STORE_NAME).getAll();
    req.onerror = () => reject(req.error);
    req.onsuccess = () => resolve(req.result ?? []);
  });
  const done = all.filter(r => r.status === "done");
  if (done.length === 0) return;
  const tx = db.transaction(STORE_NAME, "readwrite");
  const store = tx.objectStore(STORE_NAME);
  for (const r of done) store.delete(r.id);
}

// Retry delay in ms: attempt 1→30s, 2→2min, 3→10min, 4+→30min
export function nextRetryDelay(attempts: number): number {
  const delays = [30_000, 120_000, 600_000, 1_800_000];
  return delays[Math.min(attempts, delays.length - 1)];
}

export const MAX_AUTO_RETRIES = 4;
