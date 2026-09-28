"use client";

// Settings → Connected calendars (#264). Two-way sync with a member's Google
// or Outlook calendar. Renders nothing unless the server has calendar sync
// configured (the API answers 404 while it is off) and the viewer is a parent.

import { useCallback, useEffect, useState } from "react";
import { CalendarSync, Link2, RefreshCw, Unlink } from "lucide-react";

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

const OUTCOMES: Record<string, { ok: boolean; text: string }> = {
  connected: { ok: true, text: "Calendar connected. Choose which calendar to sync." },
  denied: { ok: false, text: "Connection cancelled. Nothing was connected." },
  state: { ok: false, text: "That connection link expired or was already used. Try again." },
  exchange: { ok: false, text: "The provider did not complete the connection. Try again." },
  forbidden: { ok: false, text: "Only parents can connect calendars." },
  limit: { ok: false, text: "This household already has the maximum number of connected calendars." },
  error: { ok: false, text: "Could not connect the calendar. Try again." },
};

const BUTTON =
  "inline-flex items-center min-h-[44px] px-3 rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-50 disabled:opacity-60";

function statusText(c: Connection): string {
  if (!c.calendar_id) return "Choose a calendar to start syncing.";
  if (c.status === "reauth_required") return c.last_error || "Reconnect this calendar to keep it in sync.";
  if (c.status === "error") return c.last_error || "Last sync failed.";
  if (!c.last_synced_at) return "Waiting for first sync.";
  const minutes = Math.max(0, Math.round((Date.now() - new Date(c.last_synced_at).getTime()) / 60000));
  const when =
    minutes < 1 ? "just now" : minutes < 60 ? `${minutes} min ago` : new Date(c.last_synced_at).toLocaleString();
  return `Synced ${when}.`;
}

