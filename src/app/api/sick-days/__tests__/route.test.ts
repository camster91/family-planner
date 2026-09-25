// Route-level test for POST /api/sick-days: the sick person must be a member
// of the caller's family.

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
    user: { findFirst: jest.fn() },
    sickDay: { create: jest.fn() },
  },
}));

import { POST } from "../route";
import { getServerUser } from "@/lib/supabase/server";
import { featureGate } from "@/lib/feature-gate-server";
import { prisma } from "@/lib/prisma";

const mockGetServerUser = getServerUser as jest.Mock;
const mockFeatureGate = featureGate as jest.Mock;
const mockUserFindFirst = (prisma as any).user.findFirst as jest.Mock;
const mockCreate = (prisma as any).sickDay.create as jest.Mock;

const USERS = [
  { id: "parent-a", email: "pa@a.test", role: "parent", family_id: "family-A" },
  { id: "child-a", email: "ca@a.test", role: "child", family_id: "family-A" },
  { id: "parent-b", email: "pb@b.test", role: "parent", family_id: "family-B" },
  { id: "child-b", email: "cb@b.test", role: "child", family_id: "family-B" },
];
const user = (id: string) => USERS.find((u) => u.id === id)!;

function makeRequest(body: unknown) {
  return { json: async () => body } as any;
}

describe("POST /api/sick-days — cross-family references", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockFeatureGate.mockResolvedValue(null);
    mockUserFindFirst.mockImplementation(async ({ where }: any) => {
      const u = USERS.find((x) => x.id === where.id && x.family_id === where.family_id);
      return u ? { id: u.id } : null;
    });
    mockCreate.mockImplementation(async ({ data }: any) => ({ id: "sick-new", ...data }));
  });

  it.each([["parent-a"], ["child-a"]])(
    "rejects a family-B person_id from family-A caller %s with 400",
    async (callerId) => {
      mockGetServerUser.mockResolvedValue(user(callerId));

      const res = await POST(makeRequest({ person_id: "child-b", severity: "mild" }));

      expect(res.status).toBe(400);
      expect(mockUserFindFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: "child-b", family_id: "family-A" } })
      );
      expect(mockCreate).not.toHaveBeenCalled();
    }
  );

  it("rejects an unknown severity with 400", async () => {
    mockGetServerUser.mockResolvedValue(user("parent-a"));
    const res = await POST(makeRequest({ person_id: "child-a", severity: "catastrophic" }));
    expect(res.status).toBe(400);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("creates a sick day for a same-family person (201)", async () => {
    mockGetServerUser.mockResolvedValue(user("parent-a"));

    const res = await POST(makeRequest({ person_id: "child-a", severity: "moderate", symptoms: " fever " }));

    expect(res.status).toBe(201);
    expect(mockCreate.mock.calls[0][0].data).toEqual({
      family_id: "family-A",
      person_id: "child-a",
      severity: "moderate",
      symptoms: "fever",
      created_by: "parent-a",
    });
  });

  it("returns 401 without a session", async () => {
    mockGetServerUser.mockResolvedValue(null);
    const res = await POST(makeRequest({ person_id: "child-a", severity: "mild" }));
    expect(res.status).toBe(401);
    expect(mockUserFindFirst).not.toHaveBeenCalled();
  });
});
