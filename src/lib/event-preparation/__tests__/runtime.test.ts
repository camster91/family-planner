/** Authored/unrun source-flow cases. Mocks are not real locking/role proof. */
import { defaultFeatures } from "@/lib/features";
import {
  openPreparationActorInTx,
  prepareEventPreparationInTx,
} from "../runtime";
import { preparationView } from "../view";
import { actor, now } from "./test-fixture";
jest.mock("@/lib/household-lock", () => ({
  lockUser: jest.fn(),
  lockHousehold: jest.fn(),
}));
jest.mock("../storage", () => ({
  eventPreparationStorageAvailable: jest.fn(async () => true),
}));
jest.mock("../state-store", () => ({
  ...jest.requireActual("../state-store"),
  readPreparationStateInTx: jest.fn(async () => null),
}));
jest.mock("@/lib/calendar-planning/schedule-source", () => ({
  ...jest.requireActual("@/lib/calendar-planning/schedule-source"),
  scheduleStorageAvailable: jest.fn(async () => true),
}));
jest.mock("../owner", () => ({
  eventPreparationWritingEnabled: jest.fn(() => true),
}));
function fixture() {
  const user = {
    id: actor.userId,
    family_id: actor.familyId,
    name: "Fixture parent",
    created_at: new Date("2026-10-01T00:00:00Z"),
    role: "parent",
    token_version: actor.tokenVersion,
  };
  const chore = {
    id: "chore-a",
    family_id: actor.familyId,
    title: "Private task title",
    description: "Private task description",
    points: 10,
    assigned_to: actor.userId,
    assigned_member_id: null,
    due_date: new Date("2026-10-21T00:00:00Z"),
    status: "pending",
    frequency: "once",
    is_template: false,
    difficulty: "easy",
    icon: null,
    routine_order: null,
    routine_duration_minutes: null,
    routine_stack_id: null,
    recurrence_id: null,
    member_subject_erased: false,
    photo_url: null,
    photo_verified: false,
    verified_at: null,
    verified_notes: null,
    completed_at: null,
    successor_id: null,
    generation: "22acfa09-9174-4de0-844f-2190415054f0",
    epoch: 0,
    preparation_epoch: 0,
    no_series_config: true,
    root_id: null,
    root_recurrence_id: null,
    root_generation: null,
    root_epoch: null,
    own_config: null,
    series_config: null,
  };
  let reads = 0;
  const phases: string[] = [];
  const changes = { replaceSubjectAfterLocks: false };
  const tx = {
    user: { findUnique: jest.fn(async () => user) },
    $queryRaw: jest.fn(async (strings: TemplateStringsArray) => {
      const sql = strings.join("?");
      if (sql.includes('FROM "User"')) {
        phases.push("users");
        return [user];
      }
      if (sql.includes('FROM "Family"')) {
        phases.push("family");
        return [{ features: defaultFeatures() }];
      }
      if (sql.includes('FROM "Chore" c LEFT JOIN')) {
        reads++;
        return [
          {
            ...chore,
            assigned_to:
              changes.replaceSubjectAfterLocks && reads === 3
                ? "different-account"
                : chore.assigned_to,
          },
        ];
      }
      if (sql.includes('FROM "Chore"') && sql.includes("FOR UPDATE")) {
        phases.push("chore-lock");
        return [{ id: chore.id }];
      }
      if (sql.includes('FROM "Event"')) {
        phases.push("event-lock");
        return [
          {
            id: "event-a",
            family_id: actor.familyId,
            title: "Fixture event",
            start_time: new Date("2026-10-21T14:00:00Z"),
            end_time: new Date("2026-10-21T15:00:00Z"),
            generation: "44acfa09-9174-4de0-844f-2190415054f0",
            epoch: 0,
            preparation_epoch: 0,
            recurrence: null,
          },
        ];
      }
      return [];
    }),
  };
  return { tx, user, chore, phases, changes };
}
const scope = {
  eventId: "event-a",
  timeZone: "America/Toronto",
  memberProtocol: 2 as const,
  choreIds: ["chore-a"],
  subjects: [],
  routine: null,
};
it("locks canonical identities and chores before Event and exposes only the deliberate projection", async () => {
  const { tx, phases } = fixture();
  await openPreparationActorInTx(tx as never, actor);
  const prepared = await prepareEventPreparationInTx(tx as never, actor, scope);
  expect(phases).toEqual(["users", "family", "chore-lock", "event-lock"]);
  const reply = preparationView(prepared, now);
  expect(reply.tasks[0]).toMatchObject({
    id: "chore-a",
    available: true,
    dateEditable: true,
  });
  expect(JSON.stringify(reply)).not.toMatch(
    /root_generation|preparation_epoch|token_version|verified_notes|photo_url/,
  );
});
it("refuses an unexpected subject after Chore lock instead of taking a late identity lock", async () => {
  const { tx, phases, changes } = fixture();
  changes.replaceSubjectAfterLocks = true;
  await expect(
    prepareEventPreparationInTx(tx as never, actor, scope),
  ).rejects.toMatchObject({ code: "STALE" });
  expect(phases).not.toContain("event-lock");
});
it("hides the text and state of a retired or foreign subject instead of inventing another assignee", async () => {
  const { tx, chore } = fixture();
  chore.assigned_to = "foreign-account";
  const prepared = await prepareEventPreparationInTx(tx as never, actor, scope);
  const reply = preparationView(prepared, now);
  expect(reply.tasks).toEqual([{ id: "chore-a", available: false }]);
  expect(JSON.stringify(reply)).not.toMatch(/Private task|foreign-account/);
});
it("refuses wrong household, changed-token, child and unknown-role actors before any private source read", async () => {
  for (const update of [
    { family_id: "foreign" },
    { token_version: 999 },
    { role: "child" },
    { role: "unknown" },
  ]) {
    const { tx, user } = fixture();
    Object.assign(user, update);
    await expect(
      openPreparationActorInTx(tx as never, actor),
    ).rejects.toThrow();
    expect(tx.$queryRaw).not.toHaveBeenCalled();
  }
});
