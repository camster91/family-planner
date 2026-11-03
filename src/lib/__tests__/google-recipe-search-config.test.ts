// Gemini is OFF for this release (#144). These cases cover the retained,
// not-yet-approved path, so they opt in explicitly; the off cases opt out.
let mockGeminiApproved = true;
jest.mock("@/lib/gemini-policy", () => {
  const actual = jest.requireActual("@/lib/gemini-policy");
  return { ...actual, geminiProviderApproved: () => mockGeminiApproved };
});
import { approvedGoogleRecipePricing } from "../google-recipe-search-config";
jest.mock("../ai-usage-hash", () => ({ aiConfigHash: () => "a".repeat(64) }));
const config = {
  model: "fixture",
  baseUrl: "https://example.invalid",
  apiKey: "fixture",
  userSuppliedUrl: false,
};
const pricing = {
  model: "fixture",
  inputMicrousdPerMillion: "1",
  outputMicrousdPerMillion: "1",
  searchMicrousdPerUnit: "1",
  searchBilling: "query",
};
const now = Date.UTC(2026, 10, 2),
  ready = process.env.FAMILY_GOOGLE_RECIPE_SEARCH_READY,
  prior = process.env.FAMILY_GOOGLE_RECIPE_SEARCH_PRICING;
const approval = () => ({
  configVersion: "a".repeat(64),
  validUntil: new Date(now + 86400000).toISOString(),
  pricing,
});
beforeEach(() => {
  process.env.FAMILY_GOOGLE_RECIPE_SEARCH_READY = "1";
  process.env.FAMILY_GOOGLE_RECIPE_SEARCH_PRICING = JSON.stringify(approval());
});
afterAll(() => {
  if (ready === undefined) delete process.env.FAMILY_GOOGLE_RECIPE_SEARCH_READY;
  else process.env.FAMILY_GOOGLE_RECIPE_SEARCH_READY = ready;
  if (prior === undefined)
    delete process.env.FAMILY_GOOGLE_RECIPE_SEARCH_PRICING;
  else process.env.FAMILY_GOOGLE_RECIPE_SEARCH_PRICING = prior;
});
it("returns only approved model pricing", () => {
  expect(approvedGoogleRecipePricing(config, now)).toEqual(pricing);
});
it.each([
  { configVersion: "b".repeat(64) },
  { validUntil: new Date(now).toISOString() },
  { validUntil: new Date(now + 32 * 86400000).toISOString() },
  { pricing: { ...pricing, model: "other" } },
])("refuses stale, foreign or overlong approvals %j", (change) => {
  process.env.FAMILY_GOOGLE_RECIPE_SEARCH_PRICING = JSON.stringify({
    ...approval(),
    ...change,
  });
  expect(approvedGoogleRecipePricing(config, now)).toBeNull();
});
it("refuses disabled and malformed configuration", () => {
  process.env.FAMILY_GOOGLE_RECIPE_SEARCH_READY = "0";
  expect(approvedGoogleRecipePricing(config, now)).toBeNull();
  process.env.FAMILY_GOOGLE_RECIPE_SEARCH_READY = "1";
  process.env.FAMILY_GOOGLE_RECIPE_SEARCH_PRICING = "not json";
  expect(approvedGoogleRecipePricing(config, now)).toBeNull();
});

it("returns no pricing while Gemini is off, even with approved configuration", () => {
  mockGeminiApproved = false;
  try { expect(approvedGoogleRecipePricing(config as never, now)).toBeNull(); }
  finally { mockGeminiApproved = true; }
});
