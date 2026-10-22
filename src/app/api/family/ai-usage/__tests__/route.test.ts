/** Authored/unrun two-household admission and settings freshness cases. */
jest.mock(
  "next/server",
  () => require("@/__tests__/helpers/two-household").nextServerMock,
);
jest.mock(
  "next/headers",
  () => require("@/__tests__/helpers/two-household").nextHeadersMock,
);
jest.mock(
  "@/lib/session",
  () => require("@/__tests__/helpers/two-household").sessionMock,
);
jest.mock("@/lib/prisma", () => ({
  prisma: require("@/__tests__/helpers/two-household").fakePrisma,
}));
jest.mock("@/lib/capture", () => ({
  resolveCaptureConfig: jest.fn(() => ({
    apiKey: "PRIVATE_FIXTURE_KEY",
    baseUrl: "https://example.invalid",
    model: "fixture",
  })),
}));
jest.mock("@/lib/ai-usage-server", () => ({
  isAiUsageAdopted: jest.fn(() => true),
  isAiUsageReady: jest.fn(() => true),
  aiUsageStorageAvailable: jest.fn(async () => true),
  readAiUsagePolicy: jest.fn(async () => ({
    revision: 1,
    pricedConfigHash: null,
    policy: require("@/lib/ai-usage-contract").defaultAiUsagePolicy,
  })),
  readAiUsageDays: jest.fn(async () => []),
  saveAiUsagePolicy: jest.fn(async () => 2),
  aiConfigHash: jest.fn(() => "a".repeat(64)),
  AiUsageError: class extends Error {},
}));
import { GET, POST } from "../route";
import { db, req, FAMILY_A, FAMILY_B } from "@/__tests__/helpers/two-household";
import { defaultAiUsagePolicy } from "@/lib/ai-usage-contract";
import {
  aiUsageStorageAvailable,
  readAiUsageDays,
  saveAiUsagePolicy,
} from "@/lib/ai-usage-server";
const command = {
  owner: { userId: "parent-a", familyId: FAMILY_A, generation: 0 },
  expectedRevision: 1,
  configVersion: "a".repeat(64),
  policy: defaultAiUsagePolicy,
};
beforeEach(() => {
  db.reset();
  jest.clearAllMocks();
  jest.mocked(aiUsageStorageAvailable).mockResolvedValue(true);
});
it("refuses anonymous, child and teen reads before any usage projection", async () => {
  expect((await GET(req())).status).toBe(401);
  for (const as of ["childA", "teenA"] as const)
    expect((await GET(req({ as }))).status).toBe(403);
  expect(readAiUsageDays).not.toHaveBeenCalled();
});
it("reads only the current household and exposes neither provider credentials nor per-person requests", async () => {
  const response = await GET(req({ as: "parentA" }));
  expect(response.status).toBe(200);
  const body = await response.json();
  expect(body.owner.familyId).toBe(FAMILY_A);
  expect(readAiUsageDays).toHaveBeenCalledWith(
    expect.anything(),
    FAMILY_A,
    expect.any(Date),
  );
  expect(JSON.stringify(body)).not.toMatch(
    /PRIVATE_FIXTURE_KEY|https:|priced_config_hash|user_id|family-b/,
  );
  expect(response.headers.get("Cache-Control")).toBe("private, no-store");
});
it("rejects a prior household owner or changed provider before saving", async () => {
  const foreign = await POST(
    req({
      as: "parentA",
      method: "POST",
      body: { ...command, owner: { ...command.owner, familyId: FAMILY_B } },
    }),
  );
  expect(foreign.status).toBe(409);
  const changed = await POST(
    req({
      as: "parentA",
      method: "POST",
      body: { ...command, configVersion: "b".repeat(64) },
    }),
  );
  expect(changed.status).toBe(409);
  expect(saveAiUsagePolicy).not.toHaveBeenCalled();
});
it("reports unavailable storage as unavailable, never a zero-usage success", async () => {
  jest.mocked(aiUsageStorageAvailable).mockResolvedValue(false);
  const response = await GET(req({ as: "parentA" }));
  expect(response.status).toBe(503);
  expect((await response.json()).days).toBeUndefined();
  expect(readAiUsageDays).not.toHaveBeenCalled();
});
