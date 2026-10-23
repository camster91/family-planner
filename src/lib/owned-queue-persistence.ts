/** Browser-owned queue journals. No credential, provider, replay or domain writes. */
import {
  ownedQueueEnvelope,
  RETIRED_QUEUE_ENVELOPE,
  type QueueOwner,
  type QueueRetirement,
} from "@/lib/queue-owner-contract";
import type { StorageLike } from "@/lib/offline-queue";

const owners = new Map<string, QueueOwner>();
const STORE = "kv"; // Existing queue IndexedDB adapter's object-store contract.
export const ownedQueueDatabase = (kind: QueueOwner["kind"]) =>
  `fp-owned-${kind}`;
export const ownedQueuePrefix = (kind: QueueOwner["kind"]) =>
  `fp-owned:v2:${kind}:`;
export function ownedQueueLocation(owner: QueueOwner) {
  return {
    dbName: ownedQueueDatabase(owner.kind),
    key: `${ownedQueuePrefix(owner.kind)}${owner.scope}`,
  };
}
export function rememberQueueOwner(owner: QueueOwner) {
  owners.set(`${owner.kind}:${owner.scope}`, owner);
}
/** Capture before an await; later registrations cannot expand an old purge. */
export function captureQueueRetirements(
  kind: QueueOwner["kind"],
): QueueRetirement[] {
  return [...owners.values()]
    .filter((owner) => owner.kind === kind)
    .map((owner) => ({ mode: "scope", owner: { ...owner } }));
}
export class OwnedQueueLeaseError extends Error {
  constructor() {
    super("Saved work is being used elsewhere or locking is unavailable.");
    this.name = "OwnedQueueLeaseError";
  }
}
/** Non-waiting exclusive lease. No unsupported-lock fallback or retry spin. */
export function withOwnedQueueLease<T>(
  owner: QueueOwner,
  run: () => Promise<T>,
  locks: Pick<LockManager, "request"> | null = typeof navigator === "undefined"
    ? null
    : (navigator.locks ?? null),
): Promise<T> {
  return withQueueLease(
    `herewoven-owned-queue:${owner.kind}:${owner.scope}`,
    run,
    locks,
  );
}
export async function withQueueLease<T>(
  name: string,
  run: () => Promise<T>,
  locks: Pick<LockManager, "request"> | null = typeof navigator === "undefined"
    ? null
    : (navigator.locks ?? null),
): Promise<T> {
  if (!locks) return Promise.reject(new OwnedQueueLeaseError());
  return await locks.request(
    name,
    { mode: "exclusive", ifAvailable: true },
    async (lock) => {
      if (!lock) throw new OwnedQueueLeaseError();
      return run();
    },
  );
}
type Env = {
  storage: StorageLike | null;
  indexedDB: IDBFactory | null;
  locks?: Pick<LockManager, "request"> | null;
};
function matches(owner: QueueOwner, retirement: QueueRetirement) {
  if (retirement.mode === "household")
    return owner.householdScope === retirement.householdScope;
  if (retirement.mode === "device")
    return owner.kind === "device" && owner.ownerId === retirement.ownerId;
  return retirement.mode === "generation"
    ? owner.kind === "person" &&
        owner.ownerId === retirement.ownerId &&
        owner.generation <= retirement.throughGeneration
    : owner.kind === retirement.owner.kind &&
        owner.ownerId === retirement.owner.ownerId &&
        owner.scope === retirement.owner.scope;
}
function readOwner(key: IDBValidKey, value: unknown, kind: QueueOwner["kind"]) {
  if (
    typeof key !== "string" ||
    !key.startsWith(ownedQueuePrefix(kind)) ||
    typeof value !== "string"
  )
    return null;
  try {
    const parsed = ownedQueueEnvelope.safeParse(JSON.parse(value));
    if (
      !parsed.success ||
      parsed.data.state !== "active" ||
      parsed.data.owner.kind !== kind ||
      ownedQueueLocation(parsed.data.owner).key !== key
    )
      return null;
    return parsed.data.owner;
  } catch {
    return null;
  }
}
function open(dbFactory: IDBFactory, name: string): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    let settled = false;
    let request: IDBOpenDBRequest;
    try {
      request = dbFactory.open(name, 1);
    } catch {
      reject(new Error("Queue storage unavailable"));
      return;
    }
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE))
        request.result.createObjectStore(STORE);
    };
    request.onsuccess = () => {
      if (settled) {
        request.result.close();
        return;
      }
      settled = true;
      request.result.onversionchange = () => request.result.close();
      resolve(request.result);
    };
    const fail = () => {
      if (!settled) {
        settled = true;
        reject(new Error("Queue storage unavailable"));
      }
    };
    request.onerror = fail;
    request.onblocked = fail;
  });
}
function targets(
  db: IDBDatabase,
  kind: QueueOwner["kind"],
  retirement: QueueRetirement,
): Promise<Array<{ key: string; owner: QueueOwner }>> {
  return new Promise((resolve, reject) => {
    const found: Array<{ key: string; owner: QueueOwner }> = [];
    const tx = db.transaction(STORE, "readonly");
    const cursor = tx.objectStore(STORE).openCursor();
    cursor.onsuccess = () => {
      const row = cursor.result;
      if (!row) return;
      const owner = readOwner(row.key, row.value, kind);
      if (owner && typeof row.key === "string" && matches(owner, retirement))
        found.push({ key: row.key, owner });
      row.continue();
    };
    tx.oncomplete = () => resolve(found);
    tx.onerror = () => reject(new Error("Queue cleanup unavailable"));
    tx.onabort = tx.onerror;
  });
}
function retireIndexedKey(
  db: IDBDatabase,
  key: string,
  kind: QueueOwner["kind"],
  retirement: QueueRetirement,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    const store = tx.objectStore(STORE);
    const read = store.get(key);
    read.onsuccess = () => {
      // Recheck in this write transaction. A late cleanup never uses a stale
      // enumerated value to overwrite a replacement generation or other owner.
      const owner = readOwner(key, read.result, kind);
      if (owner && matches(owner, retirement))
        store.put(RETIRED_QUEUE_ENVELOPE, key);
    };
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(new Error("Queue cleanup unavailable"));
    tx.onabort = tx.onerror;
  });
}
/**
 * Exact old-scope or server-revoked-generation retirement, including unloaded
 * journals. Never deletes a whole owned database or an unclassified future row.
 */
