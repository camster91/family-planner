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
jest.mock("@/lib/api-auth", () => ({
  authenticateWithFamily: jest.fn(),
  requireParent: jest.fn(() => null),
}));
jest.mock("@/lib/person-chore-create", () => ({
  personChoreCreateAuthority: jest.fn(),
  ACCOUNT_CHORE_CREATE_ACTION: "chore.create",
}));
jest.mock("@/lib/household-lock", () => ({
  lockUser: jest.fn(),
  lockHousehold: jest.fn(),
}));
jest.mock("@/lib/profile-chore-gates", () => ({
  isProfileChoreEnabled: jest.fn(() => true),
}));
jest.mock("@/lib/prisma", () => ({ prisma: { $transaction: jest.fn() } }));
import type { NextRequest } from "next/server";
import { GET } from "../route";
import { authenticateWithFamily } from "@/lib/api-auth";
import { personChoreCreateAuthority } from "@/lib/person-chore-create";
import { prisma } from "@/lib/prisma";
const hash = "a".repeat(64),
  key = "fixture_chore_request";
const tx = {
  idempotencyRecord: { findFirst: jest.fn() },
  chore: { findFirst: jest.fn() },
};
const request = () =>
  ({
    headers: new Headers({
      "Idempotency-Key": key,
      "X-Chore-Request-Hash": hash,
      "X-Chore-Create-Action": "chore.create",
    }),
  }) as NextRequest;
const record = (extra: Record<string, unknown> = {}) => ({
  user_id: "fixture-parent",
  family_id: "fixture-family-a",
  action: "chore.create",
  request_hash: hash,
  response_status: 201,
  response_body: { choreId: "fixture-chore", privateTitle: "Private" },
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
  jest.mocked(personChoreCreateAuthority).mockResolvedValue(null);
  (prisma!.$transaction as jest.Mock).mockImplementation((run) => run(tx));
  tx.idempotencyRecord.findFirst.mockResolvedValue(record());
  tx.chore.findFirst.mockResolvedValue({ id: "fixture-chore" });
});
it("checks current canonical authority before looking at a receipt", async () => {
  jest
    .mocked(personChoreCreateAuthority)
    .mockResolvedValue({ status: 403, body: { error: { code: "FORBIDDEN" } } });
  const result = await GET(request());
  expect(result.status).toBe(403);
  expect(tx.idempotencyRecord.findFirst).not.toHaveBeenCalled();
  expect(tx.chore.findFirst).not.toHaveBeenCalled();
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
  expect(tx.chore.findFirst).toHaveBeenCalledWith({
    where: {
      id: "fixture-chore",
      family_id: "fixture-family-a",
      member_subject_erased: false,
    },
    select: { id: true },
  });
  tx.chore.findFirst.mockResolvedValue(null);
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
    record({ action: "chore.profile.create" }),
  );
  expect((await GET(request())).status).toBe(409);
  expect(tx.chore.findFirst).not.toHaveBeenCalled();
});
