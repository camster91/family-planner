/** Authored only; consolidated QA has not run these cases. */
jest.mock("next/server", () => ({
  NextResponse: {
    json: (
      body: unknown,
      init?: { status?: number; headers?: HeadersInit },
    ) => ({
      status: init?.status ?? 200,
      headers: new Headers(init?.headers),
      json: async () => body,
    }),
  },
}));
jest.mock("@/lib/api-auth", () => ({ authenticateWithFamily: jest.fn() }));
jest.mock("@/lib/recipe-write", () => ({
  recipeWriteAuthority: jest.fn(),
  RECIPE_CREATE_ACTION: "recipe.create",
}));
jest.mock("@/lib/prisma", () => ({ prisma: { $transaction: jest.fn() } }));
import type { NextRequest } from "next/server";
import { GET } from "../route";
import { authenticateWithFamily } from "@/lib/api-auth";
import { recipeWriteAuthority } from "@/lib/recipe-write";
import { prisma } from "@/lib/prisma";
const hash = "a".repeat(64),
  key = "fixture_recipe_request";
const tx = {
  idempotencyRecord: { findFirst: jest.fn() },
  recipe: { findFirst: jest.fn() },
};
const request = () =>
  ({
    headers: new Headers({
      "Idempotency-Key": key,
      "X-Recipe-Request-Hash": hash,
    }),
  }) as NextRequest;
const record = (extra: Record<string, unknown> = {}) => ({
  family_id: "fixture-family-a",
  action: "recipe.create",
  request_hash: hash,
  response_status: 201,
  response_body: { recipeId: "fixture-recipe", privateTitle: "Private" },
  expires_at: new Date(Date.now() + 60000),
  ...extra,
});
beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(authenticateWithFamily).mockResolvedValue([
    {
      user: {
        id: "fixture-parent",
        family_id: "fixture-family-a",
        role: "parent",
      },
      payload: { tv: 3 },
    },
    null,
  ] as never);
  jest.mocked(recipeWriteAuthority).mockResolvedValue(null);
  (prisma!.$transaction as jest.Mock).mockImplementation((run) => run(tx));
  tx.idempotencyRecord.findFirst.mockResolvedValue(record());
  tx.recipe.findFirst.mockResolvedValue({ id: "fixture-recipe" });
});
it("checks current canonical authority before looking at a receipt", async () => {
  jest
    .mocked(recipeWriteAuthority)
    .mockResolvedValue({ status: 403, body: { error: { code: "FORBIDDEN" } } });
  const result = await GET(request());
  expect(result.status).toBe(403);
  expect(tx.idempotencyRecord.findFirst).not.toHaveBeenCalled();
  expect(tx.recipe.findFirst).not.toHaveBeenCalled();
});
it("returns only same-household receipt/current state and never cached content", async () => {
  const result = await GET(request());
  expect(await result.json()).toEqual({
    state: "committed",
    current: "present",
  });
  expect(result.headers.get("Cache-Control")).toBe("private, no-store");
  expect(tx.idempotencyRecord.findFirst).toHaveBeenCalledWith(
    expect.objectContaining({
      where: { scope: "user:fixture-parent", key },
    }),
  );
  expect(tx.recipe.findFirst).toHaveBeenCalledWith({
    where: { id: "fixture-recipe", family_id: "fixture-family-a" },
    select: { id: true },
  });
  tx.recipe.findFirst.mockResolvedValue(null);
  expect(await (await GET(request())).json()).toEqual({
    state: "committed",
    current: "removed",
  });
  tx.idempotencyRecord.findFirst.mockResolvedValue(
    record({ family_id: "fixture-family-b" }),
  );
  expect(await (await GET(request())).json()).toEqual({ state: "absent" });
});
it("distinguishes pending, expired, opaque and conflicting receipts without canonical reads", async () => {
  tx.idempotencyRecord.findFirst.mockResolvedValueOnce(
    record({ response_status: null }),
  );
  expect(await (await GET(request())).json()).toEqual({ state: "pending" });
  tx.idempotencyRecord.findFirst.mockResolvedValueOnce(
    record({ expires_at: new Date(0) }),
  );
  expect(await (await GET(request())).json()).toEqual({ state: "expired" });
  tx.idempotencyRecord.findFirst.mockResolvedValueOnce(
    record({ response_body: { success: true } }),
  );
  expect(await (await GET(request())).json()).toEqual({
    state: "committed",
    current: "unknown",
  });
  tx.idempotencyRecord.findFirst.mockResolvedValueOnce(
    record({ request_hash: "b".repeat(64) }),
  );
  expect((await GET(request())).status).toBe(409);
  tx.idempotencyRecord.findFirst.mockResolvedValueOnce(
    record({
      response_status: 409,
      response_body: { error: { code: "RECIPE_SOURCE_EXISTS" } },
    }),
  );
  expect(await (await GET(request())).json()).toEqual({
    state: "refused",
    reason: "source-exists",
  });
  expect(tx.recipe.findFirst).not.toHaveBeenCalled();
});
