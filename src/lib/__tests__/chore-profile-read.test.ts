/** Source authored only: canonical hydration never grants action authority. */
import { hydrateChoreProfileMembers, CHORE_PROFILE_READ_BATCH } from "../chore-profile-read";
const member = (id: string) => ({ id, family_id: "family-a", name: "Fixture", role: "child", age: 3,
  archived_at: null as Date | null, erasure_user_id: null, legacy_mapping: null, account_link: null });
it("skips unrelated account-only rows and clears any prehydrated value", async () => {
  const findMany = jest.fn();
  expect(await hydrateChoreProfileMembers({ householdMember: { findMany } } as never, "family-a",
    [{ id: "chore-a", assigned_member_id: null, assigneeMember: member("old") }]))
    .toEqual([{ id: "chore-a", assigned_member_id: null, assigneeMember: undefined }]);
  expect(findMany).not.toHaveBeenCalled();
});
it("deduplicates profile IDs, preserves row order and retains archived history", async () => {
  const archived = { ...member("member-a"), archived_at: new Date("2026-10-01T12:00:00Z") };
  const findMany = jest.fn(async () => [archived]);
  const rows = [{ id: "chore-a", assigned_member_id: "member-a" }, { id: "chore-b", assigned_member_id: "member-a" }];
  expect(await hydrateChoreProfileMembers({ householdMember: { findMany } } as never, "family-a", rows))
    .toEqual(rows.map(row => ({ ...row, assigneeMember: archived })));
  expect(findMany).toHaveBeenCalledWith(expect.objectContaining({
    where: { family_id: "family-a", id: { in: ["member-a"] } }, take: 1,
  }));
});
it("hydrates a later batch and preserves unavailable subjects as null", async () => {
  const rows = Array.from({ length: CHORE_PROFILE_READ_BATCH + 1 }, (_, i) => ({ id: `chore-${i}`, assigned_member_id: `member-${i}` }));
  const findMany = jest.fn(async ({ where }: { where: { family_id: string; id: { in: string[] } } }) =>
    where.id.in.filter(id => id !== "member-0").map(member));
  const result = await hydrateChoreProfileMembers({ householdMember: { findMany } } as never, "family-a", rows);
  expect(findMany).toHaveBeenCalledTimes(2);
  expect(findMany.mock.calls.every(([query]) => query.where.family_id === "family-a" && query.where.id.in.length <= CHORE_PROFILE_READ_BATCH)).toBe(true);
  expect(result[0].assigneeMember).toBeNull();
  expect(result[result.length - 1].assigneeMember?.id).toBe(`member-${CHORE_PROFILE_READ_BATCH}`);
});
it.each([
  [{ ...member("member-a"), family_id: "family-b" }],
  [member("unrequested")],
  [member("member-a"), member("member-a")],
].map(rows => [rows] as const))("refuses unexpected household/ID/duplicate results", async rows => {
  const findMany = jest.fn(async () => rows);
  await expect(hydrateChoreProfileMembers({ householdMember: { findMany } } as never,
    "family-a", [{ assigned_member_id: "member-a" }])).rejects.toThrow();
});
it("propagates a later batch failure rather than returning a partial map", async () => {
  const findMany = jest.fn().mockResolvedValueOnce([]).mockRejectedValueOnce(new Error("Fixture unavailable"));
  const rows = Array.from({ length: CHORE_PROFILE_READ_BATCH + 1 }, (_, i) => ({ assigned_member_id: `member-${i}` }));
  await expect(hydrateChoreProfileMembers({ householdMember: { findMany } } as never, "family-a", rows))
    .rejects.toThrow("Fixture unavailable");
});
