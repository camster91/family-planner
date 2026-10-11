"use client";

import * as React from "react";
import type { TodayBoardData } from "@/app/dashboard/today/today-board-data";
import {
  DEVICE_ID_KEY,
  DeviceApiError,
  type DeviceClient,
} from "@/lib/device-client";
import {
  DEVICE_BOARD_MAX_AGE_MS,
  clearDeviceBoardCache,
  readDeviceBoardCache,
  writeDeviceBoardCache,
  type BoardCacheStorage,
} from "@/lib/device-board-cache";
import { genericErrorText } from "./use-device-client";

function storage(): BoardCacheStorage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}
function knownDeviceId(store: BoardCacheStorage | null): string | null {
  try {
    return store?.getItem(DEVICE_ID_KEY) ?? null;
  } catch {
    return null;
  }
}

/** A protocol-1 reader must never display a profile-only snapshot. */
function isBoardCompatible(
  board: TodayBoardData,
  memberProtocol: 1 | 2,
): boolean {
  return memberProtocol === 2 || board.memberProtocol !== 2;
}

function isCachedBoardCompatible(
  board: TodayBoardData,
  memberProtocol: 1 | 2,
): boolean {
  // Protocol 2 is explicitly online-only until profile subjects have a
  // privacy-safe cache schema. A protocol-1 cache remains safe after rollback.
  return memberProtocol === 1 && board.memberProtocol !== 2;
}

function clearStoredBoardCache(): void {
  const store = storage();
  const id = knownDeviceId(store);
  if (id) clearDeviceBoardCache(store, id);
}

function isMemberProtocolUnavailable(error: unknown): error is DeviceApiError {
  return (
    error instanceof DeviceApiError &&
    error.code === "MEMBER_PROTOCOL_UNAVAILABLE"
  );
}

