/** Authored only; no execution claimed. */
import { requestOwnedJson, runOwnedForeground } from "../owned-request-http";
afterEach(() => jest.useRealTimers());
it("settles external cancellation even when a fetch bridge ignores AbortSignal", async () => {
  const controller = new AbortController();
  global.fetch = jest.fn(() => new Promise<Response>(() => {}));
  const pending = requestOwnedJson("/fixture", { signal: controller.signal });
  await Promise.resolve();
  controller.abort();
  expect(await pending).toEqual({ kind: "unknown" });
  expect(
    (jest.mocked(fetch).mock.calls[0][1]?.signal as AbortSignal).aborted,
  ).toBe(true);
});
it("does not start a provider fetch after cancelled image decoding eventually finishes", async () => {
  const controller = new AbortController();
  let decoded!: () => void;
  const waiting = new Promise<void>((resolve) => {
    decoded = resolve;
  });
  const send = jest.fn();
  const pending = runOwnedForeground(
    async (signal) => {
      await waiting;
      if (signal.aborted) throw new Error("stopped");
      send();
      return { kind: "reply" as const };
    },
    { signal: controller.signal, timeoutMs: 45000 },
  );
  await Promise.resolve();
  controller.abort();
  expect(await pending).toEqual({ kind: "unknown" });
  decoded();
  await Promise.resolve();
  expect(send).not.toHaveBeenCalled();
});
it("bounds the whole foreground job and skips work already cancelled before starting", async () => {
  jest.useFakeTimers();
  let signal!: AbortSignal;
  const pending = runOwnedForeground(
    async (value) => {
      signal = value;
      return new Promise<never>(() => {});
    },
    { timeoutMs: 45000 },
  );
  await Promise.resolve();
  jest.advanceTimersByTime(45000);
  expect(await pending).toEqual({ kind: "unknown" });
  expect(signal.aborted).toBe(true);
  const stopped = new AbortController();
  stopped.abort();
  const work = jest.fn(async () => "never");
  expect(await runOwnedForeground(work, { signal: stopped.signal })).toEqual({
    kind: "unknown",
  });
  expect(work).not.toHaveBeenCalled();
});
