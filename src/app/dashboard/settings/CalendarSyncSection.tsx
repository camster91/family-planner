"use client";

// Settings → Connected calendars (#264). Two-way sync with a member's Google
// or Outlook calendar. Renders nothing unless the server has calendar sync
// configured (the API answers 404 while it is off) and the viewer is a parent.

import { useCallback, useEffect, useState } from "react";
import { CalendarSync, Link2, RefreshCw, Unlink } from "lucide-react";
import { describeCalendarSync } from "@/lib/calendar-sync-status";
import { useNow } from "@/components/fridge/sync-status";
import SettingsDisclosure from "./SettingsDisclosure";
import SettingsIcon from "./SettingsIcon";
import {
  useSettingsCopy,
  useCalendarSyncCopy,
  SettingsText,
} from "./settings-copy";
import {
  settingsFeedback,
  settingsResponseError,
  type SettingsFeedback,
  type SettingsMessage,
} from "@/i18n/settings";

interface Provider {
  id: string;
  label: string;
}

interface Connection {
  id: string;
  provider: string;
  provider_label: string;
  calendar_id: string | null;
  calendar_name: string | null;
  push_mode: string;
  status: string;
  last_synced_at: string | null;
  last_error: string | null;
  conflicts_count: number;
  owner: { id: string; name: string };
  is_mine: boolean;
}

interface RemoteCalendar {
  id: string;
  name: string;
  primary: boolean;
}

const OUTCOMES: Record<string, { ok: boolean; key: SettingsMessage }> = {
  connected: { ok: true, key: "connected" },
  denied: { ok: false, key: "connectionDenied" },
  state: { ok: false, key: "connectionState" },
  exchange: { ok: false, key: "connectionExchange" },
  forbidden: { ok: false, key: "connectionForbidden" },
  limit: { ok: false, key: "connectionLimit" },
  scope: {
    ok: false,
    key: "connectionScope",
  },
  error: { ok: false, key: "connectionError" },
};

// Short, familiar button names; the provider label stays for everything else.
const CONNECT_LABELS: Record<string, SettingsMessage> = {
  google: "connectGoogle",
  microsoft: "connectOutlook",
};

const BUTTON =
  "inline-flex items-center min-h-[44px] px-3 rounded-lg border border-input text-foreground hover:bg-muted disabled:opacity-60";

/** Last sync and any problem, in words (#271). */
function statusText(
  c: Connection,
  now: number,
  copy: ReturnType<typeof useSettingsCopy>,
  messages: import("@/lib/calendar-sync-status").CalendarSyncMessages,
): string {
  if (!c.calendar_id)
    return c.is_mine
      ? copy("chooseCalendarStatus")
      : copy("waitingOwner", { name: c.owner.name });
  // Only the member who connected can reconnect: tell everyone else who to ask.
  if (c.status === "reauth_required" && !c.is_mine)
    return copy("ownerReconnect", { name: c.owner.name });
  return describeCalendarSync({
    lastAttemptAt: c.last_synced_at,
    failed: c.status === "error" || c.status === "reauth_required",
    error: c.last_error,
    now,
    verb: "synced",
    failedFallback: copy(
      c.status === "reauth_required" ? "reconnectFallback" : "syncLastFailed",
    ),
    messages,
  }).text;
}

