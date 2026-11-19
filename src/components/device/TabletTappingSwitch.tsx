"use client";

import * as React from "react";
import { Hand } from "lucide-react";
import { useDeviceText, type DeviceMessage } from "@/i18n/device-management";
import { errorTextClass, noticeTextClass } from "./styles";

type Loaded = { available: boolean; enabled: boolean };

/**
 * Settings › Devices: the household's tablet-writes switch
 * (`Family.device_writes_enabled`, SHARED_DEVICE.md §9.2) on the phone, next
 * to the tablets it affects. It is the same switch as Board settings › Family
 * tablet and the pairing question, saved through the existing parent-only
 * PATCH /api/family/board-settings (audited; one route for D1 and Postgres).
 */
export default function TabletTappingSwitch({
  reloadKey = 0,
}: {
  /** Bump to re-read the switch (for example after a pairing changed it). */
  reloadKey?: number;
}) {
  const text = useDeviceText();
  const [state, setState] = React.useState<Loaded | null>(null);
  const [loadFailed, setLoadFailed] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [notice, setNotice] = React.useState<DeviceMessage | null>(null);
  const [failed, setFailed] = React.useState(false);

  React.useEffect(() => {
    let live = true;
    void (async () => {
      try {
        const res = await fetch("/api/family/board-settings", {
          cache: "no-store",
        });
        if (!res.ok) throw new Error(String(res.status));
        const body = (await res.json()) as {
          deviceWrites?: { available?: unknown; enabled?: unknown };
        };
        if (!live) return;
        setState({
          available: body.deviceWrites?.available === true,
          enabled: body.deviceWrites?.enabled === true,
        });
        setLoadFailed(false);
      } catch {
        if (live) setLoadFailed(true);
      }
    })();
    return () => {
      live = false;
    };
  }, [reloadKey]);

  const save = async (enabled: boolean) => {
    setBusy(true);
    setFailed(false);
    setNotice(null);
    try {
      const res = await fetch("/api/family/board-settings", {
        method: "PATCH",
        cache: "no-store",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ deviceWrites: { enabled } }),
      });
      if (!res.ok) throw new Error(String(res.status));
      const body = (await res.json()) as {
        deviceWrites?: { available?: unknown; enabled?: unknown };
      };
      const saved = body.deviceWrites?.enabled === true;
      setState({ available: true, enabled: saved });
      setNotice(saved ? "tappingOn" : "tappingOff");
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section
      aria-labelledby="tablet-tapping-title"
      data-testid="tablet-tapping"
      className="rounded-[var(--radius-xl)] border border-[var(--surface-separator)] bg-[var(--surface-elevated)] p-5"
    >
      <h2
        id="tablet-tapping-title"
        className="flex items-center gap-2 text-[19px] font-bold leading-tight text-label-primary"
      >
        <Hand className="h-5 w-5 shrink-0 text-accent" aria-hidden="true" />
        {text("tappingTitle")}
      </h2>
      {loadFailed && (
        <p role="alert" className={`mt-3 ${errorTextClass}`}>
          {text("tappingLoadFailed")}
        </p>
      )}
      {state && !state.available && (
        <p className="mt-3 text-[16px] text-label-secondary">
          {text("tappingUnavailable")}
        </p>
      )}
      {state?.available && (
        <>
          <label className="mt-3 flex min-h-[44px] items-center gap-3 text-[17px] font-semibold text-label-primary">
            <input
              type="checkbox"
              role="switch"
              aria-checked={state.enabled}
              className="h-6 w-6 shrink-0"
              checked={state.enabled}
              disabled={busy}
              onChange={(e) => void save(e.target.checked)}
            />
            <span className="min-w-0">{text("tappingLabel")}</span>
          </label>
          <p className="mt-1 text-[15px] leading-snug text-label-secondary">
            {text("tappingHelp")}
          </p>
        </>
      )}
      <div role="status" aria-live="polite">
        {notice && (
          <p className={`mt-3 ${noticeTextClass}`}>{text(notice)}</p>
        )}
      </div>
      {failed && (
        <p role="alert" className={`mt-3 ${errorTextClass}`}>
          {text("tappingSaveFailed")}
        </p>
      )}
    </section>
  );
}
