// POST /api/projects/[id]/send-to-calendar: a task's due date is a date-only
// value (UTC midnight of the picked day). It used to become a 30-minute event
// starting at that UTC instant, which lands on the evening before for anyone
// west of UTC, and duplicates were detected by title only. Events are now
// all-day on the task's calendar day and linked to their task.

jest.mock("next/server", () => require("@/__tests__/helpers/two-household").nextServerMock);
jest.mock("next/headers", () => require("@/__tests__/helpers/two-household").nextHeadersMock);
jest.mock("@/lib/session", () => require("@/__tests__/helpers/two-household").sessionMock);
jest.mock("@/lib/prisma", () => ({ prisma: require("@/__tests__/helpers/two-household").fakePrisma }));
jest.mock("@/lib/feature-gate-server", () => ({ featureGate: async () => null }));

import { POST as sendToCalendar } from "../[id]/send-to-calendar/route";
import { db, req, params, bodyOf, writesTo, expectDenied, expectNoForeignData } from "@/__tests__/helpers/two-household";
import { DEFAULT_FAMILY_TIMEZONE } from "@/lib/calendar-import/timezone";

const DUE = new Date("2026-10-15T00:00:00Z"); // picked "2026-10-15" in a date input

function taskA() {
  return db.rows("projectTask").find((t) => t.id === "task-a")!;
}

function addTask(id: string, title: string, due: Date | null = DUE, completed = false) {
  db.rows("projectTask").push({
    id, project_id: "proj-a", title, description: null, completed, assigned_to: null,
    due_date: due, position: 1, created_at: DUE,
  });
}

function eventsOfProjectA() {
  return db.rows("event").filter((e) => e.project_id === "proj-a");
}

const send = (body?: unknown) =>
  sendToCalendar(req({ as: "parentA", method: "POST", body }), params({ id: "proj-a" }));

describe("send-to-calendar", () => {
  beforeEach(() => {
    db.reset();
    taskA().due_date = DUE;
  });

  it("creates an all-day event on the task's calendar day in the caller's zone", async () => {
    const res = await send({ timeZone: "America/Los_Angeles" });
    expect(res.status).toBe(200);
    const body = await expectNoForeignData(res);
    expect(body.eventsCreated).toBe(1);
    const [w] = writesTo("event");
    expect(w.op).toBe("create");
    // 00:00 to 23:59 on Oct 15 in Los Angeles (UTC-7 in October), not
    // 17:00 on Oct 14 as the old UTC-instant event showed.
    expect(w.args.data.start_time.toISOString()).toBe("2026-10-15T07:00:00.000Z");
    expect(w.args.data.end_time.toISOString()).toBe("2026-10-16T06:59:00.000Z");
    expect(w.args.data).toMatchObject({
      family_id: "family-A",
      project_id: "proj-a",
      is_task: true,
      source_uid: "project-task:task-a",
    });
    expect(w.args.data.source_subscription_id).toBeUndefined();
  });

  it("uses the zone east of UTC too (the day never moves)", async () => {
    await send({ timeZone: "Asia/Tokyo" });
    const [w] = writesTo("event");
    expect(w.args.data.start_time.toISOString()).toBe("2026-10-14T15:00:00.000Z");
    expect(w.args.data.end_time.toISOString()).toBe("2026-10-15T14:59:00.000Z");
  });

  it.each([
    ["no body", undefined],
    ["an unknown zone", { timeZone: "Mars/Olympus" }],
    ["a non-string zone", { timeZone: 42 }],
  ])("falls back to the household default zone with %s", async (_label, body) => {
    expect(DEFAULT_FAMILY_TIMEZONE).toBe("America/Toronto");
    expect((await send(body)).status).toBe(200);
    const [w] = writesTo("event");
    // Toronto is UTC-4 in October.
    expect(w.args.data.start_time.toISOString()).toBe("2026-10-15T04:00:00.000Z");
    expect(w.args.data.end_time.toISOString()).toBe("2026-10-16T03:59:00.000Z");
  });

  it("does not send the same task twice, even after it is renamed", async () => {
    expect((await bodyOf(await send({ timeZone: "UTC" }))).eventsCreated).toBe(1);
    taskA().title = "Sweep the garage floor";
    const again = await bodyOf(await send({ timeZone: "UTC" }));
    expect(again.eventsCreated).toBe(0);
    expect(eventsOfProjectA()).toHaveLength(1);
  });

  it("sends a different task that shares a title with one already sent", async () => {
    await send({ timeZone: "UTC" });
    addTask("task-a2", taskA().title, new Date("2026-10-20T00:00:00Z"));
    const again = await bodyOf(await send({ timeZone: "UTC" }));
    expect(again.eventsCreated).toBe(1);
    expect(eventsOfProjectA().map((e) => e.source_uid).sort()).toEqual([
      "project-task:task-a",
      "project-task:task-a2",
    ]);
  });

  it("treats an event sent before the task link existed (same title, no link) as already sent", async () => {
    db.rows("event").push({
      id: "legacy-event", family_id: "family-A", title: taskA().title, description: null,
      start_time: DUE, end_time: new Date(DUE.getTime() + 30 * 60 * 1000), location: null,
      event_type: "other", recurrence: null, created_by: "parent-a", project_id: "proj-a",
      is_task: true, created_at: DUE,
    });
    const body = await bodyOf(await send({ timeZone: "UTC" }));
    expect(body.eventsCreated).toBe(0);
    expect(writesTo("event")).toHaveLength(0);
  });

  it("skips completed and undated tasks", async () => {
    addTask("task-done", "Done already", DUE, true);
    addTask("task-undated", "Someday", null);
    const body = await bodyOf(await send({ timeZone: "UTC" }));
    expect(body.eventsCreated).toBe(1);
    expect(writesTo("event").map((w) => w.args.data.source_uid)).toEqual(["project-task:task-a"]);
  });

  it("another household's linked event does not block this household, and their project stays refused", async () => {
    db.rows("event").push({
      id: "foreign-linked", family_id: "family-B", title: "FOREIGN copy", description: null,
      start_time: DUE, end_time: DUE, location: null, event_type: "other", recurrence: null,
      created_by: "parent-b", project_id: "proj-a", is_task: true, created_at: DUE,
      source_uid: "project-task:task-a",
    });
    const body = await expectNoForeignData(await send({ timeZone: "UTC" }));
    expect(body.eventsCreated).toBe(1);
    await expectDenied(
      await sendToCalendar(req({ as: "parentA", method: "POST", body: {} }), params({ id: "proj-b" }))
    );
    expect(writesTo("event")).toHaveLength(1);
  });
});
