/** Authored/unrun. Fake transactions assert decisions, never PG isolation/rollback. */
import { updatePersonEvent } from "../person-event-update";
import { updateEventSchema } from "../validations";
const actor = { userId: "parent-a", familyId: "family-a", tokenVersion: 0 };
function setup() {
  const tx = {
    $queryRaw: jest.fn(async () => []),
    user: { findUnique: jest.fn(async () => ({ family_id: "family-a", role: "parent", token_version: 0 })) },
    family: { findUnique: jest.fn(async () => ({ id: "family-a" })) },
    event: {
      findFirst: jest.fn(async () => ({ start_time: new Date("2026-10-24T17:00:00Z"), end_time: new Date("2026-10-24T18:00:00Z"),
        recurrence: "FREQ=BAD", source_subscription_id: null as string | null })),
      update: jest.fn(async () => ({ id: "event-a" })),
    },
  };
  const db = { $transaction: async (work: (transaction: typeof tx) => Promise<unknown>) => work(tx) };
  const run = (input: unknown) => updatePersonEvent(db as never, actor, updateEventSchema.parse(input));
  return { tx, run };
}
it("leaves even unsupported recurrence out of an ordinary title-only write", async () => {
  const { tx, run } = setup();
  expect((await run({ eventId: "event-a", title: "Edited" })).status).toBe(200);
  expect(tx.event.update).toHaveBeenCalledWith(expect.objectContaining({
    where: { id: "event-a", family_id: actor.familyId }, data: { title: "Edited" },
  }));
  expect(tx.$queryRaw.mock.calls.map(call => call.slice(1))).toEqual([
    ["user-membership:parent-a"], ["household-membership:family-a"], ["event-a", "family-a"],
  ]);
});
it("only clears the exact reviewed rule and never stores the review precondition", async () => {
  const { tx, run } = setup();
  expect((await run({ eventId: "event-a", recurrence: null, expected_recurrence: "FREQ=BAD" })).status).toBe(200);
  expect(tx.event.update).toHaveBeenCalledWith(expect.objectContaining({ data: { recurrence: null } }));
});
it("holds the whole metadata write when the rule changed since review", async () => {
  const { tx, run } = setup();
  const result = await run({ eventId: "event-a", title: "Unsaved draft", recurrence: null, expected_recurrence: "FREQ=WEEKLY" });
  expect(result).toMatchObject({ status: 409, body: { code: "EVENT_RECURRENCE_CHANGED" } });
  expect(tx.event.update).not.toHaveBeenCalled();
});
it.each([
  { family_id: "family-a", role: "parent", token_version: 1 },
  { family_id: "family-b", role: "parent", token_version: 0 },
  { family_id: "family-a", role: "child", token_version: 0 },
])("renews current actor authority under lifecycle locks", async user => {
  const { tx, run } = setup(); tx.user.findUnique.mockResolvedValue(user);
  expect([401, 403]).toContain((await run({ eventId: "event-a", title: "Draft" })).status);
  expect(tx.event.findFirst).not.toHaveBeenCalled(); expect(tx.event.update).not.toHaveBeenCalled();
});
it("preserves subscribed-event read-only policy", async () => {
  const { tx, run } = setup();
  const event = await tx.event.findFirst(); tx.event.findFirst.mockResolvedValue({ ...event, source_subscription_id: "subscription-a" });
  expect(await run({ eventId: "event-a", recurrence: null, expected_recurrence: "FREQ=BAD" }))
    .toMatchObject({ status: 409, body: { code: "EVENT_READ_ONLY" } });
  expect(tx.event.update).not.toHaveBeenCalled();
});
it("validates a changed bound against the locked current other bound", async () => {
  const { tx, run } = setup();
  expect((await run({ eventId: "event-a", start_time: "2026-10-24T19:00:00Z" })).status).toBe(400);
  expect(tx.event.update).not.toHaveBeenCalled();
});
it("does not accept a removal proof as permission to replace a schedule", () => {
  expect(updateEventSchema.safeParse({ eventId: "event-a", recurrence: "FREQ=DAILY", expected_recurrence: "FREQ=WEEKLY" }).success).toBe(false);
});
