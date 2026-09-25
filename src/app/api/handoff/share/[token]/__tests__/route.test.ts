// Route-level test for the public handoff share view: links without an expiry
// fail closed, expired links are rejected, and a valid link only returns the
// babysitter-facing fields (no family_id, created_by or share_token).

jest.mock("next/server", () => ({
  NextResponse: {
    json: (data: unknown, init?: any) => ({
      status: init?.status ?? 200,
      headers: new Headers(init?.headers),
      json: async () => data,
    }),
  },
}));

jest.mock("@/lib/rate-limit-db", () => ({
  checkRateLimit: jest.fn(),
}));

jest.mock("@/lib/prisma", () => ({
  prisma: {
    handoff: { findUnique: jest.fn() },
  },
}));

import { GET } from "../route";
import { checkRateLimit } from "@/lib/rate-limit-db";
import { prisma } from "@/lib/prisma";

const mockCheckRateLimit = checkRateLimit as jest.Mock;
const mockFindUnique = (prisma as any).handoff.findUnique as jest.Mock;

const FAMILIES: Record<string, Record<string, unknown>> = {
  "family-A": { id: "family-A", name: "Household A", invite_code: "INVITE-A", feed_token: "feed-A" },
  "family-B": { id: "family-B", name: "Household B", invite_code: "INVITE-B", feed_token: "feed-B" },
};

const HOUR = 60 * 60 * 1000;

function handoffRow(overrides: Record<string, unknown>): Record<string, unknown> {
  return {
    id: "handoff-x",
    family_id: "family-A",
    created_by: "parent-a",
    share_token: "tok",
    share_expires_at: new Date(Date.now() + HOUR),
    created_at: new Date("2026-09-01T00:00:00Z"),
    updated_at: new Date("2026-09-01T00:00:00Z"),
    sitter_name: "Sam",
    sitter_phone: "555-0100",
    arrival_time: "18:00",
    departure_time: "23:00",
    kids_bedtimes: "8pm",
    where_snacks: "pantry",
    pickup_authorized: "Grandma",
    code_words: "pineapple",
    pet_care: "feed cat",
    emergency_notes: "call 911",
    house_notes: "",
    general_notes: "",
    ...overrides,
  };
}

let HANDOFFS: Record<string, Record<string, unknown>> = {};

// Apply a Prisma `select` (including one level of relation select) to a row.
function project(row: Record<string, unknown>, select: Record<string, any>) {
  const out: Record<string, unknown> = {};
  for (const [key, on] of Object.entries(select)) {
    if (!on) continue;
    if (key === "family") {
      const fam = FAMILIES[row.family_id as string];
      out.family = on.select ? project(fam, on.select) : fam;
    } else if (key in row) {
      out[key] = row[key];
    }
  }
  return out;
}

function makeRequest() {
  return { headers: new Headers({ "x-forwarded-for": "198.51.100.7" }) } as any;
}

function ctx(token: string) {
  return { params: Promise.resolve({ token }) };
}

describe("GET /api/handoff/share/[token]", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockCheckRateLimit.mockResolvedValue({ allowed: true, retryAfterMs: 0, remaining: 59 });
    HANDOFFS = {
      "tok-null": handoffRow({ id: "h-null", share_token: "tok-null", share_expires_at: null }),
      "tok-past": handoffRow({ id: "h-past", share_token: "tok-past", share_expires_at: new Date(Date.now() - 1000) }),
      "tok-valid": handoffRow({ id: "h-valid", share_token: "tok-valid" }),
      "tok-b": handoffRow({ id: "h-b", share_token: "tok-b", family_id: "family-B", created_by: "parent-b" }),
    };
    mockFindUnique.mockImplementation(async ({ where, select }: any) => {
      const row = HANDOFFS[where.share_token];
      return row ? project(row, select) : null;
    });
  });

  it("rejects a link with no expiry (legacy row) — fail closed", async () => {
    const res = await GET(makeRequest(), ctx("tok-null"));
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body).not.toHaveProperty("handoff");
  });

  it("rejects an expired link", async () => {
    const res = await GET(makeRequest(), ctx("tok-past"));
    expect(res.status).toBe(404);
    expect(await res.json()).not.toHaveProperty("handoff");
  });

  it("rejects an unknown token", async () => {
    const res = await GET(makeRequest(), ctx("nope"));
    expect(res.status).toBe(404);
  });

  it("returns 429 without querying when the IP is throttled", async () => {
    mockCheckRateLimit.mockResolvedValue({ allowed: false, retryAfterMs: 1500, remaining: 0 });
    const res = await GET(makeRequest(), ctx("tok-valid"));
    expect(res.status).toBe(429);
    expect(mockFindUnique).not.toHaveBeenCalled();
  });

  it("serves a valid link without internal fields", async () => {
    const res = await GET(makeRequest(), ctx("tok-valid"));

    expect(res.status).toBe(200);
    const select = mockFindUnique.mock.calls[0][0].select;
    for (const field of ["family_id", "created_by", "share_token", "created_at", "updated_at"]) {
      expect(select).not.toHaveProperty(field);
    }
    expect(select.family).toEqual({ select: { name: true } });

    const { handoff } = await res.json();
    expect(handoff).toMatchObject({ id: "h-valid", sitter_name: "Sam", family: { name: "Household A" } });
    for (const field of ["family_id", "created_by", "share_token", "share_expires_at", "created_at", "updated_at"]) {
      expect(handoff).not.toHaveProperty(field);
    }
    expect(Object.keys(handoff.family)).toEqual(["name"]);
    const raw = JSON.stringify(handoff);
    expect(raw).not.toContain("parent-a");
    expect(raw).not.toContain("family-A");
    expect(raw).not.toContain("INVITE-A");
  });

  it("a family-B token only ever resolves family-B's handoff", async () => {
    const res = await GET(makeRequest(), ctx("tok-b"));
    const { handoff } = await res.json();
    expect(handoff.id).toBe("h-b");
    expect(handoff.family).toEqual({ name: "Household B" });
  });
});
