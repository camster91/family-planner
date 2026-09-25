// Route-level test: the GDPR export must never leak household secrets.
// Children can call this endpoint too, so the family object must be built from
// an explicit select that omits feed_token, invite_code and the capture AI
// provider settings.

jest.mock("next/server", () => {
  class MockNextResponse {
    status: number;
    headers: Headers;
    body: unknown;
    constructor(body?: unknown, init?: { status?: number; headers?: Record<string, string> }) {
      this.body = body;
      this.status = init?.status ?? 200;
      this.headers = new Headers(init?.headers);
    }
    async json() {
      return typeof this.body === "string" ? JSON.parse(this.body) : this.body;
    }
    async text() {
      return typeof this.body === "string" ? this.body : JSON.stringify(this.body);
    }
    static json(data: unknown, init?: { status?: number; headers?: Record<string, string> }) {
      return new MockNextResponse(data, init);
    }
  }
  return { NextResponse: MockNextResponse, NextRequest: class {} };
});

jest.mock("@/lib/api-auth", () => ({
  authenticateRequest: jest.fn(),
}));

jest.mock("@/lib/prisma", () => {
  const findMany = () => jest.fn().mockResolvedValue([]);
  return {
    prisma: {
      user: { findUnique: jest.fn() },
      family: { findUnique: jest.fn() },
      chore: { findMany: findMany() },
      list: { findMany: findMany() },
      message: { findMany: findMany() },
      event: { findMany: findMany() },
      reward: { findMany: findMany() },
      notification: { findMany: findMany() },
      activity: { findMany: findMany() },
      transaction: { findMany: findMany() },
      project: { findMany: findMany() },
      recipe: { findMany: findMany() },
      mealPlan: { findMany: findMany() },
      shoppingList: { findMany: findMany() },
      habit: { findMany: findMany() },
      habitLog: { findMany: findMany() },
      earnedBadge: { findMany: findMany() },
      rewardRedemption: { findMany: findMany() },
      familyGoal: { findMany: findMany() },
      importJob: { findMany: findMany() },
      financialArchiveRecord: { findMany: findMany() },
    },
  };
});

import { GET } from "../route";
import { authenticateRequest } from "@/lib/api-auth";
import { prisma } from "@/lib/prisma";

const mockAuth = authenticateRequest as jest.Mock;
const mockUserFindUnique = (prisma as any).user.findUnique as jest.Mock;
const mockFamilyFindUnique = (prisma as any).family.findUnique as jest.Mock;

const SECRET_FIELDS = ["feed_token", "invite_code", "capture_ai_key_enc", "capture_ai_base_url"];

// Full rows as they would sit in the database, secrets included.
const FAMILIES: Record<string, Record<string, unknown>> = {
  "family-A": {
    id: "family-A",
    name: "Household A",
    subscription_tier: "free",
    features: {},
    travel_mode_active: false,
    travel_start_date: null,
    travel_end_date: null,
    travel_destination: null,
    created_at: new Date("2026-01-01T00:00:00Z"),
    feed_token: "feed-secret-A",
    invite_code: "INVITE-A",
    capture_ai_key_enc: "v1:iv:tag:ciphertext-A",
    capture_ai_base_url: "https://provider-a.example",
    capture_ai_model: "model-a",
  },
  "family-B": {
    id: "family-B",
    name: "Household B",
    feed_token: "feed-secret-B",
    invite_code: "INVITE-B",
    capture_ai_key_enc: "v1:iv:tag:ciphertext-B",
    capture_ai_base_url: "https://provider-b.example",
  },
};

const USERS: Record<string, Record<string, unknown>> = {
  "parent-a": { id: "parent-a", email: "pa@a.test", name: "Parent A", role: "parent", family_id: "family-A", password: "hash" },
  "child-a": { id: "child-a", email: "ca@a.test", name: "Child A", role: "child", family_id: "family-A", password: "hash" },
  "parent-b": { id: "parent-b", email: "pb@b.test", name: "Parent B", role: "parent", family_id: "family-B", password: "hash" },
};

