/** Scoped current-authority source cases. No real locks or database execution. */
import type { PrismaClient } from "@prisma/client";
import { defaultFeatures } from "@/lib/features";
import { RESPONSIBILITY_PROTOCOL } from "@/lib/responsibility";
import { readResponsibilityView } from "@/lib/responsibility-runtime";
import {
  readResponsibilitySource,
  responsibilityStorageAvailable,
} from "@/lib/responsibility-storage";
import { readResponsibilityStateInTx } from "@/lib/responsibility-state-store";
jest.mock("@/lib/responsibility-storage", () => ({
  readResponsibilitySource: jest.fn(),
  responsibilityStorageAvailable: jest.fn(async () => true),
}));
jest.mock("@/lib/responsibility-state-store", () => ({
  readResponsibilityStateInTx: jest.fn(async () => null),
}));
jest.mock("@/lib/responsibility-owner", () => ({
  responsibilityWritingEnabled: () => true,
}));
jest.mock("@/lib/profile-chore-gates", () => ({
  ...jest.requireActual("@/lib/profile-chore-gates"),
  isProfileChoreEnabled: () => true,
}));
jest.mock("@/lib/routine-occurrence-policy", () => ({
  ...jest.requireActual("@/lib/routine-occurrence-policy"),
  routineOccurrencePolicyInTx: async () => "legacy",
}));
const actor = {
  userId: "parent-a",
  familyId: "family-a",
  role: "parent",
  tokenVersion: 0,
};
const target = { kind: "chore" as const, id: "chore-a" };
function fixture() {
  const events: string[] = [];
  const users = [
    {
      id: "parent-a",
      family_id: "family-a",
      role: "parent",
      token_version: 0,
      name: "Parent A",
      email: "private@example.invalid",
    },
    {
      id: "teen-a",
      family_id: "family-a",
      role: "teen",
      token_version: 0,
      name: "Teen A",
      email: "not-exported@example.invalid",
    },
    {
      id: "foreign-user",
      family_id: "family-b",
      role: "parent",
      token_version: 0,
      name: "FOREIGN",
    },
  ];
  const chores = [
    {
      id: "chore-a",
      family_id: "family-a",
      title: "Take out bins",
      description: "Private instructions",
      status: "pending",
      assigned_to: "parent-a" as string | null,
      assigned_member_id: null,
      member_subject_erased: false,
      frequency: "once",
      recurrence_id: null,
    },
    {
      id: "foreign-chore",
      family_id: "family-b",
      title: "FOREIGN",
      description: "FOREIGN",
      status: "pending",
      assigned_to: "foreign-user",
      assigned_member_id: null,
      member_subject_erased: false,
      frequency: "once",
      recurrence_id: null,
    },
  ];
  const tx = {
    user: {
      findUnique: jest.fn(
        async (args: { where: { id: string } }) =>
          users.find((u) => u.id === args.where.id) ?? null,
      ),
      findMany: jest.fn(
        async (args: {
          where: { family_id: string; role: { in: string[] } };
        }) =>
          users.filter(
            (u) =>
              u.family_id === args.where.family_id &&
              args.where.role.in.includes(u.role),
          ),
      ),
    },
    chore: {
      findFirst: jest.fn(
        async (args: { where: { id: string; family_id: string } }) =>
          chores.find(
            (c) =>
              c.id === args.where.id && c.family_id === args.where.family_id,
          ) ?? null,
      ),
    },
    pickup: { findFirst: jest.fn(async () => null) },
    handoff: { findFirst: jest.fn(async () => null) },
    householdMember: { findMany: jest.fn(async () => []) },
    $queryRaw: jest.fn(
      async (strings: TemplateStringsArray, ...values: unknown[]) => {
        const sql = strings.join("?");
        if (sql.includes('FROM "User"') && sql.includes("ANY")) {
          events.push("identity");
          return users.filter(
            (u) =>
              u.family_id === values[0] &&
              (values[1] as string[]).includes(u.id),
          );
        }
        if (sql.includes('FROM "Family"'))
          return [
            {
              features: { ...defaultFeatures(), pickups: true, handoff: true },
            },
          ];
        return [];
      },
    ),
  };
  jest.mocked(readResponsibilitySource).mockImplementation(async () => {
    events.push("target");
    return "a".repeat(64);
  });
  return {
    db: {
      $transaction: async (run: (tx: unknown) => unknown) => run(tx),
    } as unknown as PrismaClient,
    tx,
    events,
    users,
    chores,
  };
}
beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(responsibilityStorageAvailable).mockResolvedValue(true);
  jest.mocked(readResponsibilityStateInTx).mockResolvedValue(null);
});
it("locks current identity before target and returns only scoped safe fields with parent-only choices", async () => {
  const { db, events } = fixture();
  const view = await readResponsibilityView(db, actor, target);
  expect(events).toEqual(["identity", "target"]);
  expect(view.primary?.member).toEqual({
    subject: { kind: "account", accountId: "parent-a" },
    name: "Parent A",
  });
  for (const text of [
    "FOREIGN",
    "Private instructions",
    "@example.invalid",
    "token_version",
    "description",
  ])
    expect(JSON.stringify(view)).not.toContain(text);
});
it("refuses a stale account generation and a foreign target before producing private context", async () => {
  const f = fixture();
  f.users[0].token_version = 1;
  await expect(readResponsibilityView(f.db, actor, target)).rejects.toThrow(
    "UNAUTHORIZED",
  );
  expect(f.tx.chore.findFirst).not.toHaveBeenCalled();
  const foreign = fixture();
  await expect(
    readResponsibilityView(foreign.db, actor, {
      kind: "chore",
      id: "foreign-chore",
    }),
  ).rejects.toThrow("NOT_FOUND");
});
it("refuses a changed relationship outside the locked identity set rather than locking a new user late", async () => {
  const f = fixture();
  jest.mocked(readResponsibilitySource).mockImplementationOnce(async () => {
    f.chores[0].assigned_to = "teen-a";
    return "b".repeat(64);
  });
  await expect(readResponsibilityView(f.db, actor, target)).rejects.toThrow(
    "CONFLICT",
  );
  expect(f.events).toEqual(["identity"]);
});
it("lets the named teen account backup review that slot without exposing the household directory", async () => {
  const f = fixture();
  jest
    .mocked(readResponsibilityStateInTx)
    .mockResolvedValue({
      id: "state-a",
      state: {
        protocol: RESPONSIBILITY_PROTOCOL,
        familyId: actor.familyId,
        target,
        sourceToken: "a".repeat(64),
        revision: 1,
        coordinator: null,
        primaryStatement: null,
        backup: {
          subject: { kind: "account", accountId: "teen-a" },
          statement: null,
        },
      },
    });
  const view = await readResponsibilityView(
    f.db,
    { ...actor, userId: "teen-a", role: "teen" },
    target,
  );
  expect(view.backup?.member.subject).toEqual({
    kind: "account",
    accountId: "teen-a",
  });
  expect(view.choices).toEqual([]);
  expect(f.tx.user.findMany).not.toHaveBeenCalled();
  jest.mocked(readResponsibilityStateInTx).mockResolvedValue(null);
  await expect(
    readResponsibilityView(
      f.db,
      { ...actor, userId: "teen-a", role: "teen" },
      target,
    ),
  ).rejects.toThrow("NOT_FOUND");
});
it("does not query private handoff data for a child or absent source columns", async () => {
  const f = fixture();
  f.users[1].role = "child";
  await expect(
    readResponsibilityView(
      f.db,
      { ...actor, userId: "teen-a", role: "child" },
      { kind: "handoff", id: "handoff-a" },
    ),
  ).rejects.toThrow("FORBIDDEN");
  expect(f.tx.handoff.findFirst).not.toHaveBeenCalled();
  jest.mocked(responsibilityStorageAvailable).mockResolvedValue(false);
  await expect(readResponsibilityView(f.db, actor, target)).rejects.toThrow(
    "UNAVAILABLE",
  );
});
