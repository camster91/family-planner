import { geminiBlocked, geminiProviderApproved, isGeminiProviderUrl } from "../gemini-policy";
import { resolveCaptureConfig } from "../capture";
import { encryptSecret } from "../secret-box";

// #144: Cameron's November 3, 2026 decision keeps Gemini off pending provider
// clarification. These cases protect that decision from config-only bypasses.
const env = { ...process.env };
beforeAll(() => { process.env.JWT_SECRET = "gemini-policy-test-secret"; });
afterEach(() => { process.env = { ...env, JWT_SECRET: "gemini-policy-test-secret" }; });

it("is a source-level decision that no environment flag turns on", () => {
  process.env.FAMILY_GOOGLE_RECIPE_SEARCH_READY = "1";
  process.env.FAMILY_GEMINI_APPROVED = "1";
  expect(geminiProviderApproved()).toBe(false);
});

it.each([
  ["https://generativelanguage.googleapis.com/v1beta/openai", true],
  ["https://generativelanguage.googleapis.com/v1beta", true],
  ["https://GENERATIVELANGUAGE.googleapis.com./v1beta", true],
  ["https://aiplatform.googleapis.com/v1", true],
  ["https://europe-west4-aiplatform.googleapis.com/v1", true],
  ["https://api.deepseek.com", false],
  ["https://provider.example/v1", false],
  ["not a url", false],
  ["", false],
])("recognizes Gemini hosts: %s", (url, expected) => {
  expect(isGeminiProviderUrl(url)).toBe(expected);
  expect(geminiBlocked(url)).toBe(expected);
});

describe("resolveCaptureConfig", () => {
  it("withholds a saved household Gemini key without deleting it", () => {
    const row = {
      capture_ai_key_enc: encryptSecret("fabricated-gemini-household-key"),
      capture_ai_base_url: "https://generativelanguage.googleapis.com/v1beta/openai",
      capture_ai_model: "gemini-3.8-flash",
    };
    expect(resolveCaptureConfig(row)).toBeNull();
    expect(row.capture_ai_key_enc).toBeTruthy();
  });

  it("withholds a deployment fallback that points at Gemini", () => {
    process.env.CAPTURE_AI_KEY = "fabricated-deployment-key";
    process.env.CAPTURE_AI_BASE_URL = "https://generativelanguage.googleapis.com/v1beta/openai";
    expect(resolveCaptureConfig(null)).toBeNull();
  });

  it("withholds a household key that would inherit a Gemini deployment URL", () => {
    process.env.CAPTURE_AI_BASE_URL = "https://generativelanguage.googleapis.com/v1beta/openai";
    expect(resolveCaptureConfig({ capture_ai_key_enc: encryptSecret("fabricated-household-key") })).toBeNull();
  });

  it("keeps an unrelated, already configured provider", () => {
    process.env.CAPTURE_AI_KEY = "fabricated-deployment-key";
    delete process.env.CAPTURE_AI_BASE_URL;
    expect(resolveCaptureConfig(null)).toEqual(expect.objectContaining({ baseUrl: "https://api.deepseek.com" }));
  });
});
