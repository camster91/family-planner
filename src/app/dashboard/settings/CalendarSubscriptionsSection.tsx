"use client";

// Settings → Subscribed calendars (#232). Parents add, rename and remove
// read-only ICS subscriptions. The feed link is write-only: once saved, only a
// host hint comes back from the API.

import { useCallback, useEffect, useState } from "react";
import {
  CalendarPlus,
  RefreshCw,
  Trash2,
  Pencil,
  Check,
  X,
} from "lucide-react";

interface Subscription {
  id: string;
  name: string;
  color: string | null;
  url_hint?: string;
  last_fetched_at: string | null;
  last_status: string;
  last_error: string | null;
}

const COLORS: Array<{ value: string; label: string }> = [
  { value: "#2563eb", label: "Blue" },
  { value: "#16a34a", label: "Green" },
  { value: "#db2777", label: "Pink" },
  { value: "#ea580c", label: "Orange" },
  { value: "#7c3aed", label: "Purple" },
];

function statusText(sub: Subscription): string {
  if (sub.last_status === "error")
    return sub.last_error || "Last refresh failed";
  if (!sub.last_fetched_at) return "Waiting for first refresh";
  const minutes = Math.max(
    0,
    Math.round((Date.now() - new Date(sub.last_fetched_at).getTime()) / 60000),
  );
  const when =
    minutes < 1
      ? "just now"
      : minutes < 60
        ? `${minutes} min ago`
        : new Date(sub.last_fetched_at).toLocaleString();
  return sub.last_error
    ? `Updated ${when}. ${sub.last_error}`
    : `Updated ${when}`;
}

