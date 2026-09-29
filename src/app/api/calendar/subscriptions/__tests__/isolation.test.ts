// Two-household isolation + role gates for /api/calendar/subscriptions (#232).

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
jest.mock(
  "@/lib/rate-limit-db",
  () => require("@/__tests__/helpers/two-household").rateLimitMock,
);
// No DNS in tests: the full guard is the shape guard here.
jest.mock("@/lib/outbound-url", () => {
  const actual = jest.requireActual("@/lib/outbound-url");
  return {
    ...actual,
    assertPublicProviderUrl: async (url: string) => {
      const err = actual.checkProviderUrlShape(url);
      if (err) throw new Error(err);
    },
  };
});

import * as collection from "../route";
import * as item from "../[id]/route";
import * as refresh from "../[id]/refresh/route";
import {
  db,
  req,
  params,
  writesTo,
  expectDenied,
  expectNoForeignData,
  FAMILY_A,
  type UserKey,
} from "@/__tests__/helpers/two-household";
import { decryptSecret } from "@/lib/secret-box";
import {
  ics,
  icsResponse,
  installCreateMany,
  seedImportedEventA,
  seedSubscriptions,
} from "@/lib/calendar-import/__tests__/fixtures";

const FEED = ics(
  "BEGIN:VEVENT",
  "UID:x@school.test",
  `DTSTART:${new Date(Date.now() + 5 * 86400000).toISOString().replace(/[-:]/g, "").slice(0, 15)}Z`,
  "SUMMARY:Picture day",
  "END:VEVENT",
);

const realFetch = global.fetch;
let fetchMock: jest.Mock;

beforeEach(() => {
  db.reset();
  seedSubscriptions();
  installCreateMany();
  fetchMock = jest.fn(async () => icsResponse(FEED));
  global.fetch = fetchMock as unknown as typeof fetch;
  jest.spyOn(console, "warn").mockImplementation(() => undefined);
  jest.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  global.fetch = realFetch;
  jest.restoreAllMocks();
});

const newSub = {
  name: "Soccer",
  url: "webcal://cal.example.com/team/private-NEWSECRET.ics",
  color: "#16a34a",
};

