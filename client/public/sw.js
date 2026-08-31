const CACHE_NAME = "bm-app-shell-v3";
const SYNC_TAG = "checkout-sync";
const PUNCH_SYNC_TAG = "punch-sync";

// App shell assets to pre-cache on install
const APP_SHELL = ["/", "/index.html"];

// ── Install ────────────────────────────────────────────────────────────────
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL))
  );
  self.skipWaiting();
});

// ── Activate ───────────────────────────────────────────────────────────────
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// ── Fetch ──────────────────────────────────────────────────────────────────
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);

  // API and WebSocket: network-only
  if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/ws")) return;

  // Navigation: network-first, fall back to app shell
  if (event.request.mode === "navigate") {
    event.respondWith(
      fetch(event.request).catch(() =>
        caches.match("/index.html").then((r) => r || fetch(event.request))
      )
    );
    return;
  }

  // Static assets: cache-first
  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;
      return fetch(event.request).then((response) => {
        if (!response || response.status !== 200 || response.type !== "basic") return response;
        const toCache = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, toCache));
        return response;
      });
    })
  );
});

// ── Background Sync ────────────────────────────────────────────────────────
self.addEventListener("sync", (event) => {
  if (event.tag === SYNC_TAG) {
    event.waitUntil(syncPendingCheckouts());
  }
  if (event.tag === PUNCH_SYNC_TAG) {
    event.waitUntil(syncPendingPunches());
  }
});

async function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open("business_manager_offline", 3);
    req.onerror = () => reject(req.error);
    req.onsuccess = () => resolve(req.result);
    req.onupgradeneeded = () => {
      const db = req.result;
      // Must mirror upgrade() in client/src/lib/offline-db.ts exactly: whichever
      // context opens the database first runs this, and if only one of the two
      // knows about a store, the other gets a missing-store error forever.
      if (!db.objectStoreNames.contains("checkouts")) {
        const store = db.createObjectStore("checkouts", { keyPath: "id" });
        store.createIndex("sequence", "sequence", { unique: false });
        store.createIndex("status", "status", { unique: false });
      }
      if (!db.objectStoreNames.contains("punches")) {
        const store = db.createObjectStore("punches", { keyPath: "id" });
        store.createIndex("status", "status", { unique: false });
      }
    };
  });
}

async function getAllPending(db) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction("checkouts", "readonly");
    const req = tx.objectStore("checkouts").getAll();
    req.onerror = () => reject(req.error);
    req.onsuccess = () => {
      const all = (req.result ?? []).filter(
        (r) => r.status === "pending" && (r.nextRetryAt === null || r.nextRetryAt <= Date.now())
      );
      resolve(all.sort((a, b) => a.sequence - b.sequence));
    };
  });
}

async function updateRecord(db, id, changes) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction("checkouts", "readwrite");
    const store = tx.objectStore("checkouts");
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

const RETRY_DELAYS = [30_000, 120_000, 600_000, 1_800_000];
const MAX_RETRIES = 4;

async function syncPendingCheckouts() {
  let db;
  try {
    db = await openDB();
  } catch {
    return; // IndexedDB unavailable in SW context
  }

  const pending = await getAllPending(db);
  let synced = 0;

  for (const item of pending) {
    const now = Date.now();
    await updateRecord(db, item.id, { status: "syncing", lastAttemptAt: now });

    try {
      const response = await fetch("/api/sales/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(item.payload),
        credentials: "include",
      });

      if (response.ok) {
        const data = await response.json();
        await updateRecord(db, item.id, {
          status: "done",
          syncedCheckoutIds: data.checkoutIds ?? [],
          lastError: null,
        });
        synced++;
      } else {
        let errMsg = "Server error";
        try { const b = await response.json(); errMsg = b.error?.message ?? b.error ?? errMsg; } catch {}
        const newAttempts = (item.attempts ?? 0) + 1;
        const exceeded = newAttempts >= MAX_RETRIES;
        await updateRecord(db, item.id, {
          status: exceeded ? "failed" : "pending",
          attempts: newAttempts,
          lastError: typeof errMsg === "string" ? errMsg : "Server error",
          nextRetryAt: exceeded ? null : now + (RETRY_DELAYS[Math.min(newAttempts, RETRY_DELAYS.length - 1)]),
        });
      }
    } catch {
      const newAttempts = (item.attempts ?? 0) + 1;
      const exceeded = newAttempts >= MAX_RETRIES;
      await updateRecord(db, item.id, {
        status: exceeded ? "failed" : "pending",
        attempts: newAttempts,
        lastError: "Network error",
        nextRetryAt: exceeded ? null : now + (RETRY_DELAYS[Math.min(newAttempts, RETRY_DELAYS.length - 1)]),
      });
    }
  }

  // Notify all open tabs that sync ran
  if (synced > 0) {
    const clients = await self.clients.matchAll({ type: "window" });
    for (const client of clients) {
      client.postMessage({ type: "SYNC_COMPLETE", synced });
    }
  }
}

