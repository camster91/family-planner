"use client";

import * as React from "react";
import Link from "next/link";
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  ChevronDown,
  CircleSlash,
  Clock,
  Loader2,
  Plus,
  TabletSmartphone,
} from "lucide-react";
import { Dialog } from "@/components/ui/dialog";
import { useDisplayLocale } from "@/components/ui/use-display-locale";
import PairTabletDialog from "./PairTabletDialog";
import {
  dangerButtonClass,
  errorTextClass,
  focusRing,
  inputClass,
  labelClass,
  neutralButtonClass,
  noticeTextClass,
  primaryButtonClass,
} from "./styles";
import { PRODUCT_BRAND } from "@/lib/brand";
import {
  useDeviceText,
  englishDeviceText,
  type DeviceText,
  type DeviceFeedback,
  type DeviceMessage,
} from "@/i18n/device-management";

export interface ManagedDevice {
  id: string;
  label: string;
  platform: string;
  pairedAt: string;
  lastSeenAt: string | null;
  appVersion: string | null;
  status: "active" | "removed" | "expired";
  revokedAt: string | null;
  revokeReason: string | null;
}

interface DeviceEvent {
  type: string;
  actorName: string | null;
  createdAt: string;
  metadata: Record<string, unknown>;
}

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/**
 * Display only, in the viewer's locale (useDisplayLocale): "Oct 4" / "4 Oct",
 * with a month name so 10/4 vs 4/10 cannot be misread.
 */
export function shortDate(iso: string, locale: string): string {
  return new Date(iso).toLocaleDateString(locale, {
    month: "short",
    day: "numeric",
  });
}

