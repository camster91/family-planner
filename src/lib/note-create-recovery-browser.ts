/** Explicit note recovery adoption. Importing does not read/write storage or send. */
import { queueStoreCandidates, type StorageLike } from "./offline-queue";
import { ownedQueueLocation } from "./owned-queue-persistence";
import { createNoteRecoveryStore } from "./note-create-recovery-store";
import { OwnedRequestRecoveryError } from "./owned-request-journal";
import { newIdempotencyKey } from "./idempotency-key";
import { requestOwnedJson } from "./owned-request-http";
import { noteRecoveryContext, noteIntentFromEntry } from "./note-create-recovery-contract";
import { inspectNoteCreateReceipt, NOTE_CREATE_RETRY_MS, type NoteCreateContext } from "./note-create-client";
export async function readNoteRecoveryContext() {
  const result = await requestOwnedJson("/api/notes/recovery", { method: "GET" }, 32 * 1024);
  if (result.kind !== "reply") throw new OwnedRequestRecoveryError("UNAVAILABLE");
  if (!result.response.ok) throw new OwnedRequestRecoveryError([400, 401, 403].includes(result.response.status) ? "OWNER_CHANGED" : "UNAVAILABLE");
  return noteRecoveryContext.parse(result.body);
}
export function browserNoteRecovery(original: NoteCreateContext) {
  let localStorage: StorageLike | null = null, indexedDB: IDBFactory | null = null;
  try { localStorage = window.localStorage; } catch { /* No unowned fallback. */ }
  try { indexedDB = window.indexedDB ?? null; } catch { /* Explicit storage hold. */ }
  return createNoteRecoveryStore({ runtime: newIdempotencyKey(),
    resolveContext: async () => {
      const context = await readNoteRecoveryContext();
      if (context.userId !== original.userId || context.familyId !== original.familyId)
        throw new OwnedRequestRecoveryError("OWNER_CHANGED");
      return context;
    },
    candidates: owner => queueStoreCandidates(ownedQueueLocation(owner), { localStorage, indexedDB }).candidates,
    reviewRecovered: async (entry, context) => {
      const age = Date.now() - entry.issuedAt;
      return age >= 0 && age <= NOTE_CREATE_RETRY_MS &&
        (await inspectNoteCreateReceipt(noteIntentFromEntry(entry), context.owner?.scope)).state === "unissued";
    },
  });
}

export { noteIntentFromEntry } from "./note-create-recovery-contract";
