import { draftFoodFromImage } from "../capture";
import type { ProviderUsageObserver } from "../ai-usage-contract";
const originalFetch = global.fetch;
const config = { apiKey: "fixture-key", baseUrl: "https://fixture.invalid", model: "fixture-vision", userSuppliedUrl: false };
const image = { bytes: new Uint8Array([255,216,255,0]), mime: "image/jpeg" as const };
const env = process.env;
beforeEach(() => { process.env = { ...env, FAMILY_AI_USAGE_READY: "1", FAMILY_AI_USAGE_ROLLBACK_READY: "1" }; delete process.env.FAMILY_AI_PROVIDER_DISABLED; });
afterEach(() => { global.fetch = originalFetch; process.env = env; });
function observer(): ProviderUsageObserver { return { start: jest.fn(async () => undefined), reported: jest.fn(), failed: jest.fn() }; }
it("accounts for the photo through the shared observer and leaves unknown quantities unknown", async () => {
  const meter = observer();
  global.fetch = jest.fn(async () => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ items: [{ name: "Beans", amount: null, unit: null, location: null, confidence: 0.4 }] }) } }], usage: { prompt_tokens: 500, completion_tokens: 50 } }), { status: 200 })) as typeof fetch;
  const result = await draftFoodFromImage(image, config, "fridge", meter);
  expect(result.items[0]).toMatchObject({ name: "Beans", amount: null, location: null, confidence: 0.4 });
  expect(meter.start).toHaveBeenCalledWith(expect.objectContaining({ maxOutputTokens: 4096 }));
  expect(meter.reported).toHaveBeenCalledWith({ inputTokens: 500, outputTokens: 50 });
});
it("refuses provider work when usage admission fails", async () => {
  const meter = observer();
  (meter.start as jest.Mock).mockRejectedValue(new Error("fixture quota reached"));
  global.fetch = jest.fn();
  await expect(draftFoodFromImage(image, config, "fridge", meter)).rejects.toThrow("fixture quota reached");
  expect(global.fetch).not.toHaveBeenCalled();
});
it("refuses an unmetered adopted request before sending a photo", async () => {
  global.fetch = jest.fn();
  await expect(draftFoodFromImage(image, config)).rejects.toThrow(/usage/);
  expect(global.fetch).not.toHaveBeenCalled();
});
it("rejects oversized photos before any provider call", async () => {
  global.fetch = jest.fn();
  await expect(draftFoodFromImage({ ...image, bytes: new Uint8Array(5_250_001) }, config, "fridge", observer())).rejects.toThrow(/large/);
  expect(global.fetch).not.toHaveBeenCalled();
});