export default function CalendarSubscriptionsSection() {
  const [subs, setSubs] = useState<Subscription[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [color, setColor] = useState(COLORS[0].value);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(
    null,
  );

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/calendar/subscriptions");
      const data = await res.json().catch(() => ({}));
      if (res.ok && Array.isArray(data.subscriptions))
        setSubs(data.subscriptions);
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const replace = (sub: Subscription | null | undefined) => {
    if (!sub) return;
    setSubs((prev) => prev.map((s) => (s.id === sub.id ? sub : s)));
  };

  const refresh = async (id: string) => {
    setBusy(`refresh:${id}`);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch(
        `/api/calendar/subscriptions/${encodeURIComponent(id)}/refresh`,
        { method: "POST" },
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || "Could not refresh that calendar");
        return;
      }
      replace(data.subscription);
      if (data.result?.status === "ok") {
        setNotice(
          `Refreshed: ${data.result.created} new, ${data.result.updated} changed, ${data.result.deleted} removed.`,
        );
      } else if (data.result?.status === "not_modified") {
        setNotice("Already up to date.");
      }
    } catch {
      setError("Could not refresh that calendar");
    } finally {
      setBusy(null);
    }
  };

  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy("add");
    setError(null);
    setNotice(null);
    try {
      const res = await fetch("/api/calendar/subscriptions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), url: url.trim(), color }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || "Could not add that calendar");
        return;
      }
      setSubs((prev) => [...prev, data.subscription]);
      setName("");
      setUrl("");
      setBusy(null);
      await refresh(data.subscription.id);
    } catch {
      setError("Could not add that calendar");
    } finally {
      setBusy(null);
    }
  };

  const saveRename = async () => {
    if (!renaming) return;
    setBusy(`rename:${renaming.id}`);
    setError(null);
    try {
      const res = await fetch(
        `/api/calendar/subscriptions/${encodeURIComponent(renaming.id)}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: renaming.name.trim() }),
        },
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || "Could not rename that calendar");
        return;
      }
      replace(data.subscription);
      setRenaming(null);
    } catch {
      setError("Could not rename that calendar");
    } finally {
      setBusy(null);
    }
  };

  const remove = async (sub: Subscription) => {
    if (
      !window.confirm(
        `Remove "${sub.name}"? Its imported events will be removed from the family calendar.`,
      )
    )
      return;
    setBusy(`remove:${sub.id}`);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch(
        `/api/calendar/subscriptions/${encodeURIComponent(sub.id)}`,
        { method: "DELETE" },
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || "Could not remove that calendar");
        return;
      }
      setSubs((prev) => prev.filter((s) => s.id !== sub.id));
      setNotice(`Removed "${sub.name}".`);
    } catch {
      setError("Could not remove that calendar");
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="card" aria-labelledby="calendar-subscriptions-heading">
      <div className="flex items-center mb-6">
        <div className="w-10 h-10 bg-sky-100 rounded-lg flex items-center justify-center mr-4">
          <CalendarPlus className="w-5 h-5 text-sky-600" aria-hidden="true" />
        </div>
        <div>
          <h2
            id="calendar-subscriptions-heading"
            className="text-xl font-semibold text-gray-900"
          >
            Subscribed calendars
          </h2>
          <p className="text-gray-600">
            Show a school, team or work calendar here. Imported events are
            read-only.
          </p>
        </div>
      </div>

      {!loaded ? (
        <p className="text-sm text-gray-600">Loading…</p>
      ) : subs.length === 0 ? (
        <p className="text-sm text-gray-600 mb-4">
          No subscribed calendars yet.
        </p>
      ) : (
        <ul className="space-y-3 mb-6">
          {subs.map((sub) => (
            <li key={sub.id} className="rounded-lg border border-gray-200 p-3">
              <div className="flex flex-wrap items-start gap-3">
                <span
                  aria-hidden="true"
                  className="mt-1.5 inline-block h-3 w-3 shrink-0 rounded-full"
                  style={{ backgroundColor: sub.color ?? "#8e8e93" }}
                />
                <div className="min-w-0 flex-1">
                  {renaming?.id === sub.id ? (
                    <div className="flex flex-wrap items-center gap-2">
                      <label htmlFor={`rename-${sub.id}`} className="sr-only">
                        New name
                      </label>
                      <input
                        id={`rename-${sub.id}`}
                        value={renaming.name}
                        maxLength={60}
                        onChange={(e) =>
                          setRenaming({ id: sub.id, name: e.target.value })
                        }
                        className="input-field flex-1 min-w-[10rem]"
                      />
                      <button
                        type="button"
                        onClick={saveRename}
                        disabled={!renaming.name.trim() || busy !== null}
                        className="btn-primary inline-flex items-center min-h-[44px]"
                      >
                        <Check className="w-4 h-4 mr-1" aria-hidden="true" />{" "}
                        Save
                      </button>
                      <button
                        type="button"
                        onClick={() => setRenaming(null)}
                        className="inline-flex items-center min-h-[44px] px-3 rounded-lg border border-gray-300 text-gray-700"
                      >
                        <X className="w-4 h-4 mr-1" aria-hidden="true" /> Cancel
                      </button>
                    </div>
                  ) : (
                    <div className="font-medium text-gray-900 break-words">
                      {sub.name}
                    </div>
                  )}
                  {sub.url_hint && (
                    <div className="text-xs text-gray-500 break-all">
                      {sub.url_hint}
                    </div>
                  )}
                  <div
                    className={`text-xs mt-1 ${sub.last_status === "error" ? "text-red-700" : "text-gray-600"}`}
                    role={sub.last_status === "error" ? "status" : undefined}
                  >
                    {sub.last_status === "error" ? "Problem: " : ""}
                    {statusText(sub)}
                  </div>
                </div>
              </div>
              {renaming?.id !== sub.id && (
                <div className="flex flex-wrap gap-2 mt-3">
                  <button
                    type="button"
                    onClick={() => refresh(sub.id)}
                    disabled={busy !== null}
                    className="inline-flex items-center min-h-[44px] px-3 rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-50"
                    aria-label={`Refresh ${sub.name}`}
                  >
                    <RefreshCw
                      className={`w-4 h-4 mr-2 ${busy === `refresh:${sub.id}` ? "animate-spin motion-reduce:animate-none" : ""}`}
                      aria-hidden="true"
                    />
                    Refresh
                  </button>
                  <button
                    type="button"
                    onClick={() => setRenaming({ id: sub.id, name: sub.name })}
                    disabled={busy !== null}
                    className="inline-flex items-center min-h-[44px] px-3 rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-50"
                    aria-label={`Rename ${sub.name}`}
                  >
                    <Pencil className="w-4 h-4 mr-2" aria-hidden="true" />
                    Rename
                  </button>
                  <button
                    type="button"
                    onClick={() => remove(sub)}
                    disabled={busy !== null}
                    className="inline-flex items-center min-h-[44px] px-3 rounded-lg border border-red-200 text-red-700 hover:bg-red-50"
                    aria-label={`Remove ${sub.name}`}
                  >
                    <Trash2 className="w-4 h-4 mr-2" aria-hidden="true" />
                    Remove
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      <form onSubmit={add} className="space-y-3">
        <div>
          <label
            htmlFor="calendarSubName"
            className="block text-sm font-medium text-gray-900 mb-1"
          >
            Calendar name
          </label>
          <input
            id="calendarSubName"
            value={name}
            maxLength={60}
            onChange={(e) => setName(e.target.value)}
            className="input-field w-full"
            placeholder="e.g. School calendar"
          />
        </div>
        <div>
          <label
            htmlFor="calendarSubUrl"
            className="block text-sm font-medium text-gray-900 mb-1"
          >
            Calendar link (https:// or webcal://)
          </label>
          <input
            id="calendarSubUrl"
            type="url"
            inputMode="url"
            autoComplete="off"
            spellCheck={false}
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            className="input-field w-full font-mono text-xs"
            placeholder="webcal://example.com/calendar.ics"
            aria-describedby="calendarSubUrlHelp"
          />
          <p id="calendarSubUrlHelp" className="text-xs text-gray-500 mt-1">
            Treat this link like a password. After saving, only its website name
            is shown.
          </p>
        </div>
        <fieldset>
          <legend className="block text-sm font-medium text-gray-900 mb-1">
            Colour
          </legend>
          <div className="flex flex-wrap gap-2">
            {COLORS.map((c) => (
              <label
                key={c.value}
                className={`inline-flex items-center gap-2 min-h-[44px] px-3 rounded-lg border cursor-pointer ${
                  color === c.value ? "border-gray-900" : "border-gray-300"
                }`}
              >
                <input
                  type="radio"
                  name="calendarSubColor"
                  value={c.value}
                  checked={color === c.value}
                  onChange={() => setColor(c.value)}
                />
                <span
                  aria-hidden="true"
                  className="inline-block h-3 w-3 rounded-full"
                  style={{ backgroundColor: c.value }}
                />
                {c.label}
              </label>
            ))}
          </div>
        </fieldset>
        <button
          type="submit"
          disabled={busy !== null || !name.trim() || !url.trim()}
          className="btn-primary inline-flex items-center min-h-[44px]"
        >
          <CalendarPlus className="w-4 h-4 mr-2" aria-hidden="true" />
          {busy === "add" ? "Adding…" : "Add calendar"}
        </button>
      </form>

      <div aria-live="polite" className="mt-3">
        {error && <p className="text-sm text-red-700">{error}</p>}
        {notice && <p className="text-sm text-green-700">{notice}</p>}
      </div>
    </div>
  );
}
