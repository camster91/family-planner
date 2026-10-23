/** Authored/unrun: policy extraction must preserve canonical lifecycle holds. */
jest.mock(
  "next/server",
  () => require("@/__tests__/helpers/two-household").nextServerMock,
);
jest.mock("../routine-schedule-legacy", () => ({
  refuseScheduledRoutineLegacyWrite: jest.fn(),
}));
import { deletionEligibility } from "../person-record-delete";
import { refuseScheduledRoutineLegacyWrite } from "../routine-schedule-legacy";
const actor = {
  userId: "parent-a",
  familyId: "family-a",
  role: "parent",
  generation: 0,
};
beforeEach(() => {
  jest.clearAllMocks();
});
it("keeps imported events read-only and foreign targets outside canonical delete authority", async () => {
  const tx = {
    event: {
      findUnique: jest
        .fn()
        .mockResolvedValue({
          family_id: "family-a",
          source_subscription_id: "subscription-a",
        }),
    },
    list: {
      findUnique: jest.fn().mockResolvedValue({ family_id: "family-b" }),
    },
  };
  expect(
    await deletionEligibility(tx as never, actor, "event_delete", "event-a"),
  ).toMatchObject({ status: 409, body: { code: "EVENT_READ_ONLY" } });
  expect(
    await deletionEligibility(tx as never, actor, "list_delete", "list-b"),
  ).toMatchObject({ status: 403 });
});
it("preserves the recurring anchor, history, routine-schedule and assignee restrictions", async () => {
  const chore = {
    family_id: "family-a",
    assigned_to: "parent-a",
    assigned_member_id: null,
    recurrence_id: "chore-a",
    is_template: true,
    frequency: "weekly",
  };
  const tx = {
    chore: {
      findUnique: jest.fn().mockResolvedValue(chore),
      findFirst: jest.fn().mockResolvedValue({ id: "copy-a" }),
    },
  };
  expect(
    await deletionEligibility(tx as never, actor, "chore_delete", "chore-a"),
  ).toMatchObject({
    status: 409,
    body: { code: "RECURRING_SERIES_REQUIRES_STOP" },
  });
  tx.chore.findUnique.mockResolvedValue({
    ...chore,
    is_template: false,
    frequency: "once",
  });
  expect(
    await deletionEligibility(tx as never, actor, "chore_delete", "chore-a"),
  ).toMatchObject({
    status: 409,
    body: { code: "RECURRING_ANCHOR_RETAINS_HISTORY" },
  });
  tx.chore.findUnique.mockResolvedValue({
    ...chore,
    recurrence_id: null,
    is_template: false,
    frequency: "once",
  });
  expect(
    await deletionEligibility(
      tx as never,
      { ...actor, userId: "teen-a", role: "teen" },
      "chore_delete",
      "chore-a",
    ),
  ).toMatchObject({ status: 403 });
  jest
    .mocked(refuseScheduledRoutineLegacyWrite)
    .mockRejectedValueOnce(new Error("Synthetic routine editor hold"));
  await expect(
    deletionEligibility(tx as never, actor, "chore_delete", "chore-a"),
  ).rejects.toThrow("Synthetic routine editor hold");
});
