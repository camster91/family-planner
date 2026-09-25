// Two-household isolation for /api/events (#102).

jest.mock("next/server", () => require("@/__tests__/helpers/two-household").nextServerMock);
jest.mock("next/headers", () => require("@/__tests__/helpers/two-household").nextHeadersMock);
jest.mock("@/lib/session", () => require("@/__tests__/helpers/two-household").sessionMock);
jest.mock("@/lib/prisma", () => ({ prisma: require("@/__tests__/helpers/two-household").fakePrisma }));
jest.mock("@/lib/feature-gate-server", () => ({ featureGate: async () => null }));

import * as events from "../route";
import { db, req, writesTo, expectDenied, expectNoForeignData, type UserKey } from "@/__tests__/helpers/two-household";

const newEvent = { title: "Swim", start_time: "2026-10-01T10:00:00.000Z", event_type: "sports" };

describe("events — two households", () => {
  beforeEach(() => db.reset());

  it("returns 401 to an unauthenticated caller on every handler", async () => {
    expect((await events.GET(req())).status).toBe(401);
    expect((await events.POST(req({ body: newEvent }))).status).toBe(401);
    expect((await events.PATCH(req({ body: { eventId: "event-a", title: "x" } }))).status).toBe(401);
    expect((await events.DELETE(req({ body: { eventId: "event-a" } }))).status).toBe(401);
    expect(db.writes).toHaveLength(0);
  });

  it("lists only the caller's family and hides a foreign event by id", async () => {
    const list = await expectNoForeignData(await events.GET(req({ as: "childA" })));
    expect(list.events.map((e: any) => e.id)).toEqual(["event-a"]);
    await expectDenied(await events.GET(req({ as: "parentA", query: { id: "event-b" } })));
  });

  it("refuses to update or delete another family's event", async () => {
    await expectDenied(await events.PATCH(req({ as: "parentA", body: { eventId: "event-b", title: "x" } })));
    await expectDenied(await events.DELETE(req({ as: "parentA", body: { eventId: "event-b" } })));
    expect(db.writes).toHaveLength(0);
  });

  it.each<[UserKey]>([["teenA"], ["childA"]])("%s cannot edit or delete events", async (who) => {
    expect((await events.PATCH(req({ as: who, body: { eventId: "event-a", title: "x" } }))).status).toBe(403);
    expect((await events.DELETE(req({ as: who, body: { eventId: "event-a" } }))).status).toBe(403);
    expect(db.writes).toHaveLength(0);
  });

  it("creates in the caller's family and lets a parent edit it", async () => {
    const res = await events.POST(req({ as: "childA", body: { ...newEvent, family_id: "family-B" } }));
    expect(res.status).toBe(200);
    expect(writesTo("event")[0].args.data).toMatchObject({ family_id: "family-A", created_by: "child-a" });
    expect((await events.PATCH(req({ as: "parentA", body: { eventId: "event-a", title: "Moved" } }))).status).toBe(200);
    expect((await events.DELETE(req({ as: "parentA", body: { eventId: "event-a" } }))).status).toBe(200);
  });
});
