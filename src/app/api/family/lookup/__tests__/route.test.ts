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

function makeRequest(code = "FAMILY-ABC", ip = "203.0.113.10") {
  const url = new URL("https://family.test/api/family/lookup");
  url.searchParams.set("code", code);

  return {
    nextUrl: url,
    headers: new Headers({
      "x-forwarded-for": `${ip}, 10.0.0.1`,
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

  it("returns 429 with Retry-After when the lookup bucket is exhausted", async () => {
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
    expect(maxAttempts).toBe(20);
    expect(windowMs).toBe(60 * 1000);
  });

  it("allows an unexhausted lookup to use the existing family semantics", async () => {
    const response = await GET(makeRequest());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      family: { id: "family-1", name: "Household" },
    });
    expect(mockFindUnique).toHaveBeenCalledWith({
      where: { invite_code: "FAMILY-ABC" },
      select: { id: true, name: true },
    });
  });
});
