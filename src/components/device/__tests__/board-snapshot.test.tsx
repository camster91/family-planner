/** @jest-environment jsdom */
import * as React from "react";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { useDeviceBoardSnapshot } from "../use-device-board-snapshot";
import {
  DEVICE_ID_KEY,
  DeviceApiError,
  type DeviceClient,
  type DeviceClientEvent,
} from "@/lib/device-client";
import {
  DEVICE_BOARD_MAX_AGE_MS,
  writeDeviceBoardCache,
} from "@/lib/device-board-cache";
import type { TodayBoardData } from "@/app/dashboard/today/today-board-data";

const now = Date.parse("2026-10-08T11:00:00Z");
const board: TodayBoardData = {
  generatedAt: new Date(now).toISOString(),
  members: [{ id: "member-a", name: "Shared review member" }],
  events: [],
  chores: [],
  dinners: null,
  shopping: null,
  links: {
    calendar: null,
    chores: null,
    meals: null,
    lists: null,
    features: null,
  },
};
const offline = () =>
  new DeviceApiError(0, "NETWORK_ERROR", "offline", { retryable: true });

function setup(request: jest.Mock, identity: string | null = "device-a") {
  let purged = false;
  const listeners = new Set<(event: DeviceClientEvent) => void>();
  const client = {
    request,
    isPurged: () => purged,
    bootstrap: jest.fn(async () => null),
    purge: jest.fn(async () => {
      purged = true;
      listeners.forEach((fn) => fn("purge"));
    }),
    subscribe: (fn: (event: DeviceClientEvent) => void) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  } as unknown as DeviceClient;
  const loadIdentity = jest.fn(async () => identity);
  return {
    client,
    loadIdentity,
    purge: () => {
      purged = true;
      listeners.forEach((fn) => fn("purge"));
    },
  };
}
function seed(savedAt = Date.now()) {
  localStorage.setItem(DEVICE_ID_KEY, "device-a");
  expect(writeDeviceBoardCache(localStorage, "device-a", board, savedAt)).toBe(
    true,
  );
}
afterEach(() => {
  cleanup();
  localStorage.clear();
  jest.useRealTimers();
  jest.restoreAllMocks();
});

it("restores only a recent saved plan when the read endpoint is unreachable", async () => {
  seed();
  const t = setup(jest.fn().mockRejectedValue(offline()), null);
  const { result } = renderHook(() =>
    useDeviceBoardSnapshot({ ...t, hasAccessCookie: true }),
  );
  await waitFor(() => expect(result.current.cached).toBe(true));
  expect(result.current.data?.members[0].name).toBe("Shared review member");
  expect(t.client.bootstrap).toHaveBeenCalledWith(true);
  expect(result.current.error).toBeNull();
});

it("reconnect fetches and persists fresh canonical data before leaving cached mode", async () => {
  seed();
  const fresh = {
    ...board,
    members: [{ id: "member-a", name: "Updated shared member" }],
  };
  const request = jest
    .fn()
    .mockRejectedValueOnce(offline())
    .mockResolvedValue(fresh);
  const t = setup(request);
  const { result } = renderHook(() =>
    useDeviceBoardSnapshot({ ...t, hasAccessCookie: true }),
  );
  await waitFor(() => expect(result.current.cached).toBe(true));
  await act(async () => {
    window.dispatchEvent(new Event("online"));
    await result.current.load();
  });
  expect(result.current.cached).toBe(false);
  expect(result.current.data?.members[0].name).toBe("Updated shared member");
  expect(request).toHaveBeenCalledTimes(2);
  expect(localStorage.getItem("fp-device:v1:device-a:today")).toContain(
    "Updated shared member",
  );
});

it("recovers a cached plan on a successful unchanged version check without online events", async () => {
  seed();
  let recovered = false;
  const request = jest.fn(async (path: string) => {
    if (path.endsWith("/version")) return { version: "same-version" };
    if (!recovered) throw offline();
    return { ...board, version: "same-version" };
  });
  const t = setup(request);
  const { result } = renderHook(() =>
    useDeviceBoardSnapshot({ ...t, hasAccessCookie: true }),
  );
  await waitFor(() => expect(result.current.cached).toBe(true));
  recovered = true;
  await act(async () => {
    expect(await result.current.checkVersion()).toBe("same-version");
  });
  expect(result.current.cached).toBe(false);
  expect(request.mock.calls.map(([path]) => path)).toEqual([
    "/api/device/today",
    "/api/device/today/version",
    "/api/device/today",
  ]);
});

it("never falls back to cached content after a permission denial", async () => {
  seed();
  const t = setup(
    jest.fn().mockRejectedValue(new DeviceApiError(403, "FORBIDDEN", "denied")),
  );
  const { result } = renderHook(() =>
    useDeviceBoardSnapshot({ ...t, hasAccessCookie: true }),
  );
  await waitFor(() => expect(result.current.error).not.toBeNull());
  expect(result.current.data).toBeNull();
  expect(localStorage.getItem("fp-device:v1:device-a:today")).toBeNull();
});

