/** @jest-environment jsdom */
import { act, renderHook } from "@testing-library/react";
import { useListVersionSync } from "../use-list-version-sync";
import { BOARD_POLL_MS } from "@/lib/board-sync";
const A = "a".repeat(64),
  B = "b".repeat(64);
const response = (status: number, version = A) =>
  ({ status, ok: status === 200, json: async () => ({ version }) }) as Response;
const props = (refresh = jest.fn()) => ({
  listId: "list-a",
  version: A,
  generatedAt: "2026-01-01T00:00:00.000Z",
  refresh,
});
async function tick(ms = BOARD_POLL_MS) {
  await act(async () => {
    jest.advanceTimersByTime(ms);
    await Promise.resolve();
  });
}
beforeEach(() => {
  jest.useFakeTimers();
  Object.defineProperty(navigator, "onLine", {
    configurable: true,
    value: true,
  });
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    value: "visible",
  });
  global.fetch = jest.fn().mockResolvedValue(response(200));
});
afterEach(() => jest.useRealTimers());
it("checks the metadata route every 25 seconds, refreshes only on change and suppresses duplicate refresh", async () => {
  const p = props();
  const hook = renderHook(() => useListVersionSync(p));
  await tick();
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(p.refresh).not.toHaveBeenCalled();
  jest.mocked(fetch).mockResolvedValue(response(200, B));
  await tick();
  expect(p.refresh).toHaveBeenCalledTimes(1);
  await tick();
  expect(p.refresh).toHaveBeenCalledTimes(1);
  expect(jest.mocked(fetch).mock.calls[0]).toEqual([
    "/api/lists/list-a/version",
    { cache: "no-store" },
  ]);
  hook.unmount();
});
it("pauses while offline or hidden and wakes on reconnect/visibility", async () => {
  const p = props();
  renderHook(() => useListVersionSync(p));
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    value: "hidden",
  });
  await tick();
  expect(fetch).not.toHaveBeenCalled();
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    value: "visible",
  });
  await act(async () => {
    document.dispatchEvent(new Event("visibilitychange"));
  });
  expect(fetch).toHaveBeenCalledTimes(1);
  Object.defineProperty(navigator, "onLine", {
    configurable: true,
    value: false,
  });
  await tick();
  expect(fetch).toHaveBeenCalledTimes(1);
  Object.defineProperty(navigator, "onLine", {
    configurable: true,
    value: true,
  });
  await act(async () => {
    window.dispatchEvent(new Event("online"));
  });
  expect(fetch).toHaveBeenCalledTimes(2);
});
it.each([401, 403, 404])(
  "stops on terminal %s and refreshes canonical page once",
  async (status) => {
    jest.mocked(fetch).mockResolvedValue(response(status));
    const p = props();
    const hook = renderHook(() => useListVersionSync(p));
    await tick();
    expect(p.refresh).toHaveBeenCalledTimes(1);
    expect(hook.result.current.terminal).toBe(true);
    await tick(3 * BOARD_POLL_MS);
    expect(fetch).toHaveBeenCalledTimes(1);
  },
);
it.each([429, 500])(
  "retains the snapshot and bounded retry after %s",
  async (status) => {
    jest.mocked(fetch).mockResolvedValue(response(status));
    const p = props();
    const hook = renderHook(() => useListVersionSync(p));
    await tick();
    expect(hook.result.current.failing).toBe(true);
    expect(p.refresh).not.toHaveBeenCalled();
    jest.mocked(fetch).mockResolvedValue(response(200, B));
    await tick();
    expect(p.refresh).toHaveBeenCalledTimes(1);
  },
);
it("ignores a delayed result after unmount", async () => {
  let finish!: (r: Response) => void;
  jest.mocked(fetch).mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const p = props();
  const hook = renderHook(() => useListVersionSync(p));
  await tick();
  hook.unmount();
  await act(async () => {
    finish(response(200, B));
  });
  expect(p.refresh).not.toHaveBeenCalled();
});
it("does not poll a legacy render without an authoritative version", async () => {
  renderHook(() => useListVersionSync({ ...props(), version: undefined }));
  await tick(5 * BOARD_POLL_MS);
  expect(fetch).not.toHaveBeenCalled();
});