export default function CalendarSyncSection() {
  const copy = useSettingsCopy();
  const syncCopy = useCalendarSyncCopy();
  const [available, setAvailable] = useState(false);
  const [providers, setProviders] = useState<Provider[]>([]);
  const [connections, setConnections] = useState<Connection[]>([]);
  // Keeps "Last synced 3 min ago" current (#271).
  const now = useNow(30 * 1000) ?? Date.now();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<SettingsFeedback | null>(null);
  const [notice, setNotice] = useState<SettingsFeedback | null>(null);
  const [picking, setPicking] = useState<{
    id: string;
    calendars: RemoteCalendar[];
    value: string;
  } | null>(null);

  const load = useCallback(async (): Promise<Connection[] | null> => {
    try {
      const res = await fetch("/api/calendar/connections");
      if (!res.ok) {
        setAvailable(false);
        return null;
      }
      const data = await res.json();
      const list: Connection[] = Array.isArray(data.connections)
        ? data.connections
        : [];
      setProviders(Array.isArray(data.providers) ? data.providers : []);
      setConnections(list);
      setAvailable(true);
      return list;
    } catch {
      setAvailable(false);
      return null;
    }
  }, []);

  useEffect(() => {
    let outcome: string | null = null;
    try {
      outcome = new URLSearchParams(window.location.search).get(
        "calendar_sync",
      );
    } catch {
      // ignore
    }
    load().then((list) => {
      // Straight back from the provider: go on to the calendar choice.
      const waiting =
        outcome === "connected"
          ? list?.find((c) => c.is_mine && !c.calendar_id)
          : undefined;
      if (waiting) void openPicker(waiting);
    });
    try {
      const known =
        outcome && Object.prototype.hasOwnProperty.call(OUTCOMES, outcome)
          ? OUTCOMES[outcome]
          : undefined;
      if (known) {
        if (known.ok) setNotice(settingsFeedback(known.key));
        else setError(settingsFeedback(known.key));
        const url = new URL(window.location.href);
        url.searchParams.delete("calendar_sync");
        window.history.replaceState(null, "", url.toString());
      }
    } catch {
      // ignore
    }
  }, [load]);

  const replace = (c: Connection | null | undefined) => {
    if (!c) return;
    setConnections((prev) => prev.map((x) => (x.id === c.id ? c : x)));
  };

  const connect = async (provider: string) => {
    setBusy(`connect:${provider}`);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch(
        `/api/calendar/connections/${encodeURIComponent(provider)}/start`,
        { method: "POST" },
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok || typeof data.authorize_url !== "string") {
        setError(settingsResponseError(data.error, "connectFailed"));
        setBusy(null);
        return;
      }
      window.location.assign(data.authorize_url);
    } catch {
      setError(settingsFeedback("connectFailed"));
      setBusy(null);
    }
  };

  const openPicker = async (c: Connection) => {
    setBusy(`pick:${c.id}`);
    setError(null);
    try {
      const res = await fetch(
        `/api/calendar/sync-connections/${encodeURIComponent(c.id)}/calendars`,
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(settingsResponseError(data.error, "pickerFailed"));
        return;
      }
      const cals: RemoteCalendar[] = Array.isArray(data.calendars)
        ? data.calendars
        : [];
      const initial =
        c.calendar_id ?? cals.find((x) => x.primary)?.id ?? cals[0]?.id ?? "";
      setPicking({ id: c.id, calendars: cals, value: initial });
    } catch {
      setError(settingsFeedback("pickerFailed"));
    } finally {
      setBusy(null);
    }
  };

  const patch = async (
    id: string,
    body: Record<string, string>,
    success: SettingsFeedback,
  ) => {
    setBusy(`save:${id}`);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch(
        `/api/calendar/sync-connections/${encodeURIComponent(id)}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(settingsResponseError(data.error, "connectionSaveFailed"));
        return false;
      }
      replace(data.connection);
      setNotice(success);
      return true;
    } catch {
      setError(settingsFeedback("connectionSaveFailed"));
      return false;
    } finally {
      setBusy(null);
    }
  };

  const syncNow = async (c: Connection) => {
    setBusy(`sync:${c.id}`);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch(
        `/api/calendar/sync-connections/${encodeURIComponent(c.id)}/sync`,
        { method: "POST" },
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(settingsResponseError(data.error, "syncFailed"));
        return;
      }
      replace(data.connection);
      const r = data.result;
      if (r?.status === "ok") {
        const inCount = r.pulled.created + r.pulled.updated + r.pulled.deleted;
        const outCount = r.pushed.created + r.pushed.updated + r.pushed.deleted;
        setNotice(
          settingsFeedback(inCount === 1 ? "syncedOne" : "syncedMany", {
            inCount,
            outCount,
          }),
        );
      } else if (r?.error) {
        setError({ raw: String(r.error) });
      }
    } catch {
      setError(settingsFeedback("syncFailed"));
    } finally {
      setBusy(null);
    }
  };

  const disconnect = async (c: Connection) => {
    if (
      !window.confirm(
        copy(c.is_mine ? "disconnectMineConfirm" : "disconnectOtherConfirm", {
          provider: c.provider_label,
          calendar: c.calendar_name ? ` (${c.calendar_name})` : "",
          name: c.owner.name,
        }),
      )
    )
      return;
    setBusy(`remove:${c.id}`);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch(
        `/api/calendar/sync-connections/${encodeURIComponent(c.id)}`,
        { method: "DELETE" },
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(settingsResponseError(data.error, "connectionRemoveFailed"));
        return;
      }
      setConnections((prev) => prev.filter((x) => x.id !== c.id));
      setNotice(
        settingsFeedback("disconnected", { provider: c.provider_label }),
      );
    } catch {
      setError(settingsFeedback("connectionRemoveFailed"));
    } finally {
      setBusy(null);
    }
  };

  if (!available) return null;

  const mineByProvider = new Set(
    connections.filter((c) => c.is_mine).map((c) => c.provider),
  );
  const connectable = providers.filter((p) => !mineByProvider.has(p.id));

  return (
    <SettingsDisclosure
      id="calendar-sync"
      headingId="calendar-sync-heading"
      title={copy("connectedCalendars")}
      description={copy("connectedDescription")}
      icon={<SettingsIcon icon={CalendarSync} tone="emerald" />}
      forceOpen={Boolean(notice || error)}
    >
      {connections.length === 0 ? (
        <p className="text-sm text-muted-foreground mb-4">
          {copy("connectIntro")}
        </p>
      ) : (
        <ul className="space-y-3 mb-6">
          {connections.map((c) => (
            <li key={c.id} className="rounded-lg border border-border p-3">
              <div className="min-w-0">
                <div className="font-medium text-foreground break-words">
                  {c.provider_label}
                  {c.calendar_name ? ` · ${c.calendar_name}` : ""}
                </div>
                {!c.is_mine && (
                  <div className="text-xs text-muted-foreground">
                    {copy("connectedBy", { name: c.owner.name })}
                  </div>
                )}
                <div
                  className={`text-xs mt-1 ${c.status === "error" || c.status === "reauth_required" ? "text-danger-text" : "text-muted-foreground"}`}
                  role={
                    c.status === "error" || c.status === "reauth_required"
                      ? "status"
                      : undefined
                  }
                >
                  {c.status === "error" || c.status === "reauth_required"
                    ? copy("problem")
                    : ""}
                  {statusText(c, now, copy, syncCopy)}
                </div>
                {c.conflicts_count > 0 && (
                  <div className="text-xs text-muted-foreground mt-1">
                    {copy(
                      c.conflicts_count === 1 ? "conflictOne" : "conflictMany",
                      { count: c.conflicts_count },
                    )}
                  </div>
                )}
              </div>

              {picking?.id === c.id && (
                <div className="mt-3 flex flex-wrap items-end gap-2">
                  <div className="flex-1 min-w-[12rem]">
                    <label
                      htmlFor={`cal-pick-${c.id}`}
                      className="block text-sm font-medium text-foreground mb-1"
                    >
                      {copy("calendarToSync")}
                    </label>
                    {picking.calendars.length === 0 ? (
                      <p className="text-sm text-muted-foreground">
                        {copy("noWritableCalendars")}
                      </p>
                    ) : (
                      <select
                        id={`cal-pick-${c.id}`}
                        className="input-field w-full min-h-[44px]"
                        value={picking.value}
                        onChange={(e) =>
                          setPicking({ ...picking, value: e.target.value })
                        }
                      >
                        {picking.calendars.map((cal) => (
                          <option key={cal.id} value={cal.id}>
                            {cal.name}
                            {cal.primary ? copy("mainSuffix") : ""}
                          </option>
                        ))}
                      </select>
                    )}
                  </div>
                  <button
                    type="button"
                    className="btn-primary inline-flex items-center min-h-[44px]"
                    disabled={busy !== null || !picking.value}
                    onClick={async () => {
                      if (
                        await patch(
                          c.id,
                          { calendar_id: picking.value },
                          settingsFeedback("calendarSaved"),
                        )
                      ) {
                        setPicking(null);
                        const saved = { ...c, calendar_id: picking.value };
                        await syncNow(saved);
                      }
                    }}
                  >
                    {copy("save")}
                  </button>
                  <button
                    type="button"
                    className={BUTTON}
                    onClick={() => setPicking(null)}
                  >
                    {copy("cancel")}
                  </button>
                </div>
              )}

              {c.is_mine && c.calendar_id && picking?.id !== c.id && (
                <fieldset className="mt-3">
                  <legend className="text-sm font-medium text-foreground mb-1">
                    {copy("whatGoesTo", { provider: c.provider_label })}
                  </legend>
                  <div className="flex flex-col gap-1">
                    {[
                      { value: "linked", label: copy("linkedOnly") },
                      { value: "all", label: copy("allEvents") },
                    ].map((opt) => (
                      <label
                        key={opt.value}
                        className="inline-flex items-center gap-2 min-h-[44px] cursor-pointer"
                      >
                        <input
                          type="radio"
                          name={`push-mode-${c.id}`}
                          value={opt.value}
                          checked={c.push_mode === opt.value}
                          disabled={busy !== null}
                          onChange={() =>
                            patch(
                              c.id,
                              { push_mode: opt.value },
                              opt.value === "all"
                                ? settingsFeedback("allEventsSaved")
                                : settingsFeedback("linkedEventsSaved"),
                            )
                          }
                        />
                        <span className="text-sm text-foreground">
                          {opt.label}
                        </span>
                      </label>
                    ))}
                  </div>
                </fieldset>
              )}

              <div className="flex flex-wrap gap-2 mt-3">
                {c.calendar_id && c.status !== "reauth_required" && (
                  <button
                    type="button"
                    onClick={() => syncNow(c)}
                    disabled={busy !== null}
                    className={BUTTON}
                    aria-label={copy("syncLabel", {
                      provider: c.provider_label,
                    })}
                  >
                    <RefreshCw
                      className={`w-4 h-4 mr-2 ${busy === `sync:${c.id}` ? "animate-spin motion-reduce:animate-none" : ""}`}
                      aria-hidden="true"
                    />
                    {copy("syncNow")}
                  </button>
                )}
                {c.is_mine && c.status === "reauth_required" && (
                  <button
                    type="button"
                    onClick={() => connect(c.provider)}
                    disabled={busy !== null}
                    className={BUTTON}
                  >
                    <Link2 className="w-4 h-4 mr-2" aria-hidden="true" />
                    {copy("reconnect")}
                  </button>
                )}
                {c.is_mine &&
                  picking?.id !== c.id &&
                  c.status !== "reauth_required" && (
                    <button
                      type="button"
                      onClick={() => openPicker(c)}
                      disabled={busy !== null}
                      className={BUTTON}
                      aria-label={copy(
                        c.calendar_id
                          ? "changeCalendarLabel"
                          : "chooseCalendarLabel",
                        { provider: c.provider_label },
                      )}
                    >
                      {c.calendar_id
                        ? copy("changeCalendar")
                        : copy("chooseCalendar")}
                    </button>
                  )}
                <button
                  type="button"
                  onClick={() => disconnect(c)}
                  disabled={busy !== null}
                  className="inline-flex items-center min-h-[44px] px-3 rounded-lg border border-[var(--danger-tint)] text-danger-text hover:bg-[var(--danger-tint)] disabled:opacity-60"
                  aria-label={copy("disconnectLabel", {
                    provider: c.provider_label,
                  })}
                >
                  <Unlink className="w-4 h-4 mr-2" aria-hidden="true" />
                  {copy("disconnect")}
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {connectable.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {connectable.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => connect(p.id)}
              disabled={busy !== null}
              className="btn-primary inline-flex items-center min-h-[44px]"
            >
              <Link2 className="w-4 h-4 mr-2" aria-hidden="true" />
              {busy === `connect:${p.id}`
                ? copy("opening")
                : Object.prototype.hasOwnProperty.call(CONNECT_LABELS, p.id)
                  ? copy(CONNECT_LABELS[p.id])
                  : copy("connectProvider", { provider: p.label })}
            </button>
          ))}
        </div>
      )}
      <p className="text-xs text-muted-foreground mt-3">
        {copy("connectionPrivacy")}
      </p>

      <div aria-live="polite" className="mt-3">
        {error && (
          <p className="text-sm text-danger-text">
            <SettingsText feedback={error} />
          </p>
        )}
        {notice && (
          <p className="text-sm text-success-text">
            <SettingsText feedback={notice} />
          </p>
        )}
      </div>
    </SettingsDisclosure>
  );
}
