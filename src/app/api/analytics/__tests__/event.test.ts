// Legacy analytics sink and page-view retention (#136, #140).

jest.mock("next/server", () => require("@/__tests__/helpers/two-household").nextServerMock);
jest.mock("next/headers", () => require("@/__tests__/helpers/two-household").nextHeadersMock);
jest.mock("@/lib/session", () => require("@/__tests__/helpers/two-household").sessionMock);
jest.mock("@/lib/prisma", () => ({ prisma: require("@/__tests__/helpers/two-household").fakePrisma }));
jest.mock("@/lib/feature-gate-server", () => ({ featureGate: async () => null }));

import { GET as analytics } from "../route";
import { POST as track } from "../event/route";
import { GET as activityFeed } from "../../activity/route";
import { db, req, writesTo, bodyOf } from "@/__tests__/helpers/two-household";
import { LEGACY_ANALYTICS_RETENTION_MS } from "@/lib/legacy-analytics";

const DAY = 24 * 60 * 60 * 1000;

function addActivity(id: string, family: "A" | "B", type: string, ageMs: number) {
  db.rows("activity").push({
    id,
    family_id: `family-${family}`,
    user_id: `parent-${family.toLowerCase()}`,
    type,
    title: type.replace(/^event_/, ""),
    description: type !== "event_created" && type.startsWith("event_") ? JSON.stringify({ path: "/dashboard/lists/list-123?x=1" }) : null,
    metadata: null,
    created_at: new Date(Date.now() - ageMs),
  });
}

const ids = () => db.rows("activity").map((a) => a.id).sort();

describe("POST /api/analytics/event — compatibility", () => {
  beforeEach(() => db.reset());

  it("400 for invalid JSON", async () => {
    expect((await track(req({ as: "parentA" }))).status).toBe(400);
  });

  it("400 for a missing or non-string event name", async () => {
    expect((await track(req({ as: "parentA", body: {} }))).status).toBe(400);
    expect((await track(req({ as: "parentA", body: { event: 42 } }))).status).toBe(400);
    expect((await track(req({ as: "parentA", body: null }))).status).toBe(400);
  });

  it("200 for anonymous callers, with no database write", async () => {
    const res = await track(req({ body: { event: "page_view", path: "/x" } }));
    expect(res.status).toBe(200);
    expect(await bodyOf(res)).toMatchObject({ success: true, skipped: true, reason: "anonymous" });
    expect(writesTo()).toHaveLength(0);
  });

  it("200 for a signed-in member, ignores path, metadata and unknown fields, and stores nothing", async () => {
    const before = db.rows("activity").length;
    const res = await track(
      req({
        as: "childA",
        body: {
          event: "page_view",
          path: "/dashboard/lists/list-secret-id?q=private",
          metadata: { note: "private text" },
          future_field: true,
        },
      }),
    );
    expect(res.status).toBe(200);
    expect(await bodyOf(res)).toEqual({ success: true, skipped: true, reason: "not_stored" });
    expect(db.rows("activity")).toHaveLength(before);
    expect(writesTo("activity").some((w) => w.op === "create")).toBe(false);
    expect(JSON.stringify(db.rows("activity"))).not.toContain("list-secret-id");
  });

  it("any event name is accepted with 200 and stored nowhere", async () => {
    const res = await track(req({ as: "parentA", body: { event: "cta_click", metadata: { label: "Start" } } }));
    expect(res.status).toBe(200);
    expect(writesTo("activity").some((w) => w.op === "create")).toBe(false);
  });
});

describe("legacy page-view retention", () => {
  beforeEach(() => db.reset());

  function seedLegacy() {
    addActivity("old-view-a", "A", "event_page_view", LEGACY_ANALYTICS_RETENTION_MS + DAY);
    addActivity("old-click-a", "A", "event_cta_click", LEGACY_ANALYTICS_RETENTION_MS + DAY);
    addActivity("new-view-a", "A", "event_page_view", 10 * DAY);
    // Real household activity that shares the prefix, and other old activity, stay.
    addActivity("old-event-created-a", "A", "event_created", LEGACY_ANALYTICS_RETENTION_MS + DAY);
    addActivity("old-chore-a", "A", "chore_completed", LEGACY_ANALYTICS_RETENTION_MS + DAY);
    addActivity("old-imported-a", "A", "events_imported", LEGACY_ANALYTICS_RETENTION_MS + DAY);
    // Another household's old rows are never touched by family A's request.
    addActivity("old-view-b", "B", "event_page_view", LEGACY_ANALYTICS_RETENTION_MS + DAY);
  }

  it("an event POST prunes the caller's household rows past retention only", async () => {
    seedLegacy();
    expect((await track(req({ as: "childA", body: { event: "page_view" } }))).status).toBe(200);
    const left = ids();
    expect(left).not.toContain("old-view-a");
    expect(left).not.toContain("old-click-a");
    for (const id of ["new-view-a", "old-event-created-a", "old-chore-a", "old-imported-a", "old-view-b"]) expect(left).toContain(id);
  });

  it("reading the activity feed prunes the same way", async () => {
    seedLegacy();
    expect((await activityFeed(req({ as: "parentA" }))).status).toBe(200);
    const left = ids();
    expect(left).not.toContain("old-view-a");
    expect(left).toContain("new-view-a");
    expect(left).toContain("old-event-created-a");
    expect(left).toContain("old-imported-a");
    expect(left).toContain("old-view-b");
  });

  it("the analytics dashboard's recent activity leaves out legacy page views", async () => {
    addActivity("new-view-a", "A", "event_page_view", DAY);
    addActivity("new-event-created-a", "A", "event_created", DAY);
    const res = await analytics(req({ as: "parentA" }));
    expect(res.status).toBe(200);
    const body = await bodyOf(res);
    const types = body.recentActivity.map((a: { type: string }) => a.type);
    expect(types).not.toContain("event_page_view");
    expect(types).toContain("event_created");
    expect(JSON.stringify(body)).not.toContain("list-123");
  });
});
