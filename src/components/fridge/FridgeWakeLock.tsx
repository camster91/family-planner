"use client";

import * as React from "react";

/** Ask the browser to keep the screen on while the board is shown in fridge mode (best effort). */
export default function FridgeWakeLock() {
  React.useEffect(() => {
    type Sentinel = { release: () => Promise<void> };
    const nav = navigator as Navigator & {
      wakeLock?: { request: (type: "screen") => Promise<Sentinel> };
    };
    if (!nav.wakeLock) return;
    let sentinel: Sentinel | null = null;
    let cancelled = false;
    const acquire = async () => {
      try {
        if (document.visibilityState !== "visible") return;
        const s = await nav.wakeLock!.request("screen");
        if (cancelled) void s.release();
        else sentinel = s;
      } catch {
        // Denied or unsupported (battery saver, WebView policy). The board still works.
      }
    };
    void acquire();
    const onVisible = () => {
      if (document.visibilityState === "visible") void acquire();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisible);
      if (sentinel) void sentinel.release().catch(() => {});
    };
  }, []);
  return null;
}