describe("calendar subscriptions — auth and roles", () => {
  it("returns 401 to an unauthenticated caller on every handler", async () => {
    expect((await collection.GET(req())).status).toBe(401);
    expect((await collection.POST(req({ body: newSub }))).status).toBe(401);
    expect(
      (await item.PATCH(req({ body: { name: "x" } }), params({ id: "sub-a" })))
        .status,
    ).toBe(401);
    expect((await item.DELETE(req(), params({ id: "sub-a" }))).status).toBe(
      401,
    );
    expect((await refresh.POST(req(), params({ id: "sub-a" }))).status).toBe(
      401,
    );
    expect(db.writes).toHaveLength(0);
  });

  it.each<[UserKey]>([["teenA"], ["childA"]])(
    "%s cannot add, rename or remove subscriptions",
    async (who) => {
      expect(
        (await collection.POST(req({ as: who, body: newSub }))).status,
      ).toBe(403);
      expect(
        (
          await item.PATCH(
            req({ as: who, body: { name: "x" } }),
            params({ id: "sub-a" }),
          )
        ).status,
      ).toBe(403);
      expect(
        (await item.DELETE(req({ as: who }), params({ id: "sub-a" }))).status,
      ).toBe(403);
      expect(db.writes).toHaveLength(0);
    },
  );

  it("children cannot list or refresh; teens can refresh", async () => {
    expect((await collection.GET(req({ as: "childA" }))).status).toBe(403);
    expect(
      (await refresh.POST(req({ as: "childA" }), params({ id: "sub-a" })))
        .status,
    ).toBe(403);
    expect(fetchMock).not.toHaveBeenCalled();

    const res = await refresh.POST(
      req({ as: "teenA" }),
      params({ id: "sub-a" }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.result).toMatchObject({ status: "ok", created: 1 });
    expect(body.subscription.url_hint).toBeUndefined();
  });
});

describe("calendar subscriptions — two households", () => {
  it("lists only the caller's family, with a host-only hint and never the URL", async () => {
    const body = await expectNoForeignData(
      await collection.GET(req({ as: "parentA" })),
    );
    expect(body.subscriptions.map((s: any) => s.id)).toEqual(["sub-a"]);
    expect(body.subscriptions[0].url_hint).toBe("cal.example.com/…");
    const text = JSON.stringify(body);
    expect(text).not.toContain("SECRET");
    expect(text).not.toContain("url_enc");

    const teen = await expectNoForeignData(
      await collection.GET(req({ as: "teenA" })),
    );
    expect(teen.subscriptions[0].url_hint).toBeUndefined();
  });

  it("creates in the caller's family, encrypts the URL and never echoes it", async () => {
    const res = await collection.POST(
      req({ as: "parentA", body: { ...newSub, family_id: "family-B" } }),
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(JSON.stringify(body)).not.toContain("NEWSECRET");
    expect(body.subscription).toMatchObject({
      name: "Soccer",
      last_status: "pending",
      url_hint: "cal.example.com/…",
    });

    const [write] = writesTo("calendarSubscription");
    expect(write.args.data).toMatchObject({
      family_id: FAMILY_A,
      created_by: "parent-a",
    });
    expect(write.args.data.url_enc).not.toContain("NEWSECRET");
    // webcal:// is stored as https://
    expect(decryptSecret(write.args.data.url_enc)).toBe(
      "https://cal.example.com/team/private-NEWSECRET.ics",
    );
  });

  it.each([
    ["http://cal.example.com/a.ics"],
    ["https://127.0.0.1/a.ics"],
    ["https://169.254.169.254/latest/meta-data"],
    ["https://localhost/a.ics"],
    ["https://user:pw@cal.example.com/a.ics"],
    ["javascript:alert(1)"],
  ])("rejects unsafe URL %s", async (url) => {
    const res = await collection.POST(
      req({ as: "parentA", body: { name: "x", url } }),
    );
    expect(res.status).toBe(400);
    expect(writesTo("calendarSubscription")).toHaveLength(0);
  });

  it("refuses to rename, remove or refresh another family's subscription", async () => {
    await expectDenied(
      await item.PATCH(
        req({ as: "parentA", body: { name: "Mine" } }),
        params({ id: "sub-b" }),
      ),
    );
    await expectDenied(
      await item.DELETE(req({ as: "parentA" }), params({ id: "sub-b" })),
    );
    await expectDenied(
      await refresh.POST(req({ as: "parentA" }), params({ id: "sub-b" })),
    );
    expect(db.writes).toHaveLength(0);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(db.find("calendarSubscription", "sub-b")).toBeDefined();
    expect(db.find("event", "event-imported-b")).toBeDefined();
  });

  it("renames its own subscription; the URL cannot be changed via PATCH", async () => {
    const res = await item.PATCH(
      req({ as: "parentA", body: { name: "School (Grade 3)" } }),
      params({ id: "sub-a" }),
    );
    expect(res.status).toBe(200);
    expect((await res.json()).subscription.name).toBe("School (Grade 3)");
    const bad = await item.PATCH(
      req({ as: "parentA", body: { url: "https://evil.example.com/a.ics" } }),
      params({ id: "sub-a" }),
    );
    expect(bad.status).toBe(400);
  });

  it("removing a subscription deletes only its imported events", async () => {
    seedImportedEventA();
    const res = await item.DELETE(
      req({ as: "parentA" }),
      params({ id: "sub-a" }),
    );
    expect(res.status).toBe(200);
    expect((await res.json()).removedEvents).toBe(1);
    expect(db.find("event", "event-imported-a")).toBeUndefined();
    expect(db.find("event", "event-a")).toBeDefined(); // local event
    expect(db.find("event", "event-imported-b")).toBeDefined(); // other household
    expect(db.find("calendarSubscription", "sub-a")).toBeUndefined();
  });

  it("refresh imports into the caller's family only and returns no event content", async () => {
    const res = await refresh.POST(
      req({ as: "parentA" }),
      params({ id: "sub-a" }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(JSON.stringify(body)).not.toContain("Picture day");
    const created = writesTo("event").filter((w) => w.op === "create");
    expect(created).toHaveLength(1);
    expect(created[0].args.data).toMatchObject({
      family_id: FAMILY_A,
      source_subscription_id: "sub-a",
    });
    // The fetch went to the decrypted https URL
    expect((fetchMock.mock.calls[0] as unknown as [string])[0]).toContain(
      "private-SECRETA",
    );
  });
});

// Route inventory F-4: the exact statuses the audit rows record. A foreign id
// is indistinguishable from a missing one (404), and the role gate runs before
// the lookup (403), so neither reveals whether the other household's row exists.
describe("calendar subscriptions — audit statuses (F-4)", () => {
  it.each<[UserKey, string]>([
    ["parentA", "sub-b"],
    ["parentB", "sub-a"],
  ])("%s gets 404 for %s on rename, remove and refresh", async (who, id) => {
    for (const res of [
      await item.PATCH(
        req({ as: who, body: { name: "Mine" } }),
        params({ id }),
      ),
      await item.DELETE(req({ as: who }), params({ id })),
      await refresh.POST(req({ as: who }), params({ id })),
    ]) {
      expect(res.status).toBe(404);
      await expectDenied(res, [404]);
    }
    expect(db.writes).toHaveLength(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("a teen refreshing another household's subscription gets 404", async () => {
    await expectDenied(
      await refresh.POST(req({ as: "teenA" }), params({ id: "sub-b" })),
      [404],
    );
    expect(fetchMock).not.toHaveBeenCalled();
    expect(db.writes).toHaveLength(0);
  });

  it("the role gate answers 403 before any lookup, for own and foreign ids alike", async () => {
    for (const id of ["sub-a", "sub-b"]) {
      await expectDenied(
        await item.PATCH(
          req({ as: "teenA", body: { name: "x" } }),
          params({ id }),
        ),
        [403],
      );
      await expectDenied(
        await item.DELETE(req({ as: "childA" }), params({ id })),
        [403],
      );
      await expectDenied(
        await refresh.POST(req({ as: "childA" }), params({ id })),
        [403],
      );
    }
    expect(db.writes).toHaveLength(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("a signed-in user with no household is refused on every handler", async () => {
    for (const res of [
      await collection.GET(req({ as: "loner" })),
      await collection.POST(req({ as: "loner", body: newSub })),
      await item.PATCH(
        req({ as: "loner", body: { name: "x" } }),
        params({ id: "sub-a" }),
      ),
      await item.DELETE(req({ as: "loner" }), params({ id: "sub-a" })),
      await refresh.POST(req({ as: "loner" }), params({ id: "sub-a" })),
    ]) {
      await expectDenied(res, [400]);
    }
    expect(db.writes).toHaveLength(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
