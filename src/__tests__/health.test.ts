let mockPrisma: { $queryRaw: jest.Mock } | undefined;

jest.mock("@/lib/prisma", () => ({
  get prisma() {
    return mockPrisma;
  },
}));

jest.mock("next/server", () => ({
  NextResponse: {
    json: (data: unknown, init?: ResponseInit) => ({
      status: init?.status || 200,
      headers: init?.headers,
      json: async () => data,
    }),
  },
}));

import { GET as health } from "@/app/api/health/route";
import { GET as live } from "@/app/api/health/live/route";

const ORIGINAL = {
  DATABASE_URL: process.env.DATABASE_URL,
  JWT_SECRET: process.env.JWT_SECRET,
  NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
  RELEASE_SHA: process.env.RELEASE_SHA,
};

async function call(handler: () => Promise<unknown>) {
  const res = (await handler()) as {
    status: number;
    headers?: HeadersInit;
    json: () => Promise<any>;
  };
  return { status: res.status, headers: res.headers, body: await res.json() };
}

beforeEach(() => {
  mockPrisma = { $queryRaw: jest.fn().mockResolvedValue([{ "?column?": 1 }]) };
  process.env.DATABASE_URL = "postgresql://user@localhost:5432/familyplanner";
  process.env.JWT_SECRET = "a".repeat(32);
  process.env.NEXT_PUBLIC_APP_URL = "https://family.ashbi.ca";
  delete process.env.RELEASE_SHA;
});

afterAll(() => {
  for (const [k, v] of Object.entries(ORIGINAL)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

describe("GET /api/health (readiness)", () => {
  it("returns only a healthy status when the database and required config are ready", async () => {
    const { status, body } = await call(health);
    expect(status).toBe(200);
    expect(body).toEqual({ status: "healthy" });
  });

  it("identifies the exact release image when its commit is configured", async () => {
    const sha = "a".repeat(40);
    process.env.RELEASE_SHA = sha;
    const { status, headers } = await call(health);
    expect(status).toBe(200);
    expect(headers).toMatchObject({ "X-Release-Commit": sha });
  });

  it("returns only a degraded status when the database query fails", async () => {
    mockPrisma!.$queryRaw.mockRejectedValue(new Error("ECONNREFUSED"));
    const { status, body } = await call(health);
    expect(status).toBe(503);
    expect(body).toEqual({ status: "degraded" });
  });

  it("returns only a degraded status when the prisma client was never initialised", async () => {
    mockPrisma = undefined;
    const { status, body } = await call(health);
    expect(status).toBe(503);
    expect(body).toEqual({ status: "degraded" });
  });

  it("does not disclose when JWT_SECRET is missing", async () => {
    delete process.env.JWT_SECRET;
    const { status, body } = await call(health);
    expect(status).toBe(503);
    expect(body).toEqual({ status: "degraded" });
  });

  it("does not disclose when DATABASE_URL is missing", async () => {
    delete process.env.DATABASE_URL;
    const { status, body } = await call(health);
    expect(status).toBe(503);
    expect(body).toEqual({ status: "degraded" });
  });
});

describe("GET /api/health/live (liveness)", () => {
  it("returns 200 even when the database is unreachable", async () => {
    mockPrisma = undefined;
    delete process.env.DATABASE_URL;
    delete process.env.JWT_SECRET;
    const { status, body } = await call(live);
    expect(status).toBe(200);
    expect(body.status).toBe("alive");
  });
});
