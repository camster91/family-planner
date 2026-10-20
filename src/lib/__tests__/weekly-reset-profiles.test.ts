/** Canonical-subject source cases; not rendered/DB isolation proof. */
import type { Prisma } from "@prisma/client";
import { defaultFeatures } from "@/lib/features";
import { loadWeeklyResetSummaryInTx } from "@/lib/weekly-reset-summary";
import { isProfileChoreEnabled } from "@/lib/profile-chore-gates";
jest.mock("@/lib/profile-chore-gates", () => ({
  ...jest.requireActual("@/lib/profile-chore-gates"),
  isProfileChoreEnabled: jest.fn(() => true),
}));
jest.mock("@/lib/routine-occurrence-policy", () => ({
  ...jest.requireActual("@/lib/routine-occurrence-policy"),
  routineOccurrencePolicyInTx: jest.fn(async () => "scheduled"),
}));
const scope = { weekStart: "2026-10-19", timeZone: "America/Toronto" };
const actor = {
  userId: "parent-a",
  familyId: "family-a",
  role: "parent",
  emailVerified: true,
};
const profile = {
  id: "profile-a",
  family_id: actor.familyId,
  name: "Test Child",
  role: "child",
  age: 3,
  archived_at: null,
  erasure_user_id: null,
  legacy_mapping: null,
  account_link: null,
};
function fixture(member = profile) {
  const tx = {
    chore: {
      findMany: jest.fn(async () => [
        {
          id: "chore-a",
          title: "Put toys away",
          due_date: new Date("2026-10-20T00:00:00Z"),
          assigned_to: null,
          assigned_member_id: "profile-a",
          member_subject_erased: false,
          assignee: null,
          assigneeMember: member,
        },
      ]),
    },
  };
  return { tx, db: tx as unknown as Prisma.TransactionClient };
}
beforeEach(() => jest.mocked(isProfileChoreEnabled).mockReturnValue(true));
it("previews a valid email-free profile as a named subject, without creating login or exposing identity internals", async () => {
  const { db } = fixture();
  const result = await loadWeeklyResetSummaryInTx(
    db,
    actor,
    defaultFeatures(),
    scope,
    "responsibilities",
  );
  expect(result.groups[0].rows).toEqual([
    {
      title: "Put toys away",
      when: "2026-10-20",
      owner: "assigned",
      ownerName: "Test Child",
      subjectKind: "profile",
    },
  ]);
  expect(result.notes).not.toContain("profileChoresInChores");
  expect(JSON.stringify(result)).not.toContain("profile-a");
  expect(JSON.stringify(result)).not.toContain("erasure_user_id");
});
it.each([
  { family_id: "family-b" },
  { archived_at: new Date() },
  { erasure_user_id: "erasing" },
  { legacy_mapping: { user_id: "someone" } },
  { role: "unknown" },
  { age: 150 },
])(
  "rejects an invalid current profile even if a stale adapter returns it: %j",
  async (patch) => {
    const { db } = fixture({ ...profile, ...patch } as typeof profile);
    const result = await loadWeeklyResetSummaryInTx(
      db,
      actor,
      defaultFeatures(),
      scope,
      "responsibilities",
    );
    expect(result.groups[0].rows).toEqual([]);
    expect(result.notes).toContain("boundedPreview");
  },
);
it("preserves rollout and child/teen own-account boundaries", async () => {
  for (const role of ["child", "teen"]) {
    const { db, tx } = fixture();
    const result = await loadWeeklyResetSummaryInTx(
      db,
      { ...actor, role },
      defaultFeatures(),
      scope,
      "responsibilities",
    );
    expect(result.groups[0].rows).toEqual([]);
    expect(tx.chore.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          assigned_to: actor.userId,
          assignee: { is: { family_id: actor.familyId } },
        }),
      }),
    );
  }
  jest.mocked(isProfileChoreEnabled).mockReturnValue(false);
  const { db } = fixture();
  const paused = await loadWeeklyResetSummaryInTx(
    db,
    actor,
    defaultFeatures(),
    scope,
    "responsibilities",
  );
  expect(paused.groups[0].rows).toEqual([]);
  expect(paused.notes).toContain("profileChoresInChores");
});
