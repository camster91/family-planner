// Imported (subscribed-calendar) events are read-only and never leak across households (#232).

jest.mock(
  "next/server",
  () => require("@/__tests__/helpers/two-household").nextServerMock,
);
jest.mock(
  "next/headers",
  () => require("@/__tests__/helpers/two-household").nextHeadersMock,
);
jest.mock(
  "@/lib/session",
  () => require("@/__tests__/helpers/two-household").sessionMock,
);
jest.mock("@/lib/prisma", () => ({
  prisma: require("@/__tests__/helpers/two-household").fakePrisma,
}));
jest.mock("@/lib/feature-gate-server", () => ({
  featureGate: async () => null,
}));

import * as events from "../route";
import {
  db,
  req,
  expectDenied,
  expectNoForeignData,
} from "@/__tests__/helpers/two-household";
import {
  seedImportedEventA,
  seedSubscriptions,
} from "@/lib/calendar-import/__tests__/fixtures";

describe("events — imported from a subscription", () => {
  beforeEach(() => {
    db.reset();
    seedSubscriptions();
    seedImportedEventA();
  });

  it("refuses PATCH and DELETE of an imported event with 409 EVENT_READ_ONLY", async () => {
    const patch = await events.PATCH(
      req({
        as: "parentA",
        body: { eventId: "event-imported-a", title: "Hijack" },
      }),
    );
    expect(patch.status).toBe(409);
    expect((await patch.json()).code).toBe("EVENT_READ_ONLY");
    const del = await events.DELETE(
      req({ as: "parentA", body: { eventId: "event-imported-a" } }),
    );
    expect(del.status).toBe(409);
    expect(db.writes).toHaveLength(0);
    expect(db.find("event", "event-imported-a")!.title).toBe(
      "Imported assembly",
    );
  });

  it("still lets a parent edit local events", async () => {
    expect(
      (
        await events.PATCH(
          req({ as: "parentA", body: { eventId: "event-a", title: "Moved" } }),
        )
      ).status,
    ).toBe(200);
  });

  it("lists imported events with their source name, without foreign data", async () => {
    const body = await expectNoForeignData(
      await events.GET(req({ as: "childA" })),
    );
    const imported = body.events.find((e: any) => e.id === "event-imported-a");
    expect(imported.source).toEqual({
      subscription_id: "sub-a",
      name: "School",
      color: "#2563eb",
    });
    expect(body.events.find((e: any) => e.id === "event-a").source).toBeNull();
    expect(body.events.map((e: any) => e.id)).not.toContain("event-imported-b");
  });

  it("does not reveal another family's imported event or subscription name", async () => {
    await expectDenied(
      await events.GET(
        req({ as: "parentA", query: { id: "event-imported-b" } }),
      ),
    );
    await expectDenied(
      await events.PATCH(
        req({
          as: "parentA",
          body: { eventId: "event-imported-b", title: "x" },
        }),
      ),
    );
    await expectDenied(
      await events.DELETE(
        req({ as: "parentA", body: { eventId: "event-imported-b" } }),
      ),
    );
    expect(db.writes).toHaveLength(0);
  });

  it("does not resolve a foreign subscription name even if an event points at it", async () => {
    // Corrupt row: family-A event tagged with family-B's subscription id.
    db.find("event", "event-imported-a")!.source_subscription_id = "sub-b";
    const body = await expectNoForeignData(
      await events.GET(
        req({ as: "parentA", query: { id: "event-imported-a" } }),
      ),
    );
    expect(body.event.source.name).toBe("Subscribed calendar");
  });
});
