import { NOTE_CREATE_RECOVERY_OWNER_HEADER } from "./note-create-recovery-identity";
/** Exact mounted-note create intent. No storage, background replay or second write path. */
import { newIdempotencyKey, isValidIdempotencyKey, IDEMPOTENCY_HEADER } from "./idempotency-key";
import { requestOwnedJson } from "./owned-request-http";
export const NOTE_CREATE_RETRY_MS = 24 * 60 * 60 * 1000;
export type NoteCreateContext = { userId: string; familyId: string };
export type NoteCreateDraft = { title: string; body: string; color: string };
export type NoteCreateIntent = { key: string; body: string; context: NoteCreateContext; issuedAt: number };
export function noteCreateContext(value: unknown): NoteCreateContext | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  return typeof row.userId === "string" && row.userId.length > 0 && row.userId.length <= 128 &&
    typeof row.familyId === "string" && row.familyId.length > 0 && row.familyId.length <= 128
    ? { userId: row.userId, familyId: row.familyId } : null;
}
export function makeNoteCreateIntent(draft: NoteCreateDraft, context: NoteCreateContext, key = newIdempotencyKey()): NoteCreateIntent {
  const title = draft.title.trim(), body = draft.body.trim();
  if (!isValidIdempotencyKey(key) || !title || title.length > 200 || body.length > 10000 ||
    !["yellow", "pink", "blue", "green", "purple"].includes(draft.color) || !noteCreateContext(context))
    throw new Error("Invalid note draft");
  return { key, context: { ...context }, issuedAt: Date.now(), body: JSON.stringify({ title, body, color: draft.color,
    expected_user_id: context.userId, expected_family_id: context.familyId }) };
}
export type NoteCreateOutcome = { kind: "removed"; noteId: string } | { kind: "confirmed"; noteId: string } | { kind: "unknown" } |
  { kind: "refused"; code: string; message?: string };
export async function postNoteCreate(intent: NoteCreateIntent, options: { recovery?: boolean; ownerScope?: string } = {}): Promise<NoteCreateOutcome> {
  const age = Date.now() - intent.issuedAt;
  // Stay well inside the seven-day server key retention. A stale mounted page holds.

  if (options.recovery) {
    const receipt = await inspectNoteCreateReceipt(intent, options.ownerScope);
    if (receipt.state === "present" || receipt.state === "removed")
      return { kind: receipt.state === "present" ? "confirmed" : "removed", noteId: receipt.noteId };
    if (receipt.state !== "unissued") return { kind: "unknown" };
  }
  if (age < 0 || age > NOTE_CREATE_RETRY_MS) return { kind: "refused", code: "NOTE_RECOVERY_EXPIRED" };
  const result = await requestOwnedJson("/api/notes", { method: "POST", headers: {
    "Content-Type": "application/json", [IDEMPOTENCY_HEADER]: intent.key,
    ...(options.ownerScope ? { [NOTE_CREATE_RECOVERY_OWNER_HEADER]: options.ownerScope } : {}),
  }, body: intent.body }, 256 * 1024);
  if (result.kind !== "reply") return { kind: "unknown" };
  const value = result.body as { note?: { id?: unknown; family_id?: unknown; created_by?: unknown }; error?: unknown } | null;
  if (result.response.ok) {
    const note = value?.note;
    return note && typeof note.id === "string" && note.id.length > 0 && note.id.length <= 128 &&
      note.family_id === intent.context.familyId && note.created_by === intent.context.userId
      ? { kind: "confirmed", noteId: note.id } : { kind: "unknown" };
  }
  const error = value?.error;
  const code = error && typeof error === "object" && "code" in error && typeof error.code === "string" ? error.code : "NOTE_CREATE_REFUSED";
  if (result.response.status >= 500 || result.response.status === 408 || code === "IDEMPOTENCY_IN_PROGRESS") return { kind: "unknown" };
  return { kind: "refused", code, ...(typeof error === "string" ? { message: error } : {}) };
}

export type NoteReceiptInspection = { state: "present" | "removed"; noteId: string } |
  { state: "unissued" | "pending" | "expired" | "unavailable" | "unknown" };
/** Shared read-only preflight for mounted recovery and the owned journal adapter. */
export async function inspectNoteCreateReceipt(intent: NoteCreateIntent, ownerScope?: string): Promise<NoteReceiptInspection> {
  // Read-only inspection may still resolve an old committed request. Only sends
  // have the shorter client window; server receipt expiry remains authoritative.
  const result = await requestOwnedJson("/api/notes/create/receipt", { method: "POST", headers: {
    "Content-Type": "application/json", [IDEMPOTENCY_HEADER]: intent.key,
    ...(ownerScope ? { [NOTE_CREATE_RECOVERY_OWNER_HEADER]: ownerScope } : {}),
  }, body: intent.body }, 32 * 1024);
  if (result.kind !== "reply" || !result.response.ok) return { state: "unknown" };
  const receipt = result.body as { state?: unknown; noteId?: unknown } | null;
  if ((receipt?.state === "present" || receipt?.state === "removed") && typeof receipt.noteId === "string" && receipt.noteId.length > 0 && receipt.noteId.length <= 128)
    return { state: receipt.state, noteId: receipt.noteId };
  if (receipt?.state === "unissued" || receipt?.state === "pending" || receipt?.state === "expired" || receipt?.state === "unavailable")
    return { state: receipt.state };
  return { state: "unknown" };
}
