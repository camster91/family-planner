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
  featureGate: jest.fn(async () => null),
}));
jest.mock("@/lib/rate-limit-db", () => ({
  checkRateLimit: jest.fn(async () => ({ allowed: true })),
}));
jest.mock("@/lib/calendar-import/fetch", () => ({ fetchFeed: jest.fn() }));
import { POST } from "../preview/route";
import { POST as discover } from "../discover/route";
import { req, db } from "@/__tests__/helpers/two-household";
import { fetchFeed } from "@/lib/calendar-import/fetch";
import { featureGate } from "@/lib/feature-gate-server";
import { checkRateLimit } from "@/lib/rate-limit-db";
const mockFetch = fetchFeed as jest.Mock;
beforeEach(() => {
  db.reset();
  jest.clearAllMocks();
  mockFetch.mockResolvedValue({
    notModified: false,
    body: '<script type="application/ld+json">{"@type":"Recipe","name":"Fixture soup"}</script>',
  });
  (featureGate as jest.Mock).mockResolvedValue(null);
  (checkRateLimit as jest.Mock).mockResolvedValue({ allowed: true });
});
it("rejects anonymous and child calls before outbound requests", async () => {
  for (const as of [null, "childA"] as const)
    expect(
      (
        await POST(
          req({ as, method: "POST", body: { url: "https://example.org" } }),
        )
      ).status,
    ).toBe(as ? 403 : 401);
  expect(mockFetch).not.toHaveBeenCalled();
});
it("previews for either household parent/teen without storing recipe data", async () => {
  for (const as of ["parentA", "teenA", "parentB"] as const) {
    const response = await POST(
      req({ as, method: "POST", body: { url: "https://example.org/soup" } }),
    );
    expect(response.status).toBe(200);
    expect((await response.json()).recipe.title).toBe("Fixture soup");
  }
  expect(db.writes).toHaveLength(0);
  expect(mockFetch).toHaveBeenCalledWith(
    "https://example.org/soup",
    expect.objectContaining({ maxBytes: 2097152, accept: "text/html" }),
  );
});
it("rejects malformed link, disabled feature, throttling and unavailable source", async () => {
  const call = (url: string) =>
    POST(req({ as: "parentA", method: "POST", body: { url } }));
  expect((await call("javascript:alert(1)")).status).toBe(400);
  (featureGate as jest.Mock).mockResolvedValue(
    new (require("next/server").NextResponse)("", { status: 403 }),
  );
  expect((await call("https://example.org")).status).toBe(403);
  (featureGate as jest.Mock).mockResolvedValue(null);
  (checkRateLimit as jest.Mock).mockResolvedValue({ allowed: false });
  expect((await call("https://example.org")).status).toBe(429);
  (checkRateLimit as jest.Mock).mockResolvedValue({ allowed: true });
  mockFetch.mockRejectedValue(new Error("private address refused"));
  expect((await call("https://example.org")).status).toBe(422);
});

it("searches only a fixed source with encoded query and no private household data", async () => {
  mockFetch.mockResolvedValue({
    notModified: false,
    body: '<a href="/recipes/soup">Fixture soup</a>',
  });
  const result = await discover(
    req({
      as: "childA",
      method: "POST",
      body: { query: "rice & soup", source: "BBC Good Food" },
    }),
  );
  expect(result.status).toBe(200);
  expect((await result.json()).results).toEqual([
    { title: "Fixture soup", url: "https://www.bbcgoodfood.com/recipes/soup" },
  ]);
  expect(mockFetch).toHaveBeenCalledWith(
    "https://www.bbcgoodfood.com/search?q=rice%20%26%20soup",
    expect.objectContaining({ accept: "text/html" }),
  );
  expect(
    (
      await discover(
        req({
          as: "parentA",
          method: "POST",
          body: { query: "rice", source: "https://localhost/" },
        }),
      )
    ).status,
  ).toBe(400);
  expect(db.writes).toHaveLength(0);
});

it("bounds request bodies and refuses unknown fields without outbound work; all failures are private", async () => {
  for (const body of [
    { url: "https://example.org", household: "untrusted" },
    { url: "https://example.org/" + "x".repeat(9000) },
  ]) {
    const response = await POST(req({ as: "parentA", method: "POST", body }));
    expect([400, 413]).toContain(response.status);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  }
  expect(mockFetch).not.toHaveBeenCalled();
});

