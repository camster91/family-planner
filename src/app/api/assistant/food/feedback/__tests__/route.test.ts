/** Authored/unrun. API authority/transport boundary, no provider/database. */
jest.mock(
  "next/server",
  () => require("@/__tests__/helpers/two-household").nextServerMock,
);
jest.mock("@/lib/api-auth", () => ({ authenticateWithFamily: jest.fn() }));
jest.mock("@/lib/device-route", () => ({ refusePairedDevice: jest.fn() }));
jest.mock("@/lib/prisma", () => ({ prisma: {} }));
jest.mock("@/lib/rate-limit-db", () => ({ checkRateLimit: jest.fn() }));
jest.mock("@/lib/food-planning/owner", () => ({ foodRequestOwner: jest.fn() }));
jest.mock("@/lib/food-planning/ai-feedback", () => ({
  recordFoodAiFeedback: jest.fn(),
}));
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { authenticateWithFamily } from "@/lib/api-auth";
import { refusePairedDevice } from "@/lib/device-route";
import { checkRateLimit } from "@/lib/rate-limit-db";
import { foodRequestOwner } from "@/lib/food-planning/owner";
import { recordFoodAiFeedback } from "@/lib/food-planning/ai-feedback";
import { FOOD_OWNER_HEADER } from "@/lib/food-planning/recovery-contract";
import { POST } from "../route";
const request = (scope = "synthetic-scope", body = "{}") =>
  ({
    headers: new Headers({ [FOOD_OWNER_HEADER]: scope }),
    text: async () => body,
  }) as NextRequest;
beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(refusePairedDevice).mockResolvedValue(null);
  (authenticateWithFamily as jest.Mock).mockResolvedValue([
    {
      user: { id: "parent-a", family_id: "family-a", role: "parent" },
      payload: { tv: 0 },
    },
    null,
  ]);
  (foodRequestOwner as jest.Mock).mockReturnValue({ scope: "synthetic-scope" });
  (checkRateLimit as jest.Mock).mockResolvedValue({ allowed: true });
  (recordFoodAiFeedback as jest.Mock).mockResolvedValue({
    protocol: "herewoven.food-ai-feedback.v1",
    state: "skipped",
  });
});
it("refuses paired contexts and mismatched owner headers before recording", async () => {
  jest
    .mocked(refusePairedDevice)
    .mockResolvedValueOnce(NextResponse.json({}, { status: 403 }));
  expect((await POST(request())).status).toBe(403);
  expect((await POST(request("other-owner"))).status).toBe(403);
  expect(recordFoodAiFeedback).not.toHaveBeenCalled();
});
it("bounds request bodies and masks internal failures without reporting private content", async () => {
  expect(
    (await POST(request("synthetic-scope", "a".repeat(1025)))).status,
  ).toBe(413);
  expect(recordFoodAiFeedback).not.toHaveBeenCalled();
  jest
    .mocked(recordFoodAiFeedback)
    .mockRejectedValueOnce(new Error("Synthetic private source detail"));
  const result = await POST(request());
  expect(result.status).toBe(409);
  expect(JSON.stringify(await result.json())).not.toContain(
    "Synthetic private",
  );
  expect(result.headers.get("Cache-Control")).toBe("private, no-store");
});
it("returns only the fixed optional feedback result", async () => {
  const result = await POST(request());
  expect(await result.json()).toEqual({
    protocol: "herewoven.food-ai-feedback.v1",
    state: "skipped",
  });
  expect(recordFoodAiFeedback).toHaveBeenCalledWith(
    expect.anything(),
    { userId: "parent-a", familyId: "family-a", role: "parent", generation: 0 },
    {},
  );
});
