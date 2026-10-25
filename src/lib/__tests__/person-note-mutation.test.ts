/** Authored/unrun; mocked transactions establish decisions, not PG lock/rollback behavior. */
import { mutatePersonNote } from "../person-note-mutation";
import { updateNoteSchema } from "../validations";
const actor = { userId: "account-a", familyId: "family-a", role: "parent", generation: 0 };
function setup(role = "parent", creator = actor.userId) {
  const tx = {
    $queryRaw: jest.fn().mockResolvedValue([]),
    user: { findUnique: jest.fn().mockResolvedValue({ family_id: actor.familyId, role, token_version: 0 }) },
    family: { findUnique: jest.fn().mockResolvedValue({ features: { notes: true } }) },
    pinnedNote: {
      findFirst: jest.fn().mockResolvedValue({ created_by: creator }),
      update: jest.fn().mockResolvedValue({ id: "note-a" }), delete: jest.fn().mockResolvedValue({ id: "note-a" }),
    },
  };
  const db = { $transaction: async (work: (transaction: typeof tx) => Promise<unknown>) => work(tx) };
  return { tx, db: db as never, currentActor: { ...actor, role } };
}
it.each(["parent", "teen", "child"])("preserves %s editing an owned note and existing normalization", async role => {
  const { tx, db, currentActor } = setup(role);
  const result = await mutatePersonNote(db, currentActor, { kind: "edit", input: updateNoteSchema.parse({ id: "note-a", body: "  fixture  ", color: "unknown" }) });
  expect(result.status).toBe(200);
  expect(tx.pinnedNote.update).toHaveBeenCalledWith({ where: { id: "note-a", family_id: actor.familyId }, data: { body: "fixture", color: "yellow" } });
  expect(tx.$queryRaw.mock.calls[0].slice(1)).toEqual(["user-membership:account-a"]);
  expect(tx.$queryRaw.mock.calls[1].slice(1)).toEqual(["household-membership:family-a"]);
  expect(tx.$queryRaw.mock.calls[3].slice(1)).toEqual(["note-a", actor.familyId]);
});
it.each(["teen", "child"])("refuses %s editing another current creator's note or deleting their own", async role => {
  const { tx, db, currentActor } = setup(role, "another-account");
  expect((await mutatePersonNote(db, currentActor, { kind: "edit", input: { id: "note-a", title: "Draft" } })).status).toBe(403);
  expect((await mutatePersonNote(db, currentActor, { kind: "delete", id: "note-a" })).status).toBe(403);
  expect(tx.pinnedNote.update).not.toHaveBeenCalled(); expect(tx.pinnedNote.delete).not.toHaveBeenCalled();
});
it("renews a feature disabled after the outer route check before reading or changing the note", async () => {
  const { tx, db } = setup(); tx.family.findUnique.mockResolvedValue({ features: { notes: false } });
  expect((await mutatePersonNote(db, actor, { kind: "edit", input: { id: "note-a", title: "Draft" } })).status).toBe(403);
  expect(tx.pinnedNote.findFirst).not.toHaveBeenCalled(); expect(tx.pinnedNote.update).not.toHaveBeenCalled();
});
it.each([
  { family_id: "family-b", role: "parent", token_version: 0 },
  { family_id: actor.familyId, role: "child", token_version: 0 },
  { family_id: actor.familyId, role: "parent", token_version: 1 }, null,
])("refuses stale household, role or generation before a note lookup", async current => {
  const { tx, db } = setup(); tx.user.findUnique.mockResolvedValue(current);
  expect((await mutatePersonNote(db, actor, { kind: "delete", id: "note-a" })).status).toBe(401);
  expect(tx.pinnedNote.findFirst).not.toHaveBeenCalled(); expect(tx.pinnedNote.delete).not.toHaveBeenCalled();
});
it("keeps parent deletion scoped to a still-owned current record", async () => {
  const { tx, db } = setup("parent", "another-account");
  expect(await mutatePersonNote(db, actor, { kind: "delete", id: "note-a" })).toMatchObject({ status: 200, body: { success: true } });
  expect(tx.pinnedNote.delete).toHaveBeenCalledWith({ where: { id: "note-a", family_id: actor.familyId } });
  tx.pinnedNote.findFirst.mockResolvedValue(null);
  expect((await mutatePersonNote(db, actor, { kind: "delete", id: "note-a" })).status).toBe(404);
  expect(tx.pinnedNote.delete).toHaveBeenCalledTimes(1);
});