it("combines only the three fixed publishers and retains successful links when one fails", async () => {
  mockFetch.mockImplementation(async (url: string) => {
    if (url.startsWith("https://www.allrecipes.com/"))
      throw new Error("Fixture publisher outage");
    return {
      notModified: false,
      body: '<a href="/recipes/fixture-soup">Fixture soup</a>',
    };
  });
  const response = await discover(
    req({
      as: "parentA",
      method: "POST",
      body: { query: "rice & beans", source: "all" },
    }),
  );
  expect(response.status).toBe(200);
  const body = await response.json();
  expect(
    body.results.map((result: { source: string }) => result.source),
  ).toEqual(["BBC Good Food", "Serious Eats"]);
  expect(body.sources).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ name: "Allrecipes", state: "unavailable" }),
    ]),
  );
  expect(mockFetch).toHaveBeenCalledTimes(3);
  expect(
    mockFetch.mock.calls.map(([url]) => new URL(url).hostname).sort(),
  ).toEqual([
    "www.allrecipes.com",
    "www.bbcgoodfood.com",
    "www.seriouseats.com",
  ]);
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  expect(db.writes).toHaveLength(0);
});
it("refuses unsupported all-source payloads and oversize queries before publisher reads", async () => {
  for (const body of [
    { query: "rice", source: "all", household: "untrusted" },
    { query: "x".repeat(9000), source: "all" },
  ]) {
    const response = await discover(
      req({ as: "parentA", method: "POST", body }),
    );
    expect([400, 413]).toContain(response.status);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  }
  expect(mockFetch).not.toHaveBeenCalled();
});

// Authority-wait regression source authored UNRUN; no provider traffic executed.
it.each([['preview', 'family_id', 'family-B'], ['discover', 'family_id', 'family-B'], ['preview', 'role', 'child'], ['discover', 'role', 'teen'], ['preview', 'token_version', 1], ['discover', 'token_version', 1]])('refuses %s results after %s changes during a publisher wait', async (mode, field, value) => {
  mockFetch.mockImplementation(async () => {
    db.find('user', 'parent-a')![field] = value;
    return { notModified: false, body: '<script type="application/ld+json">{"@type":"Recipe","name":"Fixture soup"}</script><a href="/recipes/soup">Fixture soup</a>' };
  });
  const response = await (mode === 'preview' ? POST : discover)(req({ as: 'parentA', method: 'POST', body: mode === 'preview' ? { url: 'https://example.org/soup' } : { query: 'rice', source: 'BBC Good Food' } }));
  expect(response.status).toBe(409);
  expect(await response.json()).toMatchObject({ code: 'RECIPE_SCOPE_CHANGED' });
  expect(response.headers.get('cache-control')).toBe('private, no-store');
  expect(mockFetch).toHaveBeenCalledTimes(1);
  expect(db.writes).toHaveLength(0);
});
it('refuses preview when Meals becomes disabled during the publisher wait', async () => {
  mockFetch.mockImplementation(async () => {
    (featureGate as jest.Mock).mockResolvedValue(new (require('next/server').NextResponse)('', { status: 403 }));
    return { notModified: false, body: '<script type="application/ld+json">{"@type":"Recipe","name":"Fixture soup"}</script>' };
  });
  const response = await POST(req({ as: 'parentA', method: 'POST', body: { url: 'https://example.org/soup' } }));
  expect(response.status).toBe(403);
  expect(mockFetch).toHaveBeenCalledTimes(1);
  expect(db.writes).toHaveLength(0);
});
it('does not contact a publisher after the original role changes during rate limiting', async () => {
  (checkRateLimit as jest.Mock).mockImplementationOnce(async () => {
    db.find('user', 'parent-a')!.role = 'child';
    return { allowed: true };
  });
  const response = await POST(req({ as: 'parentA', method: 'POST', body: { url: 'https://example.org/soup' } }));
  expect(response.status).toBe(409);
  expect(mockFetch).not.toHaveBeenCalled();
});

// Authored UNRUN: optional owner continuity rejects before outbound traffic.
it.each([['preview', POST, { url: 'https://example.org/soup' }],
  ['discover', discover, { query: 'soup', source: 'BBC Good Food' }]] as const)(
  'refuses a foreign expected %s owner before publisher requests', async (_kind, handle, body) => {
    const response = await handle(req({ as: 'parentA', method: 'POST', body, headers: {
      'X-Herewoven-Recipe-Owner': JSON.stringify({ protocol: 'herewoven.recipe-owner.v1', actorId: 'parent-b', familyId: 'family-B', role: 'parent', generation: 0 }),
    } }));
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: { code: 'RECIPE_OWNER_CHANGED' } });
    expect(mockFetch).not.toHaveBeenCalled();
    expect(db.writes).toHaveLength(0);
  });
