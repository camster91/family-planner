// Route-level test for PATCH /api/allowance/[id]: only a parent of the owning
// family may change an allowance, and only to a known status.

jest.mock("next/server", () => ({
  NextResponse: {
    json: (data: unknown, init?: any) => ({
      status: init?.status ?? 200,
      headers: new Headers(init?.headers),
      json: async () => data,
    }),
  },
}));

jest.mock("@/lib/supabase/server", () => ({
  getServerUser: jest.fn(),
}));

jest.mock("@/lib/feature-gate-server", () => ({
  featureGate: jest.fn(),
}));

jest.mock("@/lib/prisma", () => ({
  prisma: {
    allowance: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
  },
}));

import { PATCH } from "../route";
import { getServerUser } from "@/lib/supabase/server";
import { featureGate } from "@/lib/feature-gate-server";
import { prisma } from "@/lib/prisma";

const mockGetServerUser = getServerUser as jest.Mock;
const mockFeatureGate = featureGate as jest.Mock;
const mockFindUnique = (prisma as any).allowance.findUnique as jest.Mock;
const mockUpdate = (prisma as any).allowance.update as jest.Mock;

const USERS = {
  parentA: { id: "parent-a", email: "pa@a.test", role: "parent", family_id: "family-A" },
  childA: { id: "child-a", email: "ca@a.test", role: "child", family_id: "family-A" },
  parentB: { id: "parent-b", email: "pb@b.test", role: "parent", family_id: "family-B" },
};

const ALLOWANCES: Record<string, { family_id: string; status: string }> = {
  "allow-a": { family_id: "family-A", status: "pending" },
};

function makeRequest(body: unknown) {
  return { json: async () => body } as any;
}

function ctx(id: string) {
  return { params: Promise.resolve({ id }) };
}

describe("PATCH /api/allowance/[id]", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockFeatureGate.mockResolvedValue(null);
    mockFindUnique.mockImplementation(async ({ where }: any) => ALLOWANCES[where.id] ?? null);
    mockUpdate.mockImplementation(async ({ where, data }: any) => ({ id: where.id, ...data }));
  });

  it("returns 401 without a session", async () => {
    mockGetServerUser.mockResolvedValue(null);
    const res = await PATCH(makeRequest({ status: "paid" }), ctx("allow-a"));
    expect(res.status).toBe(401);
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("rejects a child of the same family with 403", async () => {
    mockGetServerUser.mockResolvedValue(USERS.childA);

    const res = await PATCH(makeRequest({ status: "paid" }), ctx("allow-a"));

    expect(res.status).toBe(403);
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("hides another family's allowance from a parent of family-B (404)", async () => {
    mockGetServerUser.mockResolvedValue(USERS.parentB);

    const res = await PATCH(makeRequest({ status: "paid" }), ctx("allow-a"));

    expect([403, 404]).toContain(res.status);
    expect(res.status).toBe(404);
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("returns 404 for an allowance that does not exist", async () => {
    mockGetServerUser.mockResolvedValue(USERS.parentA);
    const res = await PATCH(makeRequest({ status: "paid" }), ctx("missing"));
    expect(res.status).toBe(404);
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it.each([["approved"], [""], [42], [null], [undefined]])(
    "rejects invalid status %p with 400",
    async (status) => {
      mockGetServerUser.mockResolvedValue(USERS.parentA);

      const res = await PATCH(makeRequest({ status }), ctx("allow-a"));

      expect(res.status).toBe(400);
      expect(mockUpdate).not.toHaveBeenCalled();
    }
  );

  it("rejects a malformed JSON body with 400", async () => {
    mockGetServerUser.mockResolvedValue(USERS.parentA);
    const req = { json: async () => { throw new SyntaxError("bad json"); } } as any;

    const res = await PATCH(req, ctx("allow-a"));

    expect(res.status).toBe(400);
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("lets a parent of the owning family mark it paid (200)", async () => {
    mockGetServerUser.mockResolvedValue(USERS.parentA);

    const res = await PATCH(makeRequest({ status: "paid" }), ctx("allow-a"));

    expect(res.status).toBe(200);
    expect(mockUpdate).toHaveBeenCalledTimes(1);
    const { where, data } = mockUpdate.mock.calls[0][0];
    expect(where).toEqual({ id: "allow-a" });
    expect(data.status).toBe("paid");
    expect(data.paid_at).toBeInstanceOf(Date);
    // Only status/paid_at are written — nothing from the body leaks through.
    expect(Object.keys(data).sort()).toEqual(["paid_at", "status"]);
    const body = await res.json();
    expect(body.allowance.status).toBe("paid");
  });

  it.each([["pending"], ["cancelled"]])(
    "lets a parent of the owning family set status %s without paid_at",
    async (status) => {
      mockGetServerUser.mockResolvedValue(USERS.parentA);

      const res = await PATCH(makeRequest({ status, family_id: "family-B", amount: 9999 }), ctx("allow-a"));

      expect(res.status).toBe(200);
      const { data } = mockUpdate.mock.calls[0][0];
      expect(data.status).toBe(status);
      expect(data.paid_at).toBeUndefined();
      expect(data).not.toHaveProperty("family_id");
      expect(data).not.toHaveProperty("amount");
    }
  );
});