it("expires a restored plan without renewing its age on read", async () => {
  jest.useFakeTimers();
  jest.setSystemTime(now);
  seed(now - DEVICE_BOARD_MAX_AGE_MS + 1000);
  const t = setup(jest.fn().mockRejectedValue(offline()), null);
  const { result } = renderHook(() =>
    useDeviceBoardSnapshot({ ...t, hasAccessCookie: true }),
  );
  await act(async () => {
    await result.current.load();
  });
  expect(result.current.cached).toBe(true);
  act(() => jest.advanceTimersByTime(1000));
  expect(result.current.data).toBeNull();
  expect(result.current.error).toBe("Reconnect to see today's plan.");
  expect(localStorage.getItem("fp-device:v1:device-a:today")).toBeNull();
});

it("also expires an in-memory live board if refresh stops for 24 hours", async () => {
  jest.useFakeTimers();
  jest.setSystemTime(now);
  localStorage.setItem(DEVICE_ID_KEY, "device-a");
  const t = setup(jest.fn().mockResolvedValue(board));
  const { result } = renderHook(() =>
    useDeviceBoardSnapshot({ ...t, hasAccessCookie: true }),
  );
  await act(async () => {
    await result.current.load();
  });
  expect(result.current.data).not.toBeNull();
  act(() => jest.advanceTimersByTime(DEVICE_BOARD_MAX_AGE_MS));
  expect(result.current.data).toBeNull();
  expect(result.current.error).toBe("Reconnect to see today's plan.");
});

it("checks expiry on return after a suspended tab and a clock change", async () => {
  jest.useFakeTimers();
  jest.setSystemTime(now);
  seed();
  const t = setup(jest.fn().mockRejectedValue(offline()), null);
  const { result } = renderHook(() =>
    useDeviceBoardSnapshot({ ...t, hasAccessCookie: true }),
  );
  await act(async () => {
    await result.current.load();
  });
  jest.setSystemTime(now + DEVICE_BOARD_MAX_AGE_MS);
  act(() => window.dispatchEvent(new Event("pageshow")));
  expect(result.current.data).toBeNull();
});

it("clears immediately on purge and cannot persist a late board response", async () => {
  let finish!: (data: TodayBoardData) => void;
  const request = jest.fn(
    () =>
      new Promise<TodayBoardData>((resolve) => {
        finish = resolve;
      }),
  );
  const t = setup(request);
  const { result } = renderHook(() =>
    useDeviceBoardSnapshot({ ...t, hasAccessCookie: true }),
  );
  await waitFor(() => expect(request).toHaveBeenCalled());
  act(() => t.purge());
  await act(async () => {
    finish(board);
    await result.current.load();
  });
  expect(result.current.data).toBeNull();
  expect(localStorage.getItem("fp-device:v1:device-a:today")).toBeNull();
});

it("loads successfully through StrictMode effect replay", async () => {
  const t = setup(jest.fn().mockResolvedValue(board));
  const { result } = renderHook(
    () => useDeviceBoardSnapshot({ ...t, hasAccessCookie: true }),
    {
      wrapper: ({ children }) => (
        <React.StrictMode>{children}</React.StrictMode>
      ),
    },
  );
  await waitFor(() => expect(result.current.data).not.toBeNull());
  expect(result.current.cached).toBe(false);
});

it("cannot write a board under an identity that changed while the read was in flight", async () => {
  let finish!: (data: TodayBoardData) => void;
  localStorage.setItem(DEVICE_ID_KEY, "device-a");
  const request = jest.fn(
    () =>
      new Promise<TodayBoardData>((resolve) => {
        finish = resolve;
      }),
  );
  const t = setup(request);
  const { result } = renderHook(() =>
    useDeviceBoardSnapshot({ ...t, hasAccessCookie: true }),
  );
  await waitFor(() => expect(request).toHaveBeenCalled());
  localStorage.setItem(DEVICE_ID_KEY, "device-b");
  await act(async () => {
    finish(board);
    await result.current.load();
  });
  expect(t.client.purge).toHaveBeenCalled();
  expect(result.current.data).toBeNull();
  expect(localStorage.getItem("fp-device:v1:device-a:today")).toBeNull();
});

it("keeps live data usable and reports a failed cache write", async () => {
  localStorage.setItem(DEVICE_ID_KEY, "device-a");
  jest.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
    throw new DOMException("Quota exceeded", "QuotaExceededError");
  });
  const t = setup(jest.fn().mockResolvedValue(board));
  const { result } = renderHook(() =>
    useDeviceBoardSnapshot({ ...t, hasAccessCookie: true }),
  );
  await waitFor(() => expect(result.current.data).toEqual(board));
  expect(result.current.cached).toBe(false);
  expect(result.current.cacheUnavailable).toBe(true);
});

it("drops the view when another tab changes or removes the paired identity", async () => {
  localStorage.setItem(DEVICE_ID_KEY, "device-a");
  const t = setup(jest.fn().mockResolvedValue(board));
  const { result } = renderHook(() =>
    useDeviceBoardSnapshot({ ...t, hasAccessCookie: true }),
  );
  await waitFor(() => expect(result.current.data).not.toBeNull());
  act(() =>
    window.dispatchEvent(
      new StorageEvent("storage", {
        key: DEVICE_ID_KEY,
        oldValue: "device-a",
        newValue: null,
      }),
    ),
  );
  expect(t.client.purge).toHaveBeenCalled();
  expect(result.current.data).toBeNull();
});