// ── Clock-in replay ────────────────────────────────────────────────────────
// A punch taken while the phone had no data. The geofence was already checked
// on the device and the coordinates travel with it, so the server can re-verify;
// what it will not take on trust is the timestamp, which is why the payload is
// marked `queued` and the server decides whether to honour the device's clock.

function getAllPendingPunches(db) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction("punches", "readonly");
    const req = tx.objectStore("punches").getAll();
    req.onerror = () => reject(req.error);
    req.onsuccess = () => {
      const now = Date.now();
      const all = req.result || [];
      resolve(
        all
          .filter((r) => r.status !== "done" && r.status !== "failed")
          .filter((r) => !r.nextRetryAt || r.nextRetryAt <= now)
          .sort((a, b) => a.createdAt - b.createdAt),
      );
    };
  });
}

function updatePunchRecord(db, id, changes) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction("punches", "readwrite");
    const store = tx.objectStore("punches");
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

// Statuses that can never succeed on a retry. Retrying these would burn the whole
// backoff budget — forty minutes — on an answer that will not change.
const TERMINAL_PUNCH_STATUSES = [400, 401, 403, 404, 409, 422];

async function syncPendingPunches() {
  let db;
  try {
    db = await openDB();
  } catch {
    return;
  }

  const pending = await getAllPendingPunches(db);
  let synced = 0;

  for (const item of pending) {
    const now = Date.now();
    await updatePunchRecord(db, item.id, { status: "syncing" });

    try {
      const response = await fetch("/api/attendance/punch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(item.payload),
        credentials: "include",
      });

      if (response.ok) {
        await updatePunchRecord(db, item.id, { status: "done", lastError: null });
        synced++;
        continue;
      }

      let errMsg = "Server error";
      try {
        const b = await response.json();
        errMsg = b.error?.message ?? b.error ?? errMsg;
      } catch {}

      if (TERMINAL_PUNCH_STATUSES.includes(response.status)) {
        await updatePunchRecord(db, item.id, {
          status: "failed",
          lastError: typeof errMsg === "string" ? errMsg : "Rejected",
          nextRetryAt: null,
        });
        continue;
      }

      const newAttempts = (item.attempts ?? 0) + 1;
      const exceeded = newAttempts >= MAX_RETRIES;
      await updatePunchRecord(db, item.id, {
        status: exceeded ? "failed" : "pending",
        attempts: newAttempts,
        lastError: typeof errMsg === "string" ? errMsg : "Server error",
        nextRetryAt: exceeded ? null : now + RETRY_DELAYS[Math.min(newAttempts, RETRY_DELAYS.length - 1)],
      });
    } catch {
      const newAttempts = (item.attempts ?? 0) + 1;
      const exceeded = newAttempts >= MAX_RETRIES;
      await updatePunchRecord(db, item.id, {
        status: exceeded ? "failed" : "pending",
        attempts: newAttempts,
        lastError: "Network error",
        nextRetryAt: exceeded ? null : now + RETRY_DELAYS[Math.min(newAttempts, RETRY_DELAYS.length - 1)],
      });
    }
  }

  if (synced > 0) {
    const clients = await self.clients.matchAll({ type: "window" });
    for (const client of clients) {
      client.postMessage({ type: "PUNCH_SYNC_COMPLETE", synced });
    }
  }
}
