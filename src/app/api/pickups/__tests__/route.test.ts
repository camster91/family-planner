// Route-level test for POST /api/pickups: an assignee, if given, must be a
// member of the caller's family.

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
    pickup: { create: jest.fn() },
  },
}));

import { POST } from "../route";
import { getServerUser } from "@/lib/supabase/server";
import { featureGate } from "@/lib/feature-gate-server";
import { prisma } from "@/lib/prisma";

const mockGetServerUser = getServerUser as jest.Mock;
const mockFeatureGate = featureGate as jest.Mock;
const mockUserFindFirst = (prisma as any).user.findFirst as jest.Mock;
const mockCreate = (prisma as any).pickup.create as jest.Mock;

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

const base = { title: "Soccer pickup", pickup_time: "2026-10-01T16:00:00Z" };

describe("POST /api/pickups — cross-family references", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockFeatureGate.mockResolvedValue(null);
    mockUserFindFirst.mockImplementation(async ({ where }: any) => {
      const u = USERS.find((x) => x.id === where.id && x.family_id === where.family_id);
      return u ? { id: u.id } : null;
    });
    mockCreate.mockImplementation(async ({ data }: any) => ({ id: "pickup-new", ...data }));
  });

  it("rejects a family-B assigned_to from a family-A parent with 400", async () => {
    mockGetServerUser.mockResolvedValue(user("parent-a"));

    const res = await POST(makeRequest({ ...base, assigned_to: "parent-b" }));

    expect(res.status).toBe(400);
    expect(mockUserFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "parent-b", family_id: "family-A" } })
    );
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("rejects a family-B assigned_to from a family-A child with 400", async () => {
    mockGetServerUser.mockResolvedValue(user("child-a"));
    const res = await POST(makeRequest({ ...base, assigned_to: "child-b" }));
    expect(res.status).toBe(400);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("creates a pickup assigned to a same-family member (201)", async () => {
    mockGetServerUser.mockResolvedValue(user("parent-a"));

    const res = await POST(makeRequest({ ...base, assigned_to: "child-a" }));

    expect(res.status).toBe(201);
    const { data } = mockCreate.mock.calls[0][0];
    expect(data).toMatchObject({
      family_id: "family-A",
      created_by: "parent-a",
      assigned_to: "child-a",
      title: "Soccer pickup",
    });
    expect(data.pickup_time).toBeInstanceOf(Date);
  });

  it("creates an unassigned pickup without an assignee lookup (201)", async () => {
    mockGetServerUser.mockResolvedValue(user("parent-a"));

    const res = await POST(makeRequest(base));

    expect(res.status).toBe(201);
    expect(mockUserFindFirst).not.toHaveBeenCalled();
    expect(mockCreate.mock.calls[0][0].data.assigned_to).toBeNull();
  });
});
