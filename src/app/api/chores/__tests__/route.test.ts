// Route-level test for PATCH /api/chores: a non-parent assignee may edit their
// own chore but must not change the XP-bearing fields (PARENT_ONLY_FIELDS).
// The implementation rejects the whole request with 403 rather than stripping.

jest.mock("next/server", () => ({
  NextResponse: {
    json: (data: unknown, init?: any) => ({
      status: init?.status ?? 200,
      headers: new Headers(init?.headers),
      json: async () => data,
    }),
  },
}));

jest.mock("@/lib/api-auth", () => ({
  authenticateWithFamily: jest.fn(),
  // Same contract as the real helper.
  requireFamilyMatch: (resourceFamilyId: string, userFamilyId: string) =>
    resourceFamilyId !== userFamilyId
      ? { status: 403, json: async () => ({ error: "Forbidden" }) }
      : null,
}));

jest.mock("@/lib/prisma", () => ({
  prisma: {
    chore: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    user: {
      findFirst: jest.fn(),
    },
  },
}));

import { PATCH } from "../route";
import { authenticateWithFamily } from "@/lib/api-auth";
import { prisma } from "@/lib/prisma";

const mockAuth = authenticateWithFamily as jest.Mock;
const mockChoreFindUnique = (prisma as any).chore.findUnique as jest.Mock;
const mockChoreUpdate = (prisma as any).chore.update as jest.Mock;
const mockUserFindFirst = (prisma as any).user.findFirst as jest.Mock;

const USERS = {
  parentA: { id: "parent-a", family_id: "family-A", role: "parent", name: "Parent A", last_chore_date: null },
  childA: { id: "child-a", family_id: "family-A", role: "child", name: "Child A", last_chore_date: null },
  child2A: { id: "child2-a", family_id: "family-A", role: "child", name: "Child 2 A", last_chore_date: null },
  childB: { id: "child-b", family_id: "family-B", role: "child", name: "Child B", last_chore_date: null },
};
const ALL_USERS = Object.values(USERS);

const CHORES: Record<string, { family_id: string; assigned_to: string | null }> = {
  "chore-a": { family_id: "family-A", assigned_to: "child-a" },
};

function asCaller(user: (typeof USERS)[keyof typeof USERS]) {
  mockAuth.mockResolvedValue([{ payload: { userId: user.id }, user }, null]);
}

function makeRequest(body: unknown) {
  return { json: async () => body } as any;
}

describe("PATCH /api/chores — parent-only fields", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockChoreFindUnique.mockImplementation(async ({ where }: any) => CHORES[where.id] ?? null);
    mockChoreUpdate.mockImplementation(async ({ where, data }: any) => ({ id: where.id, ...data }));
    mockUserFindFirst.mockImplementation(async ({ where }: any) => {
      const u = ALL_USERS.find((x) => x.id === where.id && x.family_id === where.family_id);
      return u ? { id: u.id } : null;
    });
  });

  it("rejects a child assignee changing difficulty with 403 and writes nothing", async () => {
    asCaller(USERS.childA);

    const res = await PATCH(makeRequest({ choreId: "chore-a", difficulty: "hard" }));

    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toContain("difficulty");
    expect(mockChoreUpdate).not.toHaveBeenCalled();
  });

  it("rejects the whole request (not a silent strip) when difficulty is mixed with allowed fields", async () => {
    asCaller(USERS.childA);

    const res = await PATCH(makeRequest({ choreId: "chore-a", title: "Tidy room", difficulty: "hard" }));

    expect(res.status).toBe(403);
    expect(mockChoreUpdate).not.toHaveBeenCalled();
  });

  it.each([
    ["points", { points: 999 }],
    ["assigned_to", { assigned_to: "child2-a" }],
    ["frequency", { frequency: "daily" }],
  ])("rejects a child assignee changing %s with 403", async (field, patch) => {
    asCaller(USERS.childA);

    const res = await PATCH(makeRequest({ choreId: "chore-a", ...patch }));

    expect(res.status).toBe(403);
    expect((await res.json()).error).toContain(field);
    expect(mockChoreUpdate).not.toHaveBeenCalled();
  });

  it("lets a child assignee edit a non-privileged field", async () => {
    asCaller(USERS.childA);

    const res = await PATCH(makeRequest({ choreId: "chore-a", title: "Tidy room" }));

    expect(res.status).toBe(200);
    expect(mockChoreUpdate.mock.calls[0][0].data).toEqual({ title: "Tidy room" });
  });

  it("rejects a child who is not the assignee with 403", async () => {
    asCaller(USERS.child2A);
    const res = await PATCH(makeRequest({ choreId: "chore-a", title: "x" }));
    expect(res.status).toBe(403);
    expect(mockChoreUpdate).not.toHaveBeenCalled();
  });

  it("rejects a caller from family-B with 403", async () => {
    asCaller(USERS.childB);
    const res = await PATCH(makeRequest({ choreId: "chore-a", title: "x" }));
    expect(res.status).toBe(403);
    expect(mockChoreUpdate).not.toHaveBeenCalled();
  });

  it("lets a parent of the family change difficulty", async () => {
    asCaller(USERS.parentA);

    const res = await PATCH(makeRequest({ choreId: "chore-a", difficulty: "hard", points: 50 }));

    expect(res.status).toBe(200);
    expect(mockChoreUpdate.mock.calls[0][0].data).toEqual({ difficulty: "hard", points: 50 });
  });

  it("rejects a parent reassigning the chore to a family-B user with 400", async () => {
    asCaller(USERS.parentA);

    const res = await PATCH(makeRequest({ choreId: "chore-a", assigned_to: "child-b" }));

    expect(res.status).toBe(400);
    expect(mockUserFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "child-b", family_id: "family-A" } })
    );
    expect(mockChoreUpdate).not.toHaveBeenCalled();
  });

  it("lets a parent reassign the chore within the family", async () => {
    asCaller(USERS.parentA);

    const res = await PATCH(makeRequest({ choreId: "chore-a", assigned_to: "child2-a" }));

    expect(res.status).toBe(200);
    expect(mockChoreUpdate.mock.calls[0][0].data).toEqual({ assigned_to: "child2-a" });
  });
});
