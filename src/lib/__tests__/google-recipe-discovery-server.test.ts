jest.mock(
  "next/server",
  () => require("@/__tests__/helpers/two-household").nextServerMock,
);
jest.mock("../prisma", () => ({
  prisma: {
    family: {
      findUnique: jest.fn(async () => ({ capture_ai_model: "fixture" })),
    },
  },
}));
jest.mock("../storage-backend", () => ({ storageBackend: () => "postgres" }));
jest.mock("../cloudflare/database", () => ({ getD1Database: jest.fn() }));
jest.mock("../capture", () => ({
  resolveCaptureConfig: jest.fn(() => ({ model: "fixture" })),
}));
jest.mock("../google-recipe-search-config", () => ({
  approvedGoogleRecipePricing: jest.fn(() => ({ model: "fixture" })),
}));
jest.mock("../google-recipe-search", () => ({
  searchGoogleRecipes: jest.fn(async () => ({ blocks: [], suggestions: [] })),
}));
jest.mock("../ai-usage-server", () => ({
  createAiUsageJob: jest.fn(),
  AiUsageError: require("../ai-usage-errors").AiUsageError,
}));
jest.mock("../recipe-read-authority", () => ({
  renewRecipeReadAuthority: jest.fn(async () => null),
  recipeReadOwnerHeaders: () => ({ "Cache-Control": "private, no-store" }),
}));
jest.mock("../device-route", () => ({
  refusePairedDevice: jest.fn(async () => null),
}));
import { discoverGoogleRecipes } from "../google-recipe-discovery-server";
import { createAiUsageJob } from "../ai-usage-server";
import { searchGoogleRecipes } from "../google-recipe-search";
import { renewRecipeReadAuthority } from "../recipe-read-authority";
import { approvedGoogleRecipePricing } from "../google-recipe-search-config";
import { prisma } from "../prisma";
import { NextRequest, NextResponse } from "next/server";
const original = {
  actorId: "u1",
  familyId: "f1",
  role: "parent",
  generation: 1,
};
const request = new Request(
  "http://localhost/api/recipes/discover",
) as NextRequest;
const meter = {
  observer: {},
  replyAllowed: jest.fn(async () => true),
  finish: jest.fn(async () => {}),
};
beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(createAiUsageJob).mockReturnValue(meter as never);
  jest.mocked(renewRecipeReadAuthority).mockResolvedValue(null);
  jest
    .mocked(approvedGoogleRecipePricing)
    .mockReturnValue({ model: "fixture" } as never);
  meter.replyAllowed.mockResolvedValue(true);
  jest
    .mocked(searchGoogleRecipes)
    .mockResolvedValue({ blocks: [], suggestions: [] });
});
it("scopes configuration reads and renews authority around provider work", async () => {
  const result = await discoverGoogleRecipes(request, original, "soup");
  expect(result.status).toBe(200);
  expect(prisma!.family.findUnique).toHaveBeenCalledWith(
    expect.objectContaining({ where: { id: "f1" } }),
  );
  expect(createAiUsageJob).toHaveBeenCalledWith(
    expect.anything(),
    { userId: "u1", familyId: "f1", role: "parent", generation: 1 },
    expect.anything(),
    "assistant",
  );
  expect(renewRecipeReadAuthority).toHaveBeenCalledTimes(3);
  expect(meter.finish).toHaveBeenCalledWith(200);
});
it("does not call the provider without current price approval", async () => {
  jest.mocked(approvedGoogleRecipePricing).mockReturnValue(null);
  expect((await discoverGoogleRecipes(request, original, "soup")).status).toBe(
    503,
  );
  expect(searchGoogleRecipes).not.toHaveBeenCalled();
});
it("refuses child before private configuration read", async () => {
  expect(
    (
      await discoverGoogleRecipes(
        request,
        { ...original, role: "child" },
        "soup",
      )
    ).status,
  ).toBe(403);
  expect(prisma!.family.findUnique).not.toHaveBeenCalled();
});
it("withholds results after household authority changes and accounts for the attempt", async () => {
  jest
    .mocked(renewRecipeReadAuthority)
    .mockResolvedValueOnce(null)
    .mockResolvedValueOnce(
      NextResponse.json({ error: "changed" }, { status: 409 }),
    );
  const result = await discoverGoogleRecipes(request, original, "soup");
  expect(result.status).toBe(409);
  expect(meter.finish).toHaveBeenCalledWith(409);
  expect(await result.json()).not.toHaveProperty("grounded");
});
it("withholds results after meter revocation and never retries", async () => {
  meter.replyAllowed.mockResolvedValue(false);
  expect((await discoverGoogleRecipes(request, original, "soup")).status).toBe(
    409,
  );
  expect(searchGoogleRecipes).toHaveBeenCalledTimes(1);
});
it("settles failed provider attempts without leaking upstream text", async () => {
  jest.mocked(searchGoogleRecipes).mockRejectedValue(new Error("PRIVATE"));
  const result = await discoverGoogleRecipes(request, original, "soup");
  expect(result.status).toBe(502);
  expect(JSON.stringify(await result.json())).not.toContain("PRIVATE");
  expect(meter.finish).toHaveBeenCalledWith(502);
});