/** "Oct 4, 3:05 PM" / "4 Oct, 15:05" for the device activity list. */
export function eventTime(iso: string, locale: string): string {
  return new Date(iso).toLocaleString(locale, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/** SHARED_DEVICE.md §7: "Active now" under 10 minutes, a warning after 7 days. */
export function lastSeenText(
  lastSeenAt: string | null,
  now: number,
  text: DeviceText = englishDeviceText,
): { text: string; warn: boolean } {
  if (!lastSeenAt) return { text: text("notSeen"), warn: false };
  const diff = Math.max(0, now - Date.parse(lastSeenAt));
  if (diff < 10 * MINUTE) return { text: text("activeNow"), warn: false };
  if (diff < HOUR)
    return {
      text: text("seenMinutes", { count: Math.floor(diff / MINUTE) }),
      warn: false,
    };
  if (diff < DAY) {
    const h = Math.floor(diff / HOUR);
    return {
      text: text(h === 1 ? "seenHour" : "seenHours", { count: h }),
      warn: false,
    };
  }
  const d = Math.floor(diff / DAY);
  if (d > 7) return { text: text("notSeenDays", { count: d }), warn: true };
  return {
    text: text(d === 1 ? "seenDay" : "seenDays", { count: d }),
    warn: false,
  };
}
const REVOKE_REASON_KEYS: Record<string, DeviceMessage> = {
  parent: "reasonParent",
  lost: "reasonLost",
  replaced: "reasonReplaced",
  token_reuse: "reasonReuse",
};
function reasonText(
  value: string,
  text: DeviceText,
  preserveUnknown = false,
): string {
  return Object.prototype.hasOwnProperty.call(REVOKE_REASON_KEYS, value)
    ? text(REVOKE_REASON_KEYS[value])
    : preserveUnknown
      ? value
      : text("removedNeutral");
}
/** Optional copy preserves the default English helper contract for other callers. */
export function describeEvent(
  event: DeviceEvent,
  text: DeviceText = englishDeviceText,
): string {
  const by = event.actorName ? text("by", { name: event.actorName }) : "";
  const m = event.metadata ?? {};
  switch (event.type) {
    case "device.paired":
      return text("auditPaired", { by });
    case "device.renamed":
      return text("auditRenamed", { by });
    case "device.revoked":
      return text("auditRemoved", {
        by,
        reason: reasonText(String(m.reason), text),
      });
    case "device.token_reuse_detected":
      return text("auditReuse");
    case "device.elevation_started":
      return text("auditStarted", {
        by,
        method:
          m.method === "password"
            ? text("withPassword")
            : m.method === "pin"
              ? text("withPin")
              : "",
      });
    case "device.elevation_ended":
      return text("auditEnded", { by });
    case "device.elevation_locked":
      return text("auditLocked", { actor: by ? ` (${event.actorName})` : "" });
    case "device.elevated_action":
      return text(
        m.action === "rename_device"
          ? "auditRenameTablet"
          : m.action === "revoke_device"
            ? "auditRemoveTablet"
            : "auditParentAction",
        { by },
      );
    case "device.member_action":
      return text("auditMemberAction", { by });
    case "device.pairing_claimed":
      return text("auditClaimed");
    case "device.pairing_confirmed":
      return text("auditConfirmed", { by });
    case "device.pairing_cancelled":
      return text("auditCancelled");
    default:
      return text("auditUnknown");
  }
}

function StatusBadge({ device }: { device: ManagedDevice }) {
  const text = useDeviceText();
  // Text and icon, never colour alone.
  if (device.status === "active") {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-[var(--success-tint)] px-3 py-1 text-[14px] font-semibold text-label-primary">
        <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
        {text("active")}
      </span>
    );
  }
  if (device.status === "expired") {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-[var(--warning-tint)] px-3 py-1 text-[14px] font-semibold text-label-primary">
        <Clock className="h-4 w-4" aria-hidden="true" />
        {text("expired")}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-[var(--surface-fill)] px-3 py-1 text-[14px] font-semibold text-label-primary">
      <CircleSlash className="h-4 w-4" aria-hidden="true" />
      Removed
    </span>
  );
}

function Activity({ deviceId }: { deviceId: string }) {
  const text = useDeviceText();
  const [events, setEvents] = React.useState<DeviceEvent[] | null>(null);
  const [error, setError] = React.useState(false);
  const locale = useDisplayLocale();

  React.useEffect(() => {
    let cancelled = false;
    fetch(`/api/family/devices/${encodeURIComponent(deviceId)}/events`, {
      cache: "no-store",
    })
      .then((r) =>
        r.ok ? r.json() : Promise.reject(new Error(String(r.status))),
      )
      .then((body: { events: DeviceEvent[] }) => {
        if (!cancelled) setEvents(body.events);
      })
      .catch(() => {
        if (!cancelled) setError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [deviceId]);

  if (error)
    return (
      <p className="text-[15px] text-label-secondary">
        {text("activityFailed")}
      </p>
    );
  if (!events) {
    return (
      <p
        role="status"
        className="flex items-center gap-2 text-[15px] text-label-secondary"
      >
        <Loader2
          className="h-4 w-4 motion-safe:animate-spin"
          aria-hidden="true"
        />
        {text("activityLoading")}
      </p>
    );
  }
  if (events.length === 0)
    return (
      <p className="text-[15px] text-label-secondary">
        {text("activityEmpty")}
      </p>
    );
  return (
    <ol className="space-y-2" data-testid="device-activity">
      {events.map((event, i) => (
        <li
          key={`${event.createdAt}-${i}`}
          className="flex flex-wrap gap-x-3 text-[15px]"
        >
          <span className="text-label-secondary tabular-nums">
            {eventTime(event.createdAt, locale)}
          </span>
          <span className="text-label-primary">
            {describeEvent(event, text)}
          </span>
        </li>
      ))}
    </ol>
  );
}

function DeviceRow({
  device,
  now,
  onRename,
  onRemove,
  onReplace,
}: {
  device: ManagedDevice;
  now: number;
  onRename: () => void;
  onRemove: () => void;
  onReplace: () => void;
}) {
  const text = useDeviceText();
  const [showActivity, setShowActivity] = React.useState(false);
  const locale = useDisplayLocale();
  const seen = lastSeenText(device.lastSeenAt, now, text);
  const active = device.status === "active";
  const activityId = `device-activity-${device.id}`;

  return (
    <li
      data-testid="device-row"
      data-status={device.status}
      className={[
        "rounded-[var(--radius-xl)] border border-[var(--surface-separator)] bg-[var(--surface-elevated)] p-5 shadow-[var(--shadow-sm)]",
        device.status === "removed" ? "opacity-75" : "",
      ].join(" ")}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="break-words text-[19px] font-bold leading-tight text-label-primary">
            {device.label}
          </h2>
          <p className="mt-1 text-[15px] text-label-secondary">
            {device.platform === "android"
              ? text("android")
              : device.platform === "web"
                ? text("browser")
                : device.platform}{" "}
            · {text("paired", { date: shortDate(device.pairedAt, locale) })}
            {device.appVersion && device.appVersion !== "web"
              ? ` · ${text("version", { version: device.appVersion })}`
              : ""}
          </p>
          {device.status === "removed" ? (
            <p className="mt-1 text-[15px] text-label-secondary">
              {text("removedOn", {
                date: device.revokedAt
                  ? shortDate(device.revokedAt, locale)
                  : "",
              })}
              {device.revokeReason
                ? ` (${reasonText(device.revokeReason, text, true)})`
                : ""}
            </p>
          ) : (
            <p
              className={[
                "mt-1 flex items-center gap-1.5 text-[15px]",
                seen.warn
                  ? "font-semibold text-[var(--warning-text)]"
                  : "text-label-secondary",
              ].join(" ")}
            >
              {seen.warn && (
                <AlertTriangle className="h-4 w-4" aria-hidden="true" />
              )}
              {seen.text}
            </p>
          )}
          {device.status === "expired" && (
            <p className="mt-1 text-[15px] text-label-secondary">
              {text("expiredHelp")}
            </p>
          )}
        </div>
        <StatusBadge device={device} />
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        {active && (
          <>
            <button
              type="button"
              onClick={onRename}
              className={neutralButtonClass}
            >
              {text("rename")}
            </button>
            <button
              type="button"
              onClick={onReplace}
              className={neutralButtonClass}
            >
              {text("replace")}
            </button>
          </>
        )}
        {device.status !== "removed" && (
          <button
            type="button"
            onClick={onRemove}
            className={neutralButtonClass}
          >
            {text("removeTablet")}
          </button>
        )}
        <button
          type="button"
          aria-expanded={showActivity}
          aria-controls={activityId}
          onClick={() => setShowActivity((v) => !v)}
          className={neutralButtonClass}
        >
          {text("recentActivity")}
          <ChevronDown
            className={`h-4 w-4 motion-safe:transition-transform ${showActivity ? "rotate-180" : ""}`}
            aria-hidden="true"
          />
        </button>
      </div>
      {showActivity && (
        <div
          id={activityId}
          className="mt-4 border-t border-[var(--surface-separator)] pt-4"
        >
          <Activity deviceId={device.id} />
        </div>
      )}
    </li>
  );
}

/**
 * /dashboard/settings/devices (SHARED_DEVICE.md §7, #241): the household's
 * shared tablets for a parent. Rename, remove with a reason, pair or replace,
 * and recent activity per tablet.
 */
export default function DevicesManager() {
  const text = useDeviceText();
  const [devices, setDevices] = React.useState<ManagedDevice[] | null>(null);
  const [loadError, setLoadError] = React.useState(false);
  const [now, setNow] = React.useState(() => Date.now());
  const [pairOpen, setPairOpen] = React.useState(false);
  const [replaceTarget, setReplaceTarget] =
    React.useState<ManagedDevice | null>(null);
  const [renameTarget, setRenameTarget] = React.useState<ManagedDevice | null>(
    null,
  );
  const [removeTarget, setRemoveTarget] = React.useState<ManagedDevice | null>(
    null,
  );
  const [message, setMessage] = React.useState<DeviceFeedback | null>(null);

  const load = React.useCallback(async () => {
    try {
      const res = await fetch("/api/family/devices", { cache: "no-store" });
      if (!res.ok) throw new Error(String(res.status));
      const body = (await res.json()) as { devices: ManagedDevice[] };
      setDevices(body.devices);
      setNow(Date.now());
      setLoadError(false);
    } catch {
      setLoadError(true);
    }
  }, []);

  React.useEffect(() => {
    void load();
  }, [load]);

  const replace = React.useMemo(
    () =>
      replaceTarget
        ? { id: replaceTarget.id, label: replaceTarget.label }
        : null,
    [replaceTarget],
  );

  return (
    <div className="mx-auto max-w-3xl space-y-6" data-testid="devices-page">
      <Link
        href="/dashboard/settings"
        className={`inline-flex min-h-[44px] items-center gap-2 rounded-full pr-3 text-[16px] font-semibold text-accent ${focusRing}`}
      >
        <ArrowLeft className="h-5 w-5" aria-hidden="true" />
        {text("settings")}
      </Link>

      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-[32px] font-bold leading-tight text-label-primary">
            {text("devices")}
          </h1>
          <p className="mt-1 max-w-xl text-[16px] leading-snug text-label-secondary">
            {text("intro")}
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            setMessage(null);
            setReplaceTarget(null);
            setPairOpen(true);
          }}
          className={primaryButtonClass}
        >
          <Plus className="h-5 w-5" aria-hidden="true" />
          {text("pairTablet")}
        </button>
      </div>

      {message && (
        <p role="status" className={noticeTextClass}>
          {text(message.key, message.params)}
        </p>
      )}

      {loadError && (
        <div role="alert" className={errorTextClass}>
          {text("loadFailed")}{" "}
          <button
            type="button"
            onClick={() => void load()}
            className={`underline ${focusRing}`}
          >
            {text("retry")}
          </button>
        </div>
      )}

      {!devices && !loadError && (
        <p
          role="status"
          className="flex items-center gap-2 text-[16px] text-label-secondary"
        >
          <Loader2
            className="h-5 w-5 motion-safe:animate-spin"
            aria-hidden="true"
          />
          {text("loadingTablets")}
        </p>
      )}

      {devices && devices.length === 0 && (
        <div className="rounded-[var(--radius-xl)] border border-dashed border-[var(--surface-separator-opaque)] p-8 text-center">
          <TabletSmartphone
            className="mx-auto h-10 w-10 text-label-secondary"
            aria-hidden="true"
          />
          <p className="mt-3 text-[17px] text-label-primary">
            {text("noTablets")}
          </p>
          <p className="mt-1 text-[15px] text-label-secondary">
            {text("noTabletsHelp")}
          </p>
        </div>
      )}

      {devices && devices.length > 0 && (
        <ul
          className="space-y-4"
          aria-label={text("tablets")}
          data-testid="device-list"
        >
          {devices.map((device) => (
            <DeviceRow
              key={device.id}
              device={device}
              now={now}
              onRename={() => setRenameTarget(device)}
              onRemove={() => setRemoveTarget(device)}
              onReplace={() => {
                setMessage(null);
                setReplaceTarget(device);
                setPairOpen(true);
              }}
            />
          ))}
        </ul>
      )}

      <PairTabletDialog
        open={pairOpen}
        replace={replace}
        onClose={() => setPairOpen(false)}
        onPaired={() => void load()}
      />

      <RenameDeviceDialog
        device={renameTarget}
        onClose={() => setRenameTarget(null)}
        onDone={(label) => {
          setRenameTarget(null);
          setMessage({ key: "renameDone", params: { label } });
          void load();
        }}
      />

      <RemoveDeviceDialog
        device={removeTarget}
        onClose={() => setRemoveTarget(null)}
        onDone={(label) => {
          setRemoveTarget(null);
          setMessage({ key: "removeDone", params: { label } });
          void load();
        }}
      />
    </div>
  );
}

function RenameDeviceDialog({
  device,
  onClose,
  onDone,
}: {
  device: ManagedDevice | null;
  onClose: () => void;
  onDone: (label: string) => void;
}) {
  const text = useDeviceText();
  const [label, setLabel] = React.useState("");
  const [error, setError] = React.useState<DeviceFeedback | null>(null);
  const [busy, setBusy] = React.useState(false);
  const busyRef = React.useRef(false);
  const inputRef = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    if (device) {
      setLabel(device.label);
      setError(null);
    }
  }, [device]);

  return (
    <Dialog
      open={device !== null}
      onClose={
        busy
          ? undefined
          : () => {
              if (!busyRef.current) onClose();
            }
      }
      variant="form"
      closeLabel={text("close")}
      title={text("renameTitle")}
      initialFocusRef={inputRef}
      testId="rename-device"
    >
      <form
        className="space-y-5"
        noValidate
        onSubmit={async (e) => {
          e.preventDefault();
          if (!device || busyRef.current) return;
          const trimmed = label.trim();
          if (!trimmed || trimmed.length > 40)
            return setError({ key: "nameLength" });
          busyRef.current = true;
          setBusy(true);
          setError(null);
          try {
            const res = await fetch(
              `/api/family/devices/${encodeURIComponent(device.id)}`,
              {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ label: trimmed }),
              },
            );
            if (res.ok) onDone(trimmed);
            else
              setError({
                key: res.status === 429 ? "tooManyChanges" : "renameFailed",
              });
          } catch {
            setError({
              key: "unreachable",
              params: { brand: PRODUCT_BRAND.name },
            });
          } finally {
            busyRef.current = false;
            setBusy(false);
          }
        }}
      >
        <div>
          <label htmlFor="rename-device-label" className={labelClass}>
            {text("tabletName")}
          </label>
          <input
            ref={inputRef}
            id="rename-device-label"
            disabled={busy}
            value={label}
            maxLength={40}
            onChange={(e) => setLabel(e.target.value)}
            className={inputClass}
            autoComplete="off"
          />
        </div>
        {error && (
          <p role="alert" className={errorTextClass}>
            {text(error.key, error.params)}
          </p>
        )}
        <div className="flex flex-wrap gap-3">
          <button type="submit" disabled={busy} className={primaryButtonClass}>
            {text("saveName")}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              if (!busyRef.current) onClose();
            }}
            className={neutralButtonClass}
          >
            {text("cancel")}
          </button>
        </div>
      </form>
    </Dialog>
  );
}

