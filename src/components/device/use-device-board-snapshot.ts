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

/** Cached data is a passive read, never an authorization grant. */
export function useDeviceBoardSnapshot({
  client,
  hasAccessCookie,
  loadIdentity,
}: {
  client: DeviceClient | null;
  hasAccessCookie: boolean;
  loadIdentity: () => Promise<string | null>;
}) {
  const [data, setData] = React.useState<TodayBoardData | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [cached, setCached] = React.useState(false);
  const dataRef = React.useRef<TodayBoardData | null>(null);
  const cachedRef = React.useRef(false);
  const confirmedAt = React.useRef<number | null>(null);
  const epoch = React.useRef(0);
  const flight = React.useRef<Promise<void> | null>(null);
  const flightEpoch = React.useRef(-1);
  const invalidate = React.useCallback(() => {
    epoch.current++;
  }, []);

  const load = React.useCallback((): Promise<void> => {
    if (flight.current && flightEpoch.current === epoch.current)
      return flight.current;
    if (!client || client.isPurged()) return Promise.resolve();
    const requestedEpoch = epoch.current;
    flightEpoch.current = requestedEpoch;
    const current = () =>
      requestedEpoch === epoch.current && !client.isPurged();
    flight.current = (async () => {
      const deviceId = await loadIdentity();
      if (!current()) return;
      try {
        const board = await client.request<TodayBoardData>("/api/device/today");
        if (!current()) return;
        const now = Date.now();
        const store = storage();
        const storedId = knownDeviceId(store);
        if (deviceId && storedId && storedId !== deviceId) {
          await client.purge();
          return;
        }
        if (deviceId && storedId === deviceId)
          writeDeviceBoardCache(store, deviceId, board, now);
        confirmedAt.current = now;
        dataRef.current = board;
        cachedRef.current = false;
        setData(board);
        setCached(false);
        setError(null);
      } catch (err) {
        if (!current() || (err instanceof DeviceApiError && err.terminal))
          return;
        const retryable =
          err instanceof DeviceApiError &&
          (err.status === 0 ||
            err.retryable ||
            err.status >= 500 ||
            [408, 425, 429].includes(err.status));
        if (!retryable) {
          const store = storage();
          const id = knownDeviceId(store);
          if (id) clearDeviceBoardCache(store, id);
          dataRef.current = null;
          confirmedAt.current = null;
          cachedRef.current = false;
          setData(null);
          setCached(false);
        } else if (!dataRef.current) {
          const store = storage();
          const id = knownDeviceId(store);
          const snapshot = id
            ? readDeviceBoardCache(store, id, Date.now())
            : { state: "missing" as const };
          if (snapshot.state === "ready") {
            dataRef.current = snapshot.board;
            confirmedAt.current = snapshot.savedAt;
            cachedRef.current = true;
            setData(snapshot.board);
            setCached(true);
            setError(null);
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
  }, [client, loadIdentity]);

  React.useEffect(() => {
    if (!client) return;
    const clear = () => {
      invalidate();
      confirmedAt.current = null;
      dataRef.current = null;
      cachedRef.current = false;
      setData(null);
      setCached(false);
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

  return { data, error, cached, load };
}
