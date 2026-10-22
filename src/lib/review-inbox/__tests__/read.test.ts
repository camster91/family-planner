/** Authored/unrun. Mocked projection cases do not establish DB isolation. */
import { readReviewInbox } from "../read";
import { eventPreparationReady } from "@/lib/event-preparation/owner";
import { eventPreparationStorageAvailable } from "@/lib/event-preparation/storage";
import { scheduleEventToken } from "@/lib/calendar-planning/schedule-source";
jest.mock("@/lib/event-preparation/owner", () => ({
  eventPreparationReady: jest.fn(() => true),
}));
jest.mock("@/lib/event-preparation/storage", () => ({
  eventPreparationStorageAvailable: jest.fn(async () => true),
}));
jest.mock("@/lib/calendar-planning/schedule-source", () => ({
  scheduleEventToken: jest.fn(() => "current-token"),
}));
const actor = {
  userId: "parent-a",
  familyId: "family-a",
  role: "parent",
  tokenVersion: 0,
};
const db = () => ({ $queryRaw: jest.fn() });
beforeEach(() => jest.clearAllMocks());
it.each(["child", "teen", "device"])(
  "does not read parent inbox for %s",
  async (role) => {
    const reader = db();
    expect(await readReviewInbox(reader, { ...actor, role }, {})).toMatchObject(
      { state: "forbidden", items: [] },
    );
    expect(reader.$queryRaw).not.toHaveBeenCalled();
  },
);
it("keeps canonical checks bounded and uses the raw page cursor", async () => {
  const reader = db();
  reader.$queryRaw.mockResolvedValue(
    Array.from({ length: 21 }, (_, i) => ({
      id: `task-${i}`,
      title: `Task ${i}`,
      features: {},
    })),
  );
  const page = await readReviewInbox(reader, actor, { source: "checks" });
  expect(page.items).toHaveLength(20);
  expect(page.next).toBe("task-19");
  const [sql, ...values] = reader.$queryRaw.mock.calls[0];
  expect(sql.join("")).toContain(`c."status"='completed'`);
  expect(values).toContain(actor.userId);
  expect(values).toContain(actor.familyId);
});
it("does not declare no remaining changes when a candidate window has no stale plans", async () => {
  const reader = db();
  reader.$queryRaw.mockResolvedValue(
    Array.from({ length: 21 }, (_, i) => ({
      id: `event-${i}`,
      title: "Event",
      generation: "unused",
      epoch: 0,
      reviewed: "current-token",
      features: {},
    })),
  );
  const page = await readReviewInbox(reader, actor, { source: "preparation" });
  expect(page).toMatchObject({
    items: [],
    next: "event-19",
    state: "available",
  });
});
it("projects changed plans and holds invalid source versions for review", async () => {
  const reader = db();
  reader.$queryRaw.mockResolvedValue([
    {
      id: "event-a",
      title: "Trip",
      generation: "unused",
      epoch: 0,
      reviewed: "old-token",
      features: {},
    },
  ]);
  expect(
    (await readReviewInbox(reader, actor, { source: "preparation" })).items,
  ).toEqual([{ id: "event-a", title: "Trip", kind: "preparation" }]);
  jest.mocked(scheduleEventToken).mockImplementationOnce(() => {
    throw new Error("unavailable");
  });
  expect(
    (await readReviewInbox(reader, actor, { source: "preparation" })).items,
  ).toHaveLength(1);
});
it("omits optional preparation tables while paused", async () => {
  const reader = db();
  jest.mocked(eventPreparationReady).mockReturnValueOnce(false);
  expect(
    await readReviewInbox(reader, actor, { source: "preparation" }),
  ).toMatchObject({ state: "paused", items: [] });
  expect(reader.$queryRaw).not.toHaveBeenCalled();
  expect(eventPreparationStorageAvailable).not.toHaveBeenCalled();
});