/** Cached data is a passive read, never an authorization grant. */
export function useDeviceBoardSnapshot({
  client,
  hasAccessCookie,
  memberProtocol = 1,
  loadIdentity,
}: {
  client: DeviceClient | null;
  hasAccessCookie: boolean;
  /** Explicit server opt-in; account-only protocol 1 remains the default. */
  memberProtocol?: 1 | 2;
  loadIdentity: () => Promise<string | null>;
}) {
  const [data, setData] = React.useState<TodayBoardData | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [cached, setCached] = React.useState(false);
  const [cacheUnavailable, setCacheUnavailable] = React.useState(false);
  const [protocolError, setProtocolError] = React.useState(false);
  const dataRef = React.useRef<TodayBoardData | null>(null);
  const cachedRef = React.useRef(false);
  const confirmedAt = React.useRef<number | null>(null);
  const epoch = React.useRef(0);
  const flight = React.useRef<Promise<void> | null>(null);
  const flightEpoch = React.useRef(-1);
  const invalidate = React.useCallback(() => {
    epoch.current++;
  }, []);
  const clearForProtocolError = React.useCallback(() => {
    invalidate();
    clearStoredBoardCache();
    dataRef.current = null;
    confirmedAt.current = null;
    cachedRef.current = false;
    setData(null);
    setCached(false);
    setCacheUnavailable(false);
    setProtocolError(true);
    setError("This family plan needs a compatible tablet session.");
  }, [invalidate]);

  const load = React.useCallback((): Promise<void> => {
    if (flight.current && flightEpoch.current === epoch.current)
      return flight.current;
    if (!client || client.isPurged()) return Promise.resolve();
    if (memberProtocol === 1 && dataRef.current?.memberProtocol === 2) {
      clearStoredBoardCache();
      dataRef.current = null;
      cachedRef.current = false;
      setData(null);
      setCached(false);
    }
    const requestedEpoch = epoch.current;
    flightEpoch.current = requestedEpoch;
    const current = () =>
      requestedEpoch === epoch.current && !client.isPurged();
    flight.current = (async () => {
      const deviceId = await loadIdentity();
      if (!current()) return;
      try {
        const board = await client.request<TodayBoardData>(
          "/api/device/today",
          {
            headers:
              memberProtocol === 2 ? { "X-Member-Protocol": "2" } : undefined,
          },
        );
        if (!current()) return;
        if (!isBoardCompatible(board, memberProtocol)) {
          clearForProtocolError();
          setError("Refresh this tablet before viewing the family plan.");
          return;
        }
        const now = Date.now();
        const store = storage();
        const storedId = knownDeviceId(store);
        if (deviceId && storedId && storedId !== deviceId) {
          await client.purge();
          return;
        }
        const profileBoard = memberProtocol === 2;
        if (profileBoard && deviceId) clearDeviceBoardCache(store, deviceId);
        const saved = Boolean(
          !profileBoard &&
          deviceId &&
          storedId === deviceId &&
          writeDeviceBoardCache(store, deviceId, board, now),
        );
        setCacheUnavailable(!profileBoard && !saved);
        confirmedAt.current = now;
        dataRef.current = board;
        cachedRef.current = false;
        setData(board);
        setCached(false);
        setProtocolError(false);
        setError(null);
      } catch (err) {
        if (!current() || (err instanceof DeviceApiError && err.terminal))
          return;
        if (isMemberProtocolUnavailable(err)) {
          clearForProtocolError();
          return;
        }
        const retryable =
          err instanceof DeviceApiError &&
          (err.status === 0 ||
            err.retryable ||
            err.status >= 500 ||
            [408, 425, 429].includes(err.status));
        if (!retryable) {
          clearStoredBoardCache();
          dataRef.current = null;
          confirmedAt.current = null;
          cachedRef.current = false;
          setData(null);
          setCached(false);
          setProtocolError(false);
        } else if (!dataRef.current) {
          if (memberProtocol === 2) {
            clearStoredBoardCache();
            setCacheUnavailable(false);
            setError(genericErrorText(err));
            return;
          }
          const store = storage();
          const id = knownDeviceId(store);
          const snapshot = id
            ? readDeviceBoardCache(store, id, Date.now())
            : { state: "missing" as const };
          if (
            snapshot.state === "ready" &&
            isCachedBoardCompatible(snapshot.board, memberProtocol)
          ) {
            dataRef.current = snapshot.board;
            confirmedAt.current = snapshot.savedAt;
            cachedRef.current = true;
            setData(snapshot.board);
            setCached(true);
            setCacheUnavailable(false);
            setError(null);
            return;
          }
          if (snapshot.state === "ready") {
            clearStoredBoardCache();
            const incompatibleProfileCache =
              memberProtocol === 1 && snapshot.board.memberProtocol === 2;
            setProtocolError(incompatibleProfileCache);
            setError(
              incompatibleProfileCache
                ? "Refresh this tablet before viewing the family plan."
                : "Reconnect to see today's plan.",
            );
            return;
          }
          if (snapshot.state === "expired") {
            setError("Reconnect to see today's plan.");
            return;
          }
        }
        setError(genericErrorText(err));
      }
    })().finally(() => {
      if (flightEpoch.current === requestedEpoch) flight.current = null;
    });
    return flight.current;
  }, [client, clearForProtocolError, loadIdentity, memberProtocol]);

  // Reuse the board's bounded visible version poll. A recovered API with the
  // same version must still replace a passive snapshot with live authorization.
  const checkVersion = React.useCallback(async () => {
    if (!client || client.isPurged()) throw new Error("No device client");
    try {
      const res = await client.request<{ version?: unknown }>(
        "/api/device/today/version",
        {
          optionalRoute: true,
          headers:
            memberProtocol === 2 ? { "X-Member-Protocol": "2" } : undefined,
        },
      );
      if (typeof res?.version !== "string")
        throw new Error("board version missing");
      if (cachedRef.current) await load();
      return res.version;
    } catch (error) {
      if (isMemberProtocolUnavailable(error)) clearForProtocolError();
      throw error;
    }
  }, [client, clearForProtocolError, load, memberProtocol]);

  React.useEffect(() => {
    if (!client) return;
    const clear = () => {
      invalidate();
      confirmedAt.current = null;
      dataRef.current = null;
      cachedRef.current = false;
      setData(null);
      setCached(false);
      setCacheUnavailable(false);
      setProtocolError(false);
      setError("This tablet was removed.");
    };
    const unsubscribe = client.subscribe((event) => {
      if (event === "purge") clear();
    });
    const requestedEpoch = epoch.current;
    void (async () => {
      await client.bootstrap(hasAccessCookie);
      if (requestedEpoch !== epoch.current || client.isPurged()) return;
      await load();
    })();
    const online = () => {
      void load();
    };
    const changedIdentity = (event: StorageEvent) => {
      if (
        event.key === DEVICE_ID_KEY &&
        event.oldValue !== null &&
        event.oldValue !== event.newValue
      ) {
        void client.purge();
      }
    };
    const visible = () => {
      if (
        document.visibilityState === "visible" &&
        (cachedRef.current || !dataRef.current)
      )
        void load();
    };
    window.addEventListener("online", online);
    window.addEventListener("storage", changedIdentity);
    document.addEventListener("visibilitychange", visible);
    return () => {
      invalidate();
      unsubscribe();
      window.removeEventListener("online", online);
      window.removeEventListener("storage", changedIdentity);
      document.removeEventListener("visibilitychange", visible);
    };
  }, [client, hasAccessCookie, load, invalidate]);

  React.useEffect(() => {
    if (!data) return;
    let timer: ReturnType<typeof setTimeout>;
    const check = () => {
      const now = Date.now();
      const last = confirmedAt.current;
      if (
        last === null ||
        last > now ||
        now - last >= DEVICE_BOARD_MAX_AGE_MS
      ) {
        dataRef.current = null;
        cachedRef.current = false;
        setData(null);
        setCached(false);
        setError("Reconnect to see today's plan.");
        const store = storage();
        const id = knownDeviceId(store);
        if (id) clearDeviceBoardCache(store, id);
        return;
      }
      clearTimeout(timer);
      timer = setTimeout(
        check,
        Math.min(60000, DEVICE_BOARD_MAX_AGE_MS - (now - last)),
      );
    };
    check();
    document.addEventListener("visibilitychange", check);
    window.addEventListener("pageshow", check);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", check);
      window.removeEventListener("pageshow", check);
    };
  }, [data]);

  return {
    data,
    error,
    protocolError,
    cached,
    cacheUnavailable,
    load,
    checkVersion,
  };
}