export default function CalendarSyncSection() {
  const [available, setAvailable] = useState(false);
  const [providers, setProviders] = useState<Provider[]>([]);
  const [connections, setConnections] = useState<Connection[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [picking, setPicking] = useState<{ id: string; calendars: RemoteCalendar[]; value: string } | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/calendar/connections");
      if (!res.ok) {
        setAvailable(false);
        return;
      }
      const data = await res.json();
      setProviders(Array.isArray(data.providers) ? data.providers : []);
      setConnections(Array.isArray(data.connections) ? data.connections : []);
      setAvailable(true);
    } catch {
      setAvailable(false);
    }
  }, []);

  useEffect(() => {
    load();
    try {
      const outcome = new URLSearchParams(window.location.search).get("calendar_sync");
      const known = outcome ? OUTCOMES[outcome] : undefined;
      if (known) {
        if (known.ok) setNotice(known.text);
        else setError(known.text);
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
      const res = await fetch(`/api/calendar/connections/${encodeURIComponent(provider)}/start`, { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || typeof data.authorize_url !== "string") {
        setError(data.error || "Could not start connecting that calendar");
        setBusy(null);
        return;
      }
      window.location.assign(data.authorize_url);
    } catch {
      setError("Could not start connecting that calendar");
      setBusy(null);
    }
  };

  const openPicker = async (c: Connection) => {
    setBusy(`pick:${c.id}`);
    setError(null);
    try {
      const res = await fetch(`/api/calendar/sync-connections/${encodeURIComponent(c.id)}/calendars`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || "Could not load your calendars");
        return;
      }
      const cals: RemoteCalendar[] = Array.isArray(data.calendars) ? data.calendars : [];
      const initial = c.calendar_id ?? cals.find((x) => x.primary)?.id ?? cals[0]?.id ?? "";
      setPicking({ id: c.id, calendars: cals, value: initial });
    } catch {
      setError("Could not load your calendars");
    } finally {
      setBusy(null);
    }
  };

  const patch = async (id: string, body: Record<string, string>, success: string) => {
    setBusy(`save:${id}`);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch(`/api/calendar/sync-connections/${encodeURIComponent(id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || "Could not save that change");
        return false;
      }
      replace(data.connection);
      setNotice(success);
      return true;
    } catch {
      setError("Could not save that change");
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
      const res = await fetch(`/api/calendar/sync-connections/${encodeURIComponent(c.id)}/sync`, { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || "Could not sync that calendar");
        return;
      }
      replace(data.connection);
      const r = data.result;
      if (r?.status === "ok") {
        const inCount = r.pulled.created + r.pulled.updated + r.pulled.deleted;
        const outCount = r.pushed.created + r.pushed.updated + r.pushed.deleted;
        setNotice(`Synced: ${inCount} change${inCount === 1 ? "" : "s"} in, ${outCount} out.`);
      } else if (r?.error) {
        setError(r.error);
      }
    } catch {
      setError("Could not sync that calendar");
    } finally {
      setBusy(null);
    }
  };

  const disconnect = async (c: Connection) => {
    if (
      !window.confirm(
        `Disconnect ${c.provider_label}${c.calendar_name ? ` (${c.calendar_name})` : ""}? Events imported from it will be removed from the family calendar. Your ${c.provider_label} calendar is not changed.`
      )
    )
      return;
    setBusy(`remove:${c.id}`);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch(`/api/calendar/sync-connections/${encodeURIComponent(c.id)}`, { method: "DELETE" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || "Could not disconnect that calendar");
        return;
      }
      setConnections((prev) => prev.filter((x) => x.id !== c.id));
      setNotice(`Disconnected ${c.provider_label}.`);
    } catch {
      setError("Could not disconnect that calendar");
    } finally {
      setBusy(null);
    }
  };

  if (!available) return null;

  const mineByProvider = new Set(connections.filter((c) => c.is_mine).map((c) => c.provider));
  const connectable = providers.filter((p) => !mineByProvider.has(p.id));

  return (
    <div id="calendar-sync" className="card" aria-labelledby="calendar-sync-heading">
      <div className="flex items-center mb-6">
        <div className="w-10 h-10 bg-emerald-100 rounded-lg flex items-center justify-center mr-4 shrink-0">
          <CalendarSync className="w-5 h-5 text-emerald-700" aria-hidden="true" />
        </div>
        <div>
          <h2 id="calendar-sync-heading" className="text-xl font-semibold text-gray-900">
            Connected calendars
          </h2>
          <p className="text-gray-600">
            Two-way sync with your own Google or Outlook calendar. Changes on either side show up on both.
          </p>
        </div>
      </div>

      {connections.length === 0 ? (
        <p className="text-sm text-gray-600 mb-4">No connected calendars yet.</p>
      ) : (
        <ul className="space-y-3 mb-6">
          {connections.map((c) => (
            <li key={c.id} className="rounded-lg border border-gray-200 p-3">
              <div className="min-w-0">
                <div className="font-medium text-gray-900 break-words">
                  {c.provider_label}
                  {c.calendar_name ? ` · ${c.calendar_name}` : ""}
                </div>
                {!c.is_mine && <div className="text-xs text-gray-600">Connected by {c.owner.name}</div>}
                <div
                  className={`text-xs mt-1 ${c.status === "error" || c.status === "reauth_required" ? "text-red-700" : "text-gray-600"}`}
                  role={c.status === "error" || c.status === "reauth_required" ? "status" : undefined}
                >
                  {c.status === "error" || c.status === "reauth_required" ? "Problem: " : ""}
                  {statusText(c)}
                </div>
                {c.conflicts_count > 0 && (
                  <div className="text-xs text-gray-600 mt-1">
                    {c.conflicts_count} edit conflict{c.conflicts_count === 1 ? "" : "s"} resolved (latest change kept).
                  </div>
                )}
              </div>

              {picking?.id === c.id && (
                <div className="mt-3 flex flex-wrap items-end gap-2">
                  <div className="flex-1 min-w-[12rem]">
                    <label htmlFor={`cal-pick-${c.id}`} className="block text-sm font-medium text-gray-900 mb-1">
                      Calendar to sync
                    </label>
                    {picking.calendars.length === 0 ? (
                      <p className="text-sm text-gray-600">No calendars you can edit were found.</p>
                    ) : (
                      <select
                        id={`cal-pick-${c.id}`}
                        className="input-field w-full min-h-[44px]"
                        value={picking.value}
                        onChange={(e) => setPicking({ ...picking, value: e.target.value })}
                      >
                        {picking.calendars.map((cal) => (
                          <option key={cal.id} value={cal.id}>
                            {cal.name}
                            {cal.primary ? " (main)" : ""}
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
                      if (await patch(c.id, { calendar_id: picking.value }, "Calendar saved. Syncing starts now.")) {
                        setPicking(null);
                        const saved = { ...c, calendar_id: picking.value };
                        await syncNow(saved);
                      }
                    }}
                  >
                    Save
                  </button>
                  <button type="button" className={BUTTON} onClick={() => setPicking(null)}>
                    Cancel
                  </button>
                </div>
              )}

              {c.is_mine && c.calendar_id && picking?.id !== c.id && (
                <fieldset className="mt-3">
                  <legend className="text-sm font-medium text-gray-900 mb-1">What goes to {c.provider_label}</legend>
                  <div className="flex flex-col gap-1">
                    {[
                      { value: "linked", label: "Only changes to events that came from this calendar" },
                      { value: "all", label: "Also add new family calendar events to this calendar" },
                    ].map((opt) => (
                      <label key={opt.value} className="inline-flex items-center gap-2 min-h-[44px] cursor-pointer">
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
                                ? "New family events will be added to this calendar."
                                : "Only events from this calendar will sync back."
                            )
                          }
                        />
                        <span className="text-sm text-gray-800">{opt.label}</span>
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
                    aria-label={`Sync ${c.provider_label} now`}
                  >
                    <RefreshCw
                      className={`w-4 h-4 mr-2 ${busy === `sync:${c.id}` ? "animate-spin motion-reduce:animate-none" : ""}`}
                      aria-hidden="true"
                    />
                    Sync now
                  </button>
                )}
                {c.is_mine && c.status === "reauth_required" && (
                  <button type="button" onClick={() => connect(c.provider)} disabled={busy !== null} className={BUTTON}>
                    <Link2 className="w-4 h-4 mr-2" aria-hidden="true" />
                    Reconnect
                  </button>
                )}
                {c.is_mine && picking?.id !== c.id && c.status !== "reauth_required" && (
                  <button
                    type="button"
                    onClick={() => openPicker(c)}
                    disabled={busy !== null}
                    className={BUTTON}
                    aria-label={`${c.calendar_id ? "Change" : "Choose"} calendar for ${c.provider_label}`}
                  >
                    {c.calendar_id ? "Change calendar" : "Choose calendar"}
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => disconnect(c)}
                  disabled={busy !== null}
                  className="inline-flex items-center min-h-[44px] px-3 rounded-lg border border-red-200 text-red-700 hover:bg-red-50 disabled:opacity-60"
                  aria-label={`Disconnect ${c.provider_label}`}
                >
                  <Unlink className="w-4 h-4 mr-2" aria-hidden="true" />
                  Disconnect
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
              {busy === `connect:${p.id}` ? "Opening…" : `Connect ${p.label}`}
            </button>
          ))}
        </div>
      )}
      <p className="text-xs text-gray-600 mt-3">
        Only the member who connected a calendar can change which calendar syncs. Disconnecting removes the app&apos;s access and
        the imported events here; nothing is deleted from your own calendar.
      </p>

      <div aria-live="polite" className="mt-3">
        {error && <p className="text-sm text-red-700">{error}</p>}
        {notice && <p className="text-sm text-green-700">{notice}</p>}
      </div>
    </div>
  );
}
