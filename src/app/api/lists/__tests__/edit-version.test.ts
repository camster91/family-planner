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

import { PATCH } from "../items/edit/route";
import { PATCH as legacy } from "../items/update/route";
import {
  db,
  req,
  writesTo,
  FOREIGN,
  type UserKey,
} from "@/__tests__/helpers/two-household";
import { featureGate } from "@/lib/feature-gate-server";
import { idempotencyRuntime } from "@/lib/idempotency";
import { NextResponse } from "next/server";

const K1 = "11111111-1111-4111-8111-111111111111";
const K2 = "22222222-2222-4222-8222-222222222222";
const row = () => db.find("listItem", "item-a")!;
const data = () => ({
  itemId: "item-a",
  expectedUpdatedAt: row().updated_at.toISOString(),
  content: "Oat milk",
  quantity: 2,
});
const edit = (
  as: UserKey | null,
  body: Record<string, unknown>,
  key: string | null = K1,
) =>
  PATCH(
    req({
      as,
      method: "PATCH",
      body,
      headers: key ? { "Idempotency-Key": key } : {},
    }),
  );

beforeEach(() => {
  db.reset();
  jest.mocked(featureGate).mockResolvedValue(null);
  idempotencyRuntime.random = () => 0.99;
});

it.each(["parentA", "teenA", "childA"] as const)(
  "allows the existing %s grocery edit permission with a current version",
  async (as) => {
    const res = await edit(as, data());
    expect(res.status).toBe(200);
    expect(row()).toMatchObject({ content: "Oat milk", quantity: 2 });
  },
);
it("rejects a stale edit after another member writes and does not change newer values", async () => {
  const stale = data();
  await edit("teenA", { ...stale, content: "Fresh milk" }, K2);
  const res = await edit("parentA", stale);
  expect(res.status).toBe(409);
  expect((await res.json()).error.code).toBe("LIST_ITEM_CHANGED");
  expect(row().content).toBe("Fresh milk");
  expect(writesTo("listItem")).toHaveLength(1);
});
it("retries exactly once and a late replay cannot overwrite a subsequent edit", async () => {
  const first = data();
  expect((await edit("parentA", first)).status).toBe(200);
  const newIntent = { ...data(), content: "Bread", quantity: 3 };
  await edit("teenA", newIntent, K2);
  const replay = await edit("parentA", first);
  expect(replay.status).toBe(200);
  expect(replay.headers.get("Idempotency-Replayed")).toBe("true");
  expect(row()).toMatchObject({ content: "Bread", quantity: 3 });
  expect(writesTo("listItem")).toHaveLength(2);
});
it("legacy tick clients invalidate a field edit snapshot while keeping their old request contract", async () => {
  const stale = data();
  const result = await legacy(
    req({
      as: "childA",
      method: "PATCH",
      body: { itemId: "item-a", checked: true },
    }),
  );
  expect(result.status).toBe(200);
  expect((await edit("parentA", stale)).status).toBe(409);
  expect(row().checked).toBe(true);
});
it("a missing item cannot be resurrected by a cached successful retry", async () => {
  const original = data();
  await edit("parentA", original);
  db.tables.listItem = db.rows("listItem").filter((r) => r.id !== "item-a");
  const result = await edit("parentA", original);
  expect(result.status).toBe(404);
  expect(result.headers.get("Idempotency-Replayed")).toBeNull();
  expect(db.find("listItem", "item-a")).toBeUndefined();
});
it("signed-out and foreign users cannot learn current values or replay another household", async () => {
  const original = data();
  await edit("parentA", original);
  for (const as of [null, "parentB", "childB"] as const) {
    const result = await edit(as, original);
    expect([401, 403]).toContain(result.status);
    expect(result.headers.get("Idempotency-Replayed")).toBeNull();
    const json = JSON.stringify(await result.json());
    expect(json).not.toContain("Oat milk");
    expect(json).not.toContain(FOREIGN);
  }
  expect(writesTo("listItem")).toHaveLength(1);
});
it("a disabled feature is checked before replay", async () => {
  const original = data();
  await edit("parentA", original);
  jest
    .mocked(featureGate)
    .mockResolvedValue(
      NextResponse.json({ error: "Disabled" }, { status: 403 }),
    );
  expect((await edit("parentA", original)).status).toBe(403);
  expect(writesTo("listItem")).toHaveLength(1);
});
it.each([
  { expectedUpdatedAt: "yesterday" },
  { quantity: 0 },
  { quantity: 1.5 },
  { quantity: 10000 },
  { content: " " },
  { content: "x".repeat(501) },
  { checked: true },
  { updated_at: "2026-01-01T00:00:00.000Z" },
])("rejects invalid or extra edit fields %p", async (change) => {
  expect((await edit("parentA", { ...data(), ...change })).status).toBe(400);
  expect(db.writes).toHaveLength(0);
});
it("requires a valid idempotency key", async () => {
  expect((await edit("parentA", data(), null)).status).toBe(400);
  expect((await edit("parentA", data(), "bad key")).status).toBe(400);
  expect(writesTo("listItem")).toHaveLength(0);
});
