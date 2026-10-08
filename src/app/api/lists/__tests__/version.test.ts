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
  checkRateLimit: jest.fn(async () => ({
    allowed: true,
    retryAfterMs: 0,
    remaining: 99,
  })),
}));
import { GET } from "../[id]/version/route";
import { db, req, type UserKey } from "@/__tests__/helpers/two-household";
import { listVersion } from "@/lib/list-version";
import { featureGate } from "@/lib/feature-gate-server";
import { checkRateLimit } from "@/lib/rate-limit-db";
import { NextResponse } from "next/server";
const call = (as: UserKey | null, id = "list-a") =>
  GET(req({ as }), { params: Promise.resolve({ id }) });
beforeEach(() => {
  db.reset();
  jest.mocked(featureGate).mockResolvedValue(null);
  jest.mocked(checkRateLimit).mockClear();
  jest
    .mocked(checkRateLimit)
    .mockResolvedValue({ allowed: true, remaining: 99, retryAfterMs: 0 });
});
it.each(["parentA", "teenA", "childA"] as const)(
  "allows %s and matches the canonical page fingerprint without returning any content",
  async (as) => {
    const result = await call(as);
    expect(result.status).toBe(200);
    expect(await result.json()).toEqual({
      version: listVersion(
        db.find("list", "list-a")! as any,
        db.rows("listItem").filter((r) => r.list_id === "list-a") as any,
      ),
    });
    expect(result.headers.get("Cache-Control")).toBe("private, no-store");
  },
);
it("never reveals foreign existence, content or version and makes no writes", async () => {
  for (const id of ["list-b", "missing"]) {
    const result = await call("parentA", id);
    expect(result.status).toBe(404);
    expect(await result.json()).toEqual({ error: "List not found" });
  }
  expect(db.writes).toHaveLength(0);
});
it("requires a person session before any version read or rate-limit operation", async () => {
  expect((await call(null)).status).toBe(401);
  expect(checkRateLimit).not.toHaveBeenCalled();
});
it("checks the feature before private data and rejects invalid IDs", async () => {
  jest
    .mocked(featureGate)
    .mockResolvedValue(
      NextResponse.json({ error: "Disabled" }, { status: 403 }),
    );
  expect((await call("parentA")).status).toBe(403);
  expect(checkRateLimit).not.toHaveBeenCalled();
  jest.mocked(featureGate).mockResolvedValue(null);
  expect((await call("parentA", "bad/id")).status).toBe(404);
});
it("rate limits across lists by member and returns a bounded retry hint without a digest", async () => {
  jest
    .mocked(checkRateLimit)
    .mockResolvedValue({ allowed: false, retryAfterMs: 42_000, remaining: 0 });
  const result = await call("parentA");
  expect(result.status).toBe(429);
  expect(result.headers.get("Retry-After")).toBe("42");
  expect(await result.json()).toEqual({ error: "Too many requests" });
  expect(checkRateLimit).toHaveBeenCalledWith(
    "list-version:parent-a",
    1200,
    3600000,
  );
});
it("moves for own older-row changes/deletion but not another household", async () => {
  const first = (await (await call("parentA")).json()).version;
  db.find("listItem", "item-b")!.updated_at = new Date("2099-01-01");
  expect((await (await call("parentA")).json()).version).toBe(first);
  db.find("listItem", "item-a")!.updated_at = new Date("2026-01-01");
  expect((await (await call("parentA")).json()).version).not.toBe(first);
  db.tables.listItem = db.rows("listItem").filter((r) => r.id !== "item-a");
  expect((await call("parentA")).status).toBe(200);
});
