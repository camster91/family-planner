/** Source cases only; mocked locks do not prove PostgreSQL concurrency. */
jest.mock("next/server", () => require("@/__tests__/helpers/two-household").nextServerMock);
import { inspectPersonNoteReceipt } from "../person-note-receipt";
import { hashIdempotentRequest } from "../idempotency";
const actor = { userId: "account-a", familyId: "family-a", role: "parent", generation: 0 };
const input = { title: "Original", body: "Original body", color: "yellow", expected_user_id: actor.userId, expected_family_id: actor.familyId };
const now = new Date("2026-10-25T12:00:00Z");
function setup() {
  const record = { action: "note.create", request_hash: hashIdempotentRequest("note.create", input), response_status: 201 as number | null,
    response_body: { note: { id: "note-a", family_id: actor.familyId, created_by: actor.userId, body: "Private original content" } } as unknown,
    expires_at: new Date("2026-10-30T12:00:00Z") };
  const tx = { $queryRaw: jest.fn(async () => []),
    user: { findUnique: jest.fn().mockResolvedValue({ family_id: actor.familyId, role: actor.role, token_version: 0 }) },
    family: { findUnique: jest.fn().mockResolvedValue({ features: { notes: true } }) },
    idempotencyRecord: { findFirst: jest.fn().mockResolvedValue(record) },
    pinnedNote: { findFirst: jest.fn().mockResolvedValue({ id: "note-a" }) } };
  const db = { $transaction: async (work: (value: typeof tx) => Promise<unknown>) => work(tx) } as never;
  return { db, tx, record };
}
it("returns only current presence or removal, never cached note content", async () => {
  const { db, tx } = setup();
  expect(await inspectPersonNoteReceipt(db, actor, "fixture-key-00000001", input, now))
    .toEqual({ status: 200, body: { state: "present", noteId: "note-a" } });
  expect(tx.idempotencyRecord.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: {
    scope: "user:account-a", key: "fixture-key-00000001", family_id: actor.familyId, user_id: actor.userId,
  } }));
  expect(tx.pinnedNote.findFirst).toHaveBeenCalledWith({ where: { id: "note-a", family_id: actor.familyId }, select: { id: true } });
  tx.pinnedNote.findFirst.mockResolvedValue(null);
  expect(await inspectPersonNoteReceipt(db, actor, "fixture-key-00000001", input, now))
    .toEqual({ status: 200, body: { state: "removed", noteId: "note-a" } });
});
it("renews current session and owner expectation before receipt reads", async () => {
  const { db, tx } = setup();
  expect((await inspectPersonNoteReceipt(db, actor, "fixture-key-00000001", { ...input, expected_family_id: "family-b" }, now)).status).toBe(409);
  expect(tx.idempotencyRecord.findFirst).not.toHaveBeenCalled();
  tx.user.findUnique.mockResolvedValue({ family_id: actor.familyId, role: actor.role, token_version: 1 });
  expect((await inspectPersonNoteReceipt(db, actor, "fixture-key-00000001", input, now)).status).toBe(401);
  expect(tx.idempotencyRecord.findFirst).not.toHaveBeenCalled();
});
it.each(["pending", "expired", "malformed", "unissued", "hash"])("holds %s receipts without reading a note or executing an effect", async state => {
  const { db, tx, record } = setup();
  if (state === "pending") record.response_status = null;
  if (state === "expired") record.expires_at = new Date("2026-10-01T12:00:00Z");
  if (state === "malformed") record.response_body = { success: true };
  if (state === "unissued") tx.idempotencyRecord.findFirst.mockResolvedValue(null);
  if (state === "hash") record.request_hash = "different-request";
  const result = await inspectPersonNoteReceipt(db, actor, "fixture-key-00000001", input, now);
  expect(result).toMatchObject(state === "hash" ? { status: 422 } : { status: 200, body: { state: state === "malformed" ? "unavailable" : state } });
  expect(tx.pinnedNote.findFirst).not.toHaveBeenCalled();
});
