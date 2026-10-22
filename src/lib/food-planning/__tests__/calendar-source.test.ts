/** Authored/unrun. Mocked source projections are not SQL/isolation evidence. */
jest.mock("../../calendar-planning/schedule-source", () => ({
  ...jest.requireActual("../../calendar-planning/schedule-source"),
  scheduleStorageAvailable: jest.fn(),
  readScheduleIntervalsInTx: jest.fn(),
}));
jest.mock("../../calendar-planning/schedule-status", () => ({
  ...jest.requireActual("../../calendar-planning/schedule-status"),
  readScheduleStatuses: jest.fn(),
}));
import {
  readScheduleIntervalsInTx,
  scheduleStorageAvailable,
} from "../../calendar-planning/schedule-source";
import { readScheduleStatuses } from "../../calendar-planning/schedule-status";
import { foodPlanRequest } from "../contract";
import { readFoodCalendar } from "../calendar-source";
const now = new Date("2026-10-22T12:00:00Z");
const row = {
  id: "busy-a",
  generation: "b099dfbc-36f7-48e3-b98b-8073615bad64",
  epoch: 0,
  start: new Date("2026-10-22T15:00:00Z"),
  end: new Date("2026-10-22T15:30:00Z"),
  recurrence: null,
  sourceSubscriptionId: null,
  sourceConnectionId: null,
};
const request = () =>
  foodPlanRequest.parse({
    timeZone: "UTC",
    slots: [
      {
        key: "dinner",
        date: "2026-10-22",
        mealType: "dinner",
        servings: 2,
        timing: {
          start: "2026-10-22T15:00:00Z",
          end: "2026-10-22T18:00:00Z",
          departureEventId: "departure-a",
        },
      },
    ],
  });
function fixture() {
  return {
    event: {
      findMany: jest
        .fn()
        .mockResolvedValue([
          {
            id: "departure-a",
            title: "Selected canonical event",
            start_time: new Date("2026-10-22T17:00:00Z"),
            end_time: new Date("2026-10-22T18:00:00Z"),
            recurrence: null,
            schedule_generation: row.generation,
            schedule_epoch: 1,
            source_subscription_id: null,
            source_connection_id: null,
          },
        ]),
    },
  };
}
beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(scheduleStorageAvailable).mockResolvedValue(true);
  jest.mocked(readScheduleIntervalsInTx).mockResolvedValue([row]);
  jest.mocked(readScheduleStatuses).mockResolvedValue([]);
});
it("uses shared canonical range/version coverage and reads titles only for explicitly selected owned departure events", async () => {
  const tx = fixture();
  const result = await readFoodCalendar(
    tx as never,
    "family-a",
    request(),
    true,
    now,
  );
  expect(result!.snapshot.complete).toBe(true);
  expect(result!.snapshot.departures[0].title).toBe("Selected canonical event");
  expect(readScheduleIntervalsInTx).toHaveBeenCalledWith(tx, "family-a", {
    start: "2026-10-22T15:00:00.000Z",
    end: "2026-10-22T18:00:00.000Z",
  });
  const query = tx.event.findMany.mock.calls[0][0];
  expect(query.where).toEqual({
    family_id: "family-a",
    id: { in: ["departure-a"] },
  });
  expect(query.select).not.toHaveProperty("description");
  expect(query.select).not.toHaveProperty("location");
});
it("holds stale imported sources, unexpanded recurrence and unavailable selected/ignored identities", async () => {
  jest
    .mocked(readScheduleIntervalsInTx)
    .mockResolvedValue([
      { ...row, recurrence: "FREQ=WEEKLY", sourceConnectionId: "connection-a" },
    ]);
  jest
    .mocked(readScheduleStatuses)
    .mockResolvedValue([
      {
        kind: "connection",
        id: "connection-a",
        status: "ok",
        checkedAt: new Date(+now - 86400001),
        updatedAt: now,
        generation: 1,
      },
    ]);
  const tx = fixture();
  tx.event.findMany.mockResolvedValue([]);
  const draft = request();
  draft.ignoredCalendarEventIds = ["unavailable-event"];
  const result = await readFoodCalendar(
    tx as never,
    "family-a",
    draft,
    true,
    now,
  );
  expect(result!.snapshot.complete).toBe(false);
  expect(result!.snapshot.reasons).toEqual(
    expect.arrayContaining([
      "source-unavailable",
      "recurrence-unexpanded",
      "departure-unavailable",
      "ignored-event-unavailable",
    ]),
  );
});
it("does not read calendar records for unrequested, disabled or unsupported storage states", async () => {
  const tx = fixture(),
    draft = request();
  delete draft.slots[0].timing;
  expect(
    await readFoodCalendar(tx as never, "family-a", draft, true, now),
  ).toBeNull();
  expect(
    (await readFoodCalendar(tx as never, "family-a", request(), false, now))!
      .snapshot.reasons,
  ).toEqual(["calendar-disabled"]);
  jest.mocked(scheduleStorageAvailable).mockResolvedValue(false);
  expect(
    (await readFoodCalendar(tx as never, "family-a", request(), true, now))!
      .snapshot.reasons,
  ).toEqual(["storage-unavailable"]);
  expect(readScheduleIntervalsInTx).not.toHaveBeenCalled();
  expect(tx.event.findMany).not.toHaveBeenCalled();
});
