// Owner decision 2026-11-19: a child reads pickups only. The D1 (production)
// path must refuse a child's create and complete as well, both in the route
// and inside the native D1 authority, so a direct API call cannot bypass the
// page. Two households: a child of another household is refused too.

jest.mock("next/server", () => {
  const { NextRequest } = jest.requireActual(
    "next/server",
  ) as typeof import("next/server");
  return {
    NextRequest,
    NextResponse: {
      json: (data: unknown, init?: any) => ({
        status: init?.status ?? 200,
        headers: new Headers(init?.headers),
        json: async () => data,
      }),
    },
  };
});
jest.mock("@/lib/storage-backend", () => ({ storageBackend: () => "d1" }));
const mockAuth = jest.fn();
jest.mock("@/lib/api-auth", () => ({
  authenticateWithFamily: (...args: unknown[]) => mockAuth(...args),
}));
jest.mock("@/lib/cloudflare/database", () => ({
  getD1Database: jest.fn(async () => ({})),
}));
// The native effect runner is replaced by one that only runs the authority
// check, with an in-memory read client for two households.
const users: Record<string, { family_id: string; role: string; token_version: number }> = {
  "child-a": { family_id: "family-A", role: "child", token_version: 0 },
  "teen-a": { family_id: "family-A", role: "teen", token_version: 0 },
  "child-b": { family_id: "family-B", role: "child", token_version: 0 },
};
const readDb = {
  user: {
    findUnique: async ({ where }: any) => users[where.id] ?? null,
  },
  family: {
    findUnique: async () => ({ features: { pickups: true } }),
  },
};
const planned = jest.fn();
jest.mock("@/lib/cloudflare/person-effect", () => ({
  D1PersonReceiptError: class extends Error {},
  executeD1PersonEffect: async ({ authorize }: any) => {
    const denied = await authorize(readDb);
    if (denied) return denied;
    planned();
    return { status: 200, body: { ok: true } };
  },
}));
jest.mock("@/lib/cloudflare/read-client", () => ({
  withD1ReadClient: async (fn: any) => fn(readDb),
}));

import { NextRequest } from "next/server";
import { POST } from "../route";
import { PATCH } from "../[id]/route";
import { createD1Pickup, updateD1Pickup } from "@/lib/cloudflare/pickups";

function as(id: string) {
  mockAuth.mockResolvedValue([
    {
      user: { id, family_id: users[id].family_id, role: users[id].role, name: id },
      payload: { tv: 0 },
    },
    null,
  ]);
}
const request = (body: unknown, method = "POST") =>
  new NextRequest("http://localhost/api/pickups", {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
const params = { params: Promise.resolve({ id: "pickup-a" }) };
const create = { title: "Library pickup", pickup_time: "2030-10-16T15:00:00.000Z" };

beforeEach(() => {
  mockAuth.mockReset();
  planned.mockClear();
});

describe("pickups on D1 — children read only", () => {
  it.each(["child-a", "child-b"])(
    "the route refuses %s creating or completing a pickup before any effect",
    async (who) => {
      as(who);
      expect((await POST(request(create))).status).toBe(403);
      expect((await PATCH(request({ completed: true }, "PATCH"), params)).status).toBe(403);
      expect(planned).not.toHaveBeenCalled();
    },
  );

  it("a teen still gets through to the effect", async () => {
    as("teen-a");
    expect((await POST(request(create))).status).toBe(200);
    expect(planned).toHaveBeenCalledTimes(1);
  });

  it("the native authority refuses a child even when called directly", async () => {
    const actor = { userId: "child-a", familyId: "family-A", role: "child", generation: 0 };
    expect((await createD1Pickup(actor, create as any, {} as any)).status).toBe(403);
    expect((await updateD1Pickup(actor, "pickup-a", true, {} as any)).status).toBe(403);
    expect(planned).not.toHaveBeenCalled();
    const teen = { userId: "teen-a", familyId: "family-A", role: "teen", generation: 0 };
    expect((await createD1Pickup(teen, create as any, {} as any)).status).toBe(200);
  });
});
