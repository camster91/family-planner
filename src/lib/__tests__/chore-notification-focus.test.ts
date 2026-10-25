// Authored UNRUN: scoped projection/holds only, not PostgreSQL/privacy proof.
jest.mock("@/lib/household-lock", () => ({ lockUser: jest.fn(), lockHousehold: jest.fn() }));
jest.mock("@/lib/features", () => ({ normalizeFeatures: (x: unknown) => x, isFeatureEnabled: (x: Record<string, boolean>) => x?.chores === true }));
jest.mock("@/lib/routine-occurrence-policy", () => ({ hiddenRoutineOccurrenceIds: jest.fn(async () => []) }));
import { readChoreNotificationFocus } from "../chore-notification-focus";
import { hiddenRoutineOccurrenceIds } from "../routine-occurrence-policy";
const owner = { userId: "fixture-parent", familyId: "fixture-family", role: "parent", tokenVersion: 2 };
const row = { id: "fixture-chore", title: "Fixture task", description: "Private instructions", due_date: new Date("2026-10-25T00:00:00.000Z"), status: "pending", assigned_to: owner.userId, assigned_member_id: null, member_subject_erased: false, assignee: { id: owner.userId, name: "Fixture parent", family_id: owner.familyId }, assigneeMember: null };
function setup(role = owner.role) {
  const tx = { $queryRaw: jest.fn().mockResolvedValueOnce([{ family_id: owner.familyId, role, token_version: 2 }]).mockResolvedValueOnce([{ features: { chores: true } }]).mockResolvedValueOnce([{ id: row.id }]),
    chore: { findFirst: jest.fn(async () => row) } };
  return { tx, db: { $transaction: jest.fn(async (work: (x: any) => unknown) => work(tx)) } };
}
beforeEach(() => jest.mocked(hiddenRoutineOccurrenceIds).mockResolvedValue([]));
it("returns only the focused minimal projection within the actor household", async () => {
  const { tx, db } = setup();
  expect(await readChoreNotificationFocus(db as any, owner, row.id)).toEqual({ id: row.id, title: row.title, description: row.description, dueDate: row.due_date.toISOString(), status: "pending", canComplete: true });
  expect(tx.chore.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: row.id, family_id: owner.familyId } }));
  expect(hiddenRoutineOccurrenceIds).toHaveBeenCalledWith(tx, owner.familyId, { ids: [row.id] });
});
it("limits child/teen focus to current account subjects", async () => {
  const { tx, db } = setup("child");
  expect(await readChoreNotificationFocus(db as any, { ...owner, role: "child" }, row.id)).not.toBeNull();
  expect(tx.chore.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: row.id, family_id: owner.familyId, assigned_to: owner.userId } }));
});
it("holds revoked generation before reading any target and hides inactive routine targets", async () => {
  const { tx, db } = setup(); tx.$queryRaw.mockReset().mockResolvedValue([{ family_id: owner.familyId, role: owner.role, token_version: 3 }]);
  expect(await readChoreNotificationFocus(db as any, owner, row.id)).toBeNull(); expect(tx.chore.findFirst).not.toHaveBeenCalled();
  const other = setup(); jest.mocked(hiddenRoutineOccurrenceIds).mockResolvedValue([row.id]);
  expect(await readChoreNotificationFocus(other.db as any, owner, row.id)).toBeNull();
});
it("maps absent, erased and malformed targets to the same unavailable result", async () => {
  const absent = setup(); absent.tx.$queryRaw.mockReset().mockResolvedValueOnce([{ family_id: owner.familyId, role: owner.role, token_version: 2 }]).mockResolvedValueOnce([{ features: { chores: true } }]).mockResolvedValueOnce([]);
  expect(await readChoreNotificationFocus(absent.db as any, owner, row.id)).toBeNull();
  const erased = setup(); erased.tx.chore.findFirst.mockResolvedValue({ ...row, member_subject_erased: true });
  expect(await readChoreNotificationFocus(erased.db as any, owner, row.id)).toBeNull();
  const malformed = setup(); expect(await readChoreNotificationFocus(malformed.db as any, owner, [row.id, "other"])).toBeNull(); expect(malformed.db.$transaction).not.toHaveBeenCalled();
});
