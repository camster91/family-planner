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
  authenticateRequest: jest.fn(),
}));

jest.mock("@/lib/prisma", () => ({
  prisma: {
    family: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
    },
  },
}));

jest.mock("@/lib/rate-limit-db", () => ({
  checkRateLimit: jest.fn(),
}));

import { GET } from "../route";
import { authenticateRequest } from "@/lib/api-auth";
import { prisma } from "@/lib/prisma";
import { checkRateLimit } from "@/lib/rate-limit-db";

const mockAuthenticateRequest = authenticateRequest as jest.Mock;
const mockCheckRateLimit = checkRateLimit as jest.Mock;
const mockFindUnique = (prisma as any).family.findUnique as jest.Mock;
const mockFindFirst = (prisma as any).family.findFirst as jest.Mock;

function makeRequest(code = "K7QM-4XPD-2HNA", ip = "203.0.113.10") {
  const url = new URL("https://family.test/api/family/lookup");
  url.searchParams.set("code", code);

  return {
    nextUrl: url,
    headers: new Headers({
      // The proxy appends the real client address on the right (src/lib/client-ip.ts).
      "x-forwarded-for": `192.0.2.66, ${ip}`,
    }),
  } as any;
}

describe("family lookup rate limiting", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockAuthenticateRequest.mockResolvedValue([{ userId: "user-1" }, null]);
    mockFindUnique.mockResolvedValue({ id: "family-1", name: "Household" });
    mockFindFirst.mockResolvedValue(null);
    mockCheckRateLimit.mockResolvedValue({
      allowed: true,
      retryAfterMs: 0,
      remaining: 19,
    });
  });

  it("returns 429 with Retry-After when the account bucket is exhausted", async () => {
    mockCheckRateLimit.mockResolvedValue({
      allowed: false,
      retryAfterMs: 2501,
      remaining: 0,
    });

    const response = await GET(makeRequest());

    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toBe("3");
    await expect(response.json()).resolves.toEqual({
      error: "Too many lookup attempts",
    });
    expect(mockFindUnique).not.toHaveBeenCalled();

    const [key, maxAttempts, windowMs] = mockCheckRateLimit.mock.calls[0];
    expect(key).toMatch(/^family-lookup:[a-f0-9]{64}$/);
    expect(key).not.toContain("user-1");
    expect(key).not.toContain("203.0.113.10");
    expect(maxAttempts).toBe(30);
    expect(windowMs).toBe(60 * 60 * 1000);
  });

  it("checks a separate per-IP bucket (60/hour) and refuses when only it is exhausted", async () => {
    mockCheckRateLimit.mockImplementation(async (key: string) =>
      key.startsWith("family-lookup-ip:")
        ? { allowed: false, retryAfterMs: 10_000, remaining: 0 }
        : { allowed: true, retryAfterMs: 0, remaining: 5 },
    );

    const response = await GET(makeRequest());

    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toBe("10");
    expect(mockFindUnique).not.toHaveBeenCalled();
    const calls = mockCheckRateLimit.mock.calls;
    expect(calls).toHaveLength(2);
    const [ipKey, ipMax, ipWindow] = calls[1];
    expect(ipKey).toMatch(/^family-lookup-ip:[a-f0-9]{64}$/);
    expect(ipKey).not.toContain("203.0.113.10");
    expect(ipMax).toBe(60);
    expect(ipWindow).toBe(60 * 60 * 1000);
  });

  it("keys the IP bucket on the client IP and the account bucket on the user", async () => {
    await GET(makeRequest("K7QM-4XPD-2HNA", "203.0.113.10"));
    await GET(makeRequest("K7QM-4XPD-2HNA", "203.0.113.99"));
    mockAuthenticateRequest.mockResolvedValue([{ userId: "user-2" }, null]);
    await GET(makeRequest("K7QM-4XPD-2HNA", "203.0.113.10"));

    const keys = mockCheckRateLimit.mock.calls.map(([key]) => key as string);
    const account = keys.filter((k) => k.startsWith("family-lookup:"));
    const ip = keys.filter((k) => k.startsWith("family-lookup-ip:"));
    // Same user, two IPs: one account key, two IP keys.
    expect(account[0]).toBe(account[1]);
    expect(ip[0]).not.toBe(ip[1]);
    // Different user, same IP: a new account key, the same IP key.
    expect(account[2]).not.toBe(account[0]);
    expect(ip[2]).toBe(ip[0]);
  });

  it("looks up the canonical code (lowercase, no dashes) when both buckets allow", async () => {
    const response = await GET(makeRequest());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      family: { id: "family-1", name: "Household" },
    });
    expect(mockFindUnique).toHaveBeenCalledWith({
      where: { invite_code: "k7qm4xpd2hna" },
      select: { id: true, name: true },
    });
  });
});
