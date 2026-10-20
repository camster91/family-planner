import { NextRequest, NextResponse } from "next/server";
import { GET } from "../route";
import { inventoryRecoveryContext } from "@/lib/inventory-recovery-contract";
const mockAuth = jest.fn();
const mockAuthority = jest.fn();
const mockRate = jest.fn();
jest.mock("@/lib/api-auth", () => ({
  authenticateWithFamily: (...args: unknown[]) => mockAuth(...args),
}));
jest.mock("@/lib/inventory-intake", () => ({
  inventoryIntakeAuthority: (...args: unknown[]) => mockAuthority(...args),
}));
jest.mock("@/lib/rate-limit-db", () => ({
  checkRateLimit: (...args: unknown[]) => mockRate(...args),
}));
jest.mock("@/lib/prisma", () => ({
  prisma: { $transaction: (run: (tx: object) => unknown) => run({}) },
}));
const actor = {
  id: "fixture-parent",
  family_id: "fixture-family",
  role: "parent",
};
const payload = {
  userId: actor.id,
  family_id: "stale-family",
  role: "child",
  sid: "fixture-session",
  tv: 2,
};
const flags = [
  "INVENTORY_RECOVERY_ENABLED",
  "INVENTORY_RECOVERY_ROLLBACK_READY",
  "QUEUE_OWNER_RECOVERY_ENABLED",
  "QUEUE_OWNER_RECOVERY_ROLLBACK_READY",
];
const savedFlags = flags.map((key) => process.env[key]);
const req = () =>
  new NextRequest("https://example.test/api/inventory/recovery", {
    headers: { cookie: "session_token=fixture-cookie" },
  });
beforeEach(() => {
  flags.forEach((key) => delete process.env[key]);
  mockAuth.mockResolvedValue([{ user: actor, payload }, null]);
  mockAuthority.mockResolvedValue(null);
  mockRate.mockResolvedValue({ allowed: true });
});
afterEach(() => {
  flags.forEach((key, index) => {
    if (savedFlags[index] === undefined) delete process.env[key];
    else process.env[key] = savedFlags[index];
  });
  jest.clearAllMocks();
});
it("returns only private current context with support disabled until every gate is ready", async () => {
  const response = await GET(req());
  expect(response.headers.get("Cache-Control")).toBe("private, no-store");
  const body = inventoryRecoveryContext.parse(await response.json());
  expect(body).toMatchObject({
    userId: actor.id,
    familyId: actor.family_id,
    enabled: false,
    owner: { ownerId: actor.id, generation: 2, kind: "person" },
  });
  expect(mockAuthority).toHaveBeenCalledWith(
    {},
    { userId: actor.id, familyId: actor.family_id, tokenVersion: 2 },
  );
  expect(JSON.stringify(body)).not.toContain("fixture-cookie");
  expect(JSON.stringify(body)).not.toContain("stale-family");
  flags.forEach((key) => {
    process.env[key] = "1";
  });
  expect(
    inventoryRecoveryContext.parse(await (await GET(req())).json()).enabled,
  ).toBe(true);
});
it.each([401, 403])(
  "does not negotiate through authentication/paired context refusal %i",
  async (status) => {
    mockAuth.mockResolvedValue([
      null,
      NextResponse.json({ error: "Refused" }, { status }),
    ]);
    const response = await GET(req());
    expect(response.status).toBe(status);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(mockAuthority).not.toHaveBeenCalled();
    expect(mockRate).not.toHaveBeenCalled();
  },
);
it.each(["INTAKE_FORBIDDEN", "INVENTORY_DISABLED", "UNAUTHORIZED"])(
  "preserves canonical authority refusal %s",
  async (code) => {
    mockAuthority.mockResolvedValue({
      status: code === "UNAUTHORIZED" ? 401 : 403,
      body: { error: { code } },
    });
    const response = await GET(req());
    expect(response.status).toBe(code === "UNAUTHORIZED" ? 401 : 403);
    expect(await response.json()).toEqual({ error: { code } });
  },
);
it("rate-limits negotiation before taking canonical household locks", async () => {
  mockRate.mockResolvedValue({ allowed: false });
  const response = await GET(req());
  expect(response.status).toBe(429);
  expect(mockAuthority).not.toHaveBeenCalled();
});
