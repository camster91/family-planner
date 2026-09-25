// Route-level test for POST /api/medications: person_id and sick_day_id must
// belong to the caller's family, otherwise a parent could attach records to
// another household's rows.

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
    sickDay: { findFirst: jest.fn() },
    medication: { create: jest.fn() },
  },
}));

import { POST } from "../route";
import { getServerUser } from "@/lib/supabase/server";
import { featureGate } from "@/lib/feature-gate-server";
import { prisma } from "@/lib/prisma";

const mockGetServerUser = getServerUser as jest.Mock;
const mockFeatureGate = featureGate as jest.Mock;
const mockUserFindFirst = (prisma as any).user.findFirst as jest.Mock;
const mockSickDayFindFirst = (prisma as any).sickDay.findFirst as jest.Mock;
const mockCreate = (prisma as any).medication.create as jest.Mock;

const USERS = [
  { id: "parent-a", email: "pa@a.test", role: "parent", family_id: "family-A" },
  { id: "child-a", email: "ca@a.test", role: "child", family_id: "family-A" },
  { id: "parent-b", email: "pb@b.test", role: "parent", family_id: "family-B" },
  { id: "child-b", email: "cb@b.test", role: "child", family_id: "family-B" },
];
const SICK_DAYS = [
  { id: "sick-a", family_id: "family-A" },
  { id: "sick-b", family_id: "family-B" },
];
const user = (id: string) => USERS.find((u) => u.id === id)!;

function makeRequest(body: unknown) {
  return { json: async () => body } as any;
}

const base = { name: "Ibuprofen", dosage: "5ml", schedule: "every 6h" };

describe("POST /api/medications — cross-family references", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockFeatureGate.mockResolvedValue(null);
    mockUserFindFirst.mockImplementation(async ({ where }: any) => {
      const u = USERS.find((x) => x.id === where.id && x.family_id === where.family_id);
      return u ? { id: u.id } : null;
    });
    mockSickDayFindFirst.mockImplementation(async ({ where }: any) => {
      const s = SICK_DAYS.find((x) => x.id === where.id && x.family_id === where.family_id);
      return s ? { id: s.id } : null;
    });
    mockCreate.mockImplementation(async ({ data }: any) => ({ id: "med-new", ...data }));
  });

  it("rejects a child caller with 403", async () => {
    mockGetServerUser.mockResolvedValue(user("child-a"));
    const res = await POST(makeRequest({ ...base, person_id: "child-a" }));
    expect(res.status).toBe(403);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("rejects a family-B person_id from a family-A parent with 400", async () => {
    mockGetServerUser.mockResolvedValue(user("parent-a"));

    const res = await POST(makeRequest({ ...base, person_id: "child-b" }));

    expect(res.status).toBe(400);
    expect(mockUserFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "child-b", family_id: "family-A" } })
    );
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("rejects a family-B sick_day_id from a family-A parent with 400", async () => {
    mockGetServerUser.mockResolvedValue(user("parent-a"));

    const res = await POST(makeRequest({ ...base, person_id: "child-a", sick_day_id: "sick-b" }));

    expect(res.status).toBe(400);
    expect(mockSickDayFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "sick-b", family_id: "family-A" } })
    );
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("creates the medication for a same-family person and sick day (201)", async () => {
    mockGetServerUser.mockResolvedValue(user("parent-a"));

    const res = await POST(makeRequest({ ...base, person_id: "child-a", sick_day_id: "sick-a" }));

    expect(res.status).toBe(201);
    expect(mockCreate).toHaveBeenCalledTimes(1);
    const { data } = mockCreate.mock.calls[0][0];
    expect(data).toMatchObject({
      family_id: "family-A",
      person_id: "child-a",
      sick_day_id: "sick-a",
      created_by: "parent-a",
    });
  });

  it("creates a medication without a sick day for a same-family person (201)", async () => {
    mockGetServerUser.mockResolvedValue(user("parent-a"));

    const res = await POST(makeRequest({ ...base, person_id: "child-a" }));

    expect(res.status).toBe(201);
    expect(mockSickDayFindFirst).not.toHaveBeenCalled();
    expect(mockCreate.mock.calls[0][0].data.sick_day_id).toBeNull();
  });

  it("family-B parent is symmetric: cannot target family-A person", async () => {
    mockGetServerUser.mockResolvedValue(user("parent-b"));
    const res = await POST(makeRequest({ ...base, person_id: "child-a" }));
    expect(res.status).toBe(400);
    expect(mockCreate).not.toHaveBeenCalled();
  });
});
