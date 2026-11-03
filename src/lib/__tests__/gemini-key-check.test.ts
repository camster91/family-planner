// Gemini is OFF for this release (#144). These cases cover the retained,
// not-yet-approved path, so they opt in explicitly; the off cases opt out.
let mockGeminiApproved = true;
jest.mock("@/lib/gemini-policy", () => {
  const actual = jest.requireActual("@/lib/gemini-policy");
  return { ...actual, geminiProviderApproved: () => mockGeminiApproved };
});
import { checkGeminiKey } from "../gemini-key-check";
const oldFetch = global.fetch;
afterEach(() => { global.fetch = oldFetch; });
it("checks only fixed-host model metadata with the key in a header", async () => {
  global.fetch = jest.fn(async () => Response.json({ name: "models/gemini-3.8-flash" }));
  expect(await checkGeminiKey("fabricated-key")).toBe("valid");
  expect(global.fetch).toHaveBeenCalledWith("https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash", expect.objectContaining({ headers: { "x-goog-api-key": "fabricated-key" }, redirect: "manual", cache: "no-store" }));
  expect((global.fetch as jest.Mock).mock.calls[0][1]).not.toHaveProperty("body");
});
it.each([400, 401, 403])("does not accept denied credentials (%i)", async (status) => {
  global.fetch = jest.fn(async () => new Response("private provider details", { status }));
  expect(await checkGeminiKey("fabricated-key")).toBe("invalid");
});
it.each([302, 429, 500])("does not follow redirects or claim connectivity on status %i", async (status) => {
  global.fetch = jest.fn(async () => new Response("private provider details", { status }));
  expect(await checkGeminiKey("fabricated-key")).toBe("unavailable");
  expect(global.fetch).toHaveBeenCalledTimes(1);
});
it("refuses unexpected model data and bounded oversized responses", async () => {
  global.fetch = jest.fn(async () => Response.json({ name: "models/other" }));
  expect(await checkGeminiKey("fabricated-key")).toBe("unavailable");
  global.fetch = jest.fn(async () => new Response("x".repeat(40000)));
  expect(await checkGeminiKey("fabricated-key")).toBe("unavailable");
});

it("sends nothing to Google while Gemini is off", async () => {
  mockGeminiApproved = false;
  global.fetch = jest.fn();
  try {
    expect(await checkGeminiKey("fabricated-key")).toBe("unavailable");
    expect(global.fetch).not.toHaveBeenCalled();
  } finally { mockGeminiApproved = true; }
});