const REASONS = [
  { value: "lost", label: "lost" },
  { value: "replaced", label: "replaced" },
  { value: "other", label: "other" },
] as const;

function RemoveDeviceDialog({
  device,
  onClose,
  onDone,
}: {
  device: ManagedDevice | null;
  onClose: () => void;
  onDone: (label: string) => void;
}) {
  const text = useDeviceText();
  const [reason, setReason] = React.useState<string>("");
  const [error, setError] = React.useState<DeviceFeedback | null>(null);
  const [busy, setBusy] = React.useState(false);
  const busyRef = React.useRef(false);

  React.useEffect(() => {
    if (device) {
      setReason("");
      setError(null);
    }
  }, [device]);

  return (
    <Dialog
      open={device !== null}
      onClose={
        busy
          ? undefined
          : () => {
              if (!busyRef.current) onClose();
            }
      }
      role="alertdialog"
      closeLabel={text("close")}
      title={text(
        device ? "removeTitle" : "removeTitleEmpty",
        device ? { label: device.label } : undefined,
      )}
      description={text("removeDescription")}
      testId="remove-device"
    >
      <form
        className="space-y-5"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!device || busyRef.current) return;
          busyRef.current = true;
          setBusy(true);
          setError(null);
          try {
            const res = await fetch(
              `/api/family/devices/${encodeURIComponent(device.id)}/revoke`,
              {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(reason ? { reason } : {}),
              },
            );
            if (res.ok) onDone(device.label);
            else
              setError({
                key: res.status === 429 ? "tooManyChanges" : "removeFailed",
              });
          } catch {
            setError({
              key: "unreachable",
              params: { brand: PRODUCT_BRAND.name },
            });
          } finally {
            busyRef.current = false;
            setBusy(false);
          }
        }}
      >
        <fieldset disabled={busy}>
          <legend className={labelClass}>{text("reason")}</legend>
          <div className="space-y-1">
            {REASONS.map((r) => (
              <label
                key={r.value}
                className="flex min-h-[44px] items-center gap-3 text-[16px] text-label-primary"
              >
                <input
                  type="radio"
                  name="remove-reason"
                  value={r.value}
                  checked={reason === r.value}
                  onChange={() => setReason(r.value)}
                  className="h-5 w-5"
                />
                {text(r.label)}
              </label>
            ))}
          </div>
        </fieldset>
        {error && (
          <p role="alert" className={errorTextClass}>
            {text(error.key, error.params)}
          </p>
        )}
        <div className="flex flex-wrap gap-3">
          <button type="submit" disabled={busy} className={dangerButtonClass}>
            {text("removeTablet")}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              if (!busyRef.current) onClose();
            }}
            className={neutralButtonClass}
          >
            {text("cancel")}
          </button>
        </div>
      </form>
    </Dialog>
  );
}

export function DevicesNoHousehold() {
  const text = useDeviceText();
  return (
    <div className="mx-auto max-w-lg py-16 text-center">
      <h1 className="text-title-1 text-label-primary">{text("devices")}</h1>
      <p className="mt-3 text-body text-label-secondary">
        {text("noHousehold")}
      </p>
    </div>
  );
}