// Apply a Prisma `select` to a row the way the real client would.
function project(row: Record<string, unknown> | undefined, select?: Record<string, unknown>) {
  if (!row) return null;
  if (!select) return { ...row };
  const out: Record<string, unknown> = {};
  for (const [key, on] of Object.entries(select)) {
    if (on && key in row) out[key] = row[key];
  }
  return out;
}

function makeRequest() {
  return { headers: new Headers(), cookies: { get: () => undefined } } as any;
}

describe("GET /api/users/export — family secrets", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUserFindUnique.mockImplementation(async ({ where, select }: any) =>
      project(USERS[where.id], select)
    );
    mockFamilyFindUnique.mockImplementation(async ({ where, select }: any) =>
      project(FAMILIES[where.id], select)
    );
  });

  it("returns 401 without touching the database when unauthenticated", async () => {
    const unauthorized = { status: 401, json: async () => ({ error: "Unauthorized" }) };
    mockAuth.mockResolvedValue([null, unauthorized]);

    const res = await GET(makeRequest());

    expect(res.status).toBe(401);
    expect(mockUserFindUnique).not.toHaveBeenCalled();
    expect(mockFamilyFindUnique).not.toHaveBeenCalled();
  });

  it.each([
    ["child", "child-a"],
    ["parent", "parent-a"],
  ])("a %s export uses an explicit family select that excludes secrets", async (_role, userId) => {
    mockAuth.mockResolvedValue([{ userId }, null]);

    const res = await GET(makeRequest());
    expect(res.status).toBe(200);

    expect(mockFamilyFindUnique).toHaveBeenCalledTimes(1);
    const args = mockFamilyFindUnique.mock.calls[0][0];
    expect(args.where).toEqual({ id: "family-A" });
    expect(args.select).toBeDefined();
    expect(args.include).toBeUndefined();
    for (const field of SECRET_FIELDS) {
      expect(args.select).not.toHaveProperty(field);
    }

    const body = await res.json();
    expect(body.family).toMatchObject({ id: "family-A", name: "Household A" });
    for (const field of SECRET_FIELDS) {
      expect(body.family).not.toHaveProperty(field);
    }

    // Belt and braces: no secret value appears anywhere in the serialized export.
    const raw = await res.text();
    for (const secret of ["feed-secret-A", "INVITE-A", "ciphertext-A", "provider-a.example"]) {
      expect(raw).not.toContain(secret);
    }
    // And the user's password hash is not exported either.
    expect(body.user).not.toHaveProperty("password");
  });

  it("only a parent's export carries the family's travel plans (parent-only, #102)", async () => {
    FAMILIES["family-A"].travel_destination = "Lisbon";

    mockAuth.mockResolvedValue([{ userId: "child-a" }, null]);
    const child = await (await GET(makeRequest())).json();
    expect(child.family).not.toHaveProperty("travel_destination");
    expect(child.family).not.toHaveProperty("travel_mode_active");
    expect(JSON.stringify(child)).not.toContain("Lisbon");

    mockAuth.mockResolvedValue([{ userId: "parent-a" }, null]);
    const parent = await (await GET(makeRequest())).json();
    expect(parent.family.travel_destination).toBe("Lisbon");

    FAMILIES["family-A"].travel_destination = null;
  });

  it("only ever exports the caller's own family, never another household", async () => {
    mockAuth.mockResolvedValue([{ userId: "parent-a" }, null]);

    const res = await GET(makeRequest());
    const body = await res.json();

    expect(body.family.id).toBe("family-A");
    for (const call of mockFamilyFindUnique.mock.calls) {
      expect(call[0].where.id).not.toBe("family-B");
    }
    expect(await res.text()).not.toContain("Household B");
  });
});
