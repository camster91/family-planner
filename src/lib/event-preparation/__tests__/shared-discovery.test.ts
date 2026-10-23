/** Authored/unrun. SQL predicates below need the disposable PostgreSQL pass. */
import { readSharedPreparationContext } from "../shared-discovery";
import { eventPreparationReady } from "../owner";
import { eventPreparationStorageAvailable } from "../storage";
import { isProfileChoreEnabled } from "@/lib/profile-chore-gates";
import { defaultFeatures } from "@/lib/features";
jest.mock("../owner", () => ({ eventPreparationReady: jest.fn(() => true) }));
jest.mock("../storage", () => ({
  eventPreparationStorageAvailable: jest.fn(async () => true),
}));
jest.mock("@/lib/profile-chore-gates", () => ({
  isProfileChoreEnabled: jest.fn(() => true),
}));
const input = {
  familyId: "family-a",
  memberProtocol: 2 as const,
  visibleChoreIds: ["task-a"],
};
beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(eventPreparationReady).mockReturnValue(true);
  jest.mocked(eventPreparationStorageAvailable).mockResolvedValue(true);
  jest.mocked(isProfileChoreEnabled).mockReturnValue(true);
});
it("projects only shared-schedule title for the exact visible tasks, never parent relationships", async () => {
  const db = {
    $queryRaw: jest.fn().mockResolvedValue([
      {
        chore_id: "task-a",
        event_title: "Shared event",
        features: defaultFeatures(),
        event_id: "private-event",
        cue_minutes: 30,
        plan_token: "private-token",
        description: "private-notes",
      },
      {
        chore_id: "not-visible",
        event_title: "Do not disclose",
        features: defaultFeatures(),
      },
    ]),
  };
  expect(await readSharedPreparationContext(db, input)).toEqual({
    "task-a": { eventTitle: "Shared event" },
  });
  const [sql, ...values] = db.$queryRaw.mock.calls[0];
  const text = sql.join("");
  expect(text).toContain('e."family_id"=p."family_id"');
  expect(text).toContain('c."family_id"=s."family_id"');
  expect(text).toContain('c."member_subject_erased"=false');
  expect(text).toContain('m."archived_at" IS NULL');
  expect(text).toContain('"HouseholdMemberAccountLink"');
  expect(text).toContain('"HouseholdMemberLegacyMapping"');
  expect(values).toContain(input.familyId);
  expect(values).toContain(true);
});
it.each(["paused", "absent", "empty"])(
  "does not read optional context when %s",
  async (state) => {
    const db = { $queryRaw: jest.fn() };
    if (state === "paused")
      jest.mocked(eventPreparationReady).mockReturnValue(false);
    if (state === "absent")
      jest.mocked(eventPreparationStorageAvailable).mockResolvedValue(false);
    expect(
      await readSharedPreparationContext(db, {
        ...input,
        visibleChoreIds: state === "empty" ? [] : input.visibleChoreIds,
      }),
    ).toEqual({});
    expect(db.$queryRaw).not.toHaveBeenCalled();
  },
);
it.each([
  { memberProtocol: 1 as const, gate: true, allowed: false },
  { memberProtocol: 2 as const, gate: false, allowed: false },
  { memberProtocol: 2 as const, gate: true, allowed: true },
])(
  "requires both protocol 2 and profile readiness ($memberProtocol/$gate)",
  async ({ memberProtocol, gate, allowed }) => {
    const db = { $queryRaw: jest.fn().mockResolvedValue([]) };
    jest.mocked(isProfileChoreEnabled).mockReturnValue(gate);
    await readSharedPreparationContext(db, { ...input, memberProtocol });
    expect(db.$queryRaw.mock.calls[0].slice(1)).toContain(allowed);
  },
);
it("caps the canonical window and omits disabled-domain rows", async () => {
  const db = {
    $queryRaw: jest.fn().mockResolvedValue([
      {
        chore_id: "task-a",
        event_title: "Hidden",
        features: { ...defaultFeatures(), calendar: false },
      },
    ]),
  };
  expect(
    await readSharedPreparationContext(db, {
      ...input,
      visibleChoreIds: [
        "task-a",
        ...Array.from({ length: 90 }, (_, i) => `task-${i}`),
      ],
    }),
  ).toEqual({});
  const serialized = db.$queryRaw.mock.calls[0]
    .slice(1)
    .find(
      (value: unknown) => typeof value === "string" && value.startsWith("["),
    );
  expect(JSON.parse(serialized)).toHaveLength(80);
});