export async function retireOwnedQueueRecords(
  retirement: QueueRetirement,
  env: Env,
): Promise<boolean> {
  const kinds: QueueOwner["kind"][] =
    retirement.mode === "household"
      ? ["person", "device"]
      : [
          retirement.mode === "generation"
            ? "person"
            : retirement.mode === "device"
              ? "device"
              : retirement.owner.kind,
        ];
  const results = await Promise.allSettled(
    kinds.map((kind) => retireKindRecords(retirement, env, kind)),
  );
  return results.every(
    (result) => result.status === "fulfilled" && result.value,
  );
}

async function retireKindRecords(
  retirement: QueueRetirement,
  env: Env,
  kind: QueueOwner["kind"],
): Promise<boolean> {
  const found = new Map<
    string,
    { owner: QueueOwner; local: boolean; indexed: boolean }
  >();
  let complete = true;
  // Snapshot synchronous localStorage keys before any await.
  if (env.storage) {
    try {
      for (let index = 0; index < env.storage.length; index++) {
        const key = env.storage.key(index);
        if (!key) continue;
        const owner = readOwner(key, env.storage.getItem(key), kind);
        if (owner && matches(owner, retirement))
          found.set(key, { owner, local: true, indexed: false });
      }
    } catch {
      complete = false;
    }
  }
  let db: IDBDatabase | null = null;
  if (env.indexedDB) {
    try {
      db = await open(env.indexedDB, ownedQueueDatabase(kind));
      for (const item of await targets(db, kind, retirement)) {
        const prior = found.get(item.key);
        found.set(item.key, {
          owner: item.owner,
          local: prior?.local ?? false,
          indexed: true,
        });
      }
    } catch {
      complete = false;
    }
  }
  try {
    for (const [key, target] of found) {
      try {
        await withOwnedQueueLease(
          target.owner,
          async () => {
            let localFailed = false;
            if (target.local && env.storage) {
              try {
                const owner = readOwner(key, env.storage.getItem(key), kind);
                if (owner && matches(owner, retirement))
                  env.storage.setItem(key, RETIRED_QUEUE_ENVELOPE);
              } catch {
                localFailed = true;
              }
            }
            // Try every known physical copy even if another one failed.
            if (target.indexed && db)
              await retireIndexedKey(db, key, kind, retirement);
            if (localFailed) throw new Error("Queue cleanup unavailable");
          },
          env.locks,
        );
      } catch {
        complete = false;
      }
    }
  } finally {
    db?.close();
  }
  return complete;
}
