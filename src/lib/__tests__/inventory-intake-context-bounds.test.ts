// Source authored UNRUN. No live request or intake mutation.
import { readInventoryIntakeContext } from "../inventory-intake-client";
const originalFetch = global.fetch;
beforeEach(() => jest.useFakeTimers());
afterEach(() => { global.fetch = originalFetch; jest.useRealTimers(); });
it("rejects stalled context bodies within the shared foreground deadline", async () => {
  global.fetch = jest.fn(async () => ({ ok: true, json: () => new Promise(() => undefined) })) as unknown as typeof fetch;
  const outcome = readInventoryIntakeContext(new AbortController().signal).then(() => "accepted", () => "unavailable");
  await Promise.resolve();
  jest.advanceTimersByTime(15000);
  expect(await outcome).toBe("unavailable");
});
it("rejects oversized context replies without accepting an owner", async () => {
  const json = jest.fn();
  global.fetch = jest.fn(async () => ({ ok: true, headers: { get: () => "20000" }, json })) as unknown as typeof fetch;
  await expect(readInventoryIntakeContext(new AbortController().signal)).rejects.toThrow("Intake context unavailable");
  expect(json).not.toHaveBeenCalled();
});
