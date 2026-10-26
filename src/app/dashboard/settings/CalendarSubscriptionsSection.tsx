"use client";

// Settings → Subscribed calendars (#232). Parents add, rename and remove
// read-only ICS subscriptions. The feed link is write-only: once saved, only a
// host hint comes back from the API.

import { useCallback, useEffect, useRef, useState } from "react";
import CalendarRemovalDialog, {
  focusCalendarSection,
} from "./CalendarRemovalDialog";
import SettingsDisclosure from "./SettingsDisclosure";
import SettingsIcon from "./SettingsIcon";
import {
  useSettingsCopy,
  useCalendarSyncCopy,
  SettingsText,
} from "./settings-copy";
import {
  settingsFeedback,
  type SettingsFeedback,
  type SettingsMessage,
} from "@/i18n/settings";
import {
  CalendarPlus,
  RefreshCw,
  Trash2,
  Pencil,
  Check,
  X,
} from "lucide-react";
import { calendarSubscriptionFeedback } from "@/i18n/calendar-subscription-feedback";
import { requestOwnedJson } from "@/lib/owned-request-http";
import { MAX_SUBSCRIPTIONS_PER_FAMILY, readCalendarSubscriptionList } from "@/lib/calendar-subscription-list";
import { describeCalendarSync } from "@/lib/calendar-sync-status";
import { useNow } from "@/components/fridge/sync-status";

// Canonical protocol example stays literal in ordinary and expanded copy.
const SUBSCRIPTION_URL_EXAMPLE = "webcal://example.com/calendar.ics";

type Subscription = import("@/lib/calendar-subscription-list").CalendarSubscriptionSummary;

const COLORS: Array<{ value: string; label: SettingsMessage }> = [
  { value: "#2563eb", label: "blue" },
  { value: "#16a34a", label: "green" },
  { value: "#db2777", label: "pink" },
  { value: "#ea580c", label: "orange" },
  { value: "#7c3aed", label: "purple" },
];

/** Last refresh and any problem, in words (#271). */
function statusText(
  sub: Subscription,
  now: number,
  messages: import("@/lib/calendar-sync-status").CalendarSyncMessages,
  fallback: string,
  copy: (key: SettingsMessage, params?: Record<string, string | number>) => string,
): string {
  const issue = sub.last_error ? calendarSubscriptionFeedback(sub.last_error, sub.last_status === "error" ? "refreshLastFailed" : "calendarStatusNote") : null;
  return describeCalendarSync({
    lastAttemptAt: sub.last_fetched_at,
    failed: sub.last_status === "error",
    error: issue ? copy(issue.key, issue.params) : null,
    now,
    verb: "updated",
    failedFallback: fallback,
    messages,
  }).text;
}

export default function CalendarSubscriptionsSection() {
  const copy = useSettingsCopy();
  const syncCopy = useCalendarSyncCopy();
  const [subs, setSubs] = useState<Subscription[]>([]);
  // Keeps "Last updated 3 min ago" current (#271).
  const now = useNow(30 * 1000) ?? Date.now();
  const [loaded, setLoaded] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const loadInFlight = useRef(false);
  const live = useRef(true);
  const loadEpoch = useRef(0);
  const readController = useRef<AbortController | null>(null);
  const writeBusy = useRef(false);
  const writeEpoch = useRef(0);
  const writeController = useRef<AbortController | null>(null);
  const writeHeldRef = useRef(false);
  const [writeHeld, setWriteHeld] = useState(false);
  const [accessHeld, setAccessHeld] = useState(false);
  // Mounted-only recovery evidence; never store a private calendar URL in logs.
  const pendingWrite = useRef<{ path: string; method: string; body?: string } | null>(null);
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [color, setColor] = useState(COLORS[0].value);
  const [removing, setRemoving] = useState<Subscription | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<SettingsFeedback | null>(null);
  const [notice, setNotice] = useState<SettingsFeedback | null>(null);
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(
    null,
  );

  const load = useCallback(async () => {
    if (!live.current || loadInFlight.current || writeBusy.current) return;
    loadInFlight.current = true;
    const epoch = ++loadEpoch.current;
    const controller = new AbortController();
    readController.current = controller;
    const current = () => live.current && loadEpoch.current === epoch;
    setLoaded(false);
    setLoadFailed(false);
    try {
      const result = await requestOwnedJson("/api/calendar/subscriptions", { signal: controller.signal }, 128 * 1024);
      if (!current()) return;
      if (result.kind === "reply") {
        const code = result.body && typeof result.body === "object" ? (result.body as Record<string, unknown>).code : null;
        if ([401, 403].includes(result.response.status) || code === "CALENDAR_SUBSCRIPTION_ACCESS_CHANGED" || code === "CALENDAR_SUBSCRIPTION_ACCESS_UNCONFIRMED") setAccessHeld(true);
      }
      const subscriptions = result.kind === "reply" && result.response.ok
        ? readCalendarSubscriptionList(result.body) : null;
      if (!subscriptions) throw new Error("Subscription list unavailable");
      setSubs(subscriptions);
    } catch {
      // A failed read is not evidence that the household has no calendars.
      // Store semantic state so a mounted language change needs no new read.
      if (current()) setLoadFailed(true);
    } finally {
      if (current()) {
        readController.current = null;
        loadInFlight.current = false;
        setLoaded(true);
      }
    }
  }, []);

  useEffect(() => {
    live.current = true;
    void load();
    return () => {
      live.current = false;
      loadEpoch.current++;
      readController.current?.abort();
      readController.current = null;
      loadInFlight.current = false;
      writeEpoch.current++;
      writeController.current?.abort();
      writeController.current = null;
      writeBusy.current = false;
    };
  }, [load]);

  const replace = (sub: Subscription) => {
    setSubs((prev) => prev.map((s) => (s.id === sub.id ? sub : s)));
  };

  const beginWrite = (action: string, packet: { path: string; method: string; body?: string }) => {
    if (!live.current || writeBusy.current || loadInFlight.current || writeHeldRef.current || !loaded || loadFailed) return null;
    writeBusy.current = true;
    const epoch = ++writeEpoch.current;
    const controller = new AbortController();
    writeController.current = controller;
    pendingWrite.current = { ...packet };
    setBusy(action); setError(null); setNotice(null);
    return { epoch, controller, packet };
  };
  type Write = NonNullable<ReturnType<typeof beginWrite>>;
  const currentWrite = (run: Write) => live.current && writeEpoch.current === run.epoch;
  const finishWrite = (run: Write) => {
    if (!currentWrite(run)) return;
    writeController.current = null; writeBusy.current = false; setBusy(null);
  };
  const holdWrite = () => {
    writeHeldRef.current = true; setWriteHeld(true); setRemoving(null);
    setError(settingsFeedback("calendarWriteUnconfirmed"));
  };
  const sendWrite = async (run: Write, fallback: SettingsMessage): Promise<Record<string, unknown> | null> => {
    const result = await requestOwnedJson(run.packet.path, {
      method: run.packet.method, signal: run.controller.signal,
      ...(run.packet.body !== undefined ? { headers: { "Content-Type": "application/json" }, body: run.packet.body } : {}),
    }, 128 * 1024);
    if (!currentWrite(run)) return null;
    if (result.kind !== "reply") { holdWrite(); return null; }
    const data = result.body && typeof result.body === "object" && !Array.isArray(result.body)
      ? result.body as Record<string, unknown> : null;
    if (!result.response.ok) {
      if ([401, 403].includes(result.response.status) || data?.code === "CALENDAR_SUBSCRIPTION_ACCESS_CHANGED" || data?.code === "CALENDAR_SUBSCRIPTION_ACCESS_UNCONFIRMED") setAccessHeld(true);
      if (result.response.status >= 500 || [401, 403, 408, 409, 425, 429].includes(result.response.status)) holdWrite();
      else { pendingWrite.current = null; setError(calendarSubscriptionFeedback(data?.error, fallback)); }
      return null;
    }
    if (!data) { holdWrite(); return null; }
    return data;
  };
  const summary = (value: unknown, id?: string) => {
    const row = readCalendarSubscriptionList({ subscriptions: [value] })?.[0];
    return row && (id === undefined || row.id === id) ? row : null;
  };

  const refresh = async (id: string) => {
    const run = beginWrite(`refresh:${id}`, { path: `/api/calendar/subscriptions/${encodeURIComponent(id)}/refresh`, method: "POST" });
    if (!run) return;
    try {
      const data = await sendWrite(run, "refreshFailed");
      if (!data) return;
      const sub = summary(data.subscription, id);
      const result = data.result && typeof data.result === "object" ? data.result as Record<string, unknown> : null;
      if (!sub || !result || typeof result.status !== "string" || !["ok", "not_modified", "error"].includes(result.status)
        || ["created", "updated", "deleted"].some(key => !Number.isSafeInteger(result[key]) || (result[key] as number) < 0)) { holdWrite(); return; }
      replace(sub); pendingWrite.current = null;
      if (result.status === "ok") setNotice(settingsFeedback("refreshedCounts", {
        created: result.created as number, updated: result.updated as number, deleted: result.deleted as number,
      }));
      else if (result.status === "not_modified") setNotice(settingsFeedback("upToDate"));
      else setError(settingsFeedback("refreshFailed"));
    } finally { finishWrite(run); }
  };

  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!live.current || writeBusy.current || writeHeldRef.current || loadInFlight.current || !loaded || loadFailed) return;
    const input = { name: name.trim(), url: url.trim(), color };
    if (!input.name || !input.url) return;
    if (subs.length >= MAX_SUBSCRIPTIONS_PER_FAMILY) { setError(settingsFeedback("calendarSubscriptionLimit")); return; }
    const run = beginWrite("add", { path: "/api/calendar/subscriptions", method: "POST", body: JSON.stringify(input) });
    if (!run) return;
    try {
      const data = await sendWrite(run, "addCalendarFailed");
      if (!data) return;
      const sub = summary(data.subscription);
      if (!sub || sub.name !== input.name || sub.color !== input.color || subs.some(row => row.id === sub.id)) { holdWrite(); return; }
      setSubs((prev) => [...prev, sub]); pendingWrite.current = null;
      setName(""); setUrl("");
      finishWrite(run);
      await refresh(sub.id);
    } finally { finishWrite(run); }
  };

  const saveRename = async () => {
    if (!renaming?.name.trim()) return;
    const original = { ...renaming, name: renaming.name.trim() };
    const run = beginWrite(`rename:${original.id}`, { path: `/api/calendar/subscriptions/${encodeURIComponent(original.id)}`, method: "PATCH", body: JSON.stringify({ name: original.name }) });
    if (!run) return;
    try {
      const data = await sendWrite(run, "renameFailed");
      if (!data) return;
      const sub = summary(data.subscription, original.id);
      if (!sub || sub.name !== original.name) { holdWrite(); return; }
      replace(sub); pendingWrite.current = null; setRenaming(null);
    } finally { finishWrite(run); }
  };

  const remove = async (sub: Subscription) => {
    const run = beginWrite(`remove:${sub.id}`, { path: `/api/calendar/subscriptions/${encodeURIComponent(sub.id)}`, method: "DELETE" });
    if (!run) return;
    try {
      const data = await sendWrite(run, "removeCalendarFailed");
      if (!data) return;
      if (data.success !== true || !Number.isSafeInteger(data.removedEvents) || (data.removedEvents as number) < 0) { holdWrite(); return; }
      pendingWrite.current = null; setSubs((prev) => prev.filter((s) => s.id !== sub.id)); setRemoving(null);
      focusCalendarSection("calendar-subscriptions-heading");
      setNotice(settingsFeedback("removedSubscription", { name: sub.name }));
    } finally { finishWrite(run); }
  };

  return (
    <SettingsDisclosure
      id="calendar-subscriptions"
      headingId="calendar-subscriptions-heading"
      title={copy("subscriptions")}
      description={copy("subscriptionsDescription")}
      icon={<SettingsIcon icon={CalendarPlus} tone="sky" />}
    >
      <p className="text-sm text-muted-foreground mb-4">{copy("readOnly")}</p>
      {writeHeld && <div role="alert" className="mb-4 space-y-3">
        <p className="text-sm text-danger-text">{copy("calendarWriteUnconfirmed")}</p>
        <button type="button" className="btn-secondary min-h-[44px]" disabled={!loaded || busy !== null} onClick={() => void load()}>{copy("checkSubscriptions")}</button>
      </div>}

      {!accessHeld && <>
      {loaded && !loadFailed && <p id="calendar-subscription-capacity" role="status" className="mb-3 text-sm text-label-secondary">
        {subs.length >= MAX_SUBSCRIPTIONS_PER_FAMILY
          ? copy("calendarSubscriptionCapacityFull", { limit: MAX_SUBSCRIPTIONS_PER_FAMILY })
          : copy("calendarSubscriptionCapacity", { count: subs.length, limit: MAX_SUBSCRIPTIONS_PER_FAMILY })}
      </p>}
      {!loaded ? (
        <p className="text-sm text-muted-foreground">
          {copy("loadingEllipsis")}
        </p>
      ) : loadFailed ? (
        <div className="mb-4 space-y-3">
          <p role="alert" className="text-sm text-danger-text">
            {copy("subscriptionsLoadFailed")}
          </p>
          <button
            type="button"
            className="btn-secondary min-h-[44px]"
            onClick={() => void load()}
          >
            {copy("retrySubscriptions")}
          </button>
        </div>
      ) : subs.length === 0 ? (
        <p className="text-sm text-muted-foreground mb-4">
          {copy("noSubscriptions")}
        </p>
      ) : (
        <ul className="space-y-3 mb-6">
          {subs.map((sub) => (
            <li key={sub.id} className="rounded-lg border border-border p-3">
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
                        {copy("newName")}
                      </label>
                      <input
                        id={`rename-${sub.id}`}
                        disabled={busy !== null || writeHeld}
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
                        disabled={!renaming.name.trim() || busy !== null || writeHeld}
                        className="btn-primary inline-flex items-center min-h-[44px]"
                      >
                        <Check className="w-4 h-4 mr-1" aria-hidden="true" />{" "}
                        {copy("save")}
                      </button>
                      <button
                        type="button"
                        disabled={busy !== null || writeHeld}
                        onClick={() => setRenaming(null)}
                        className="inline-flex items-center min-h-[44px] px-3 rounded-lg border border-input text-foreground"
                      >
                        <X className="w-4 h-4 mr-1" aria-hidden="true" />{" "}
                        {copy("cancel")}
                      </button>
                    </div>
                  ) : (
                    <div className="font-medium text-foreground break-words">
                      {sub.name}
                    </div>
                  )}
                  {sub.url_hint && (
                    <div className="text-xs text-label-tertiary break-all">
                      {sub.url_hint === "Unavailable" ? copy("calendarHintUnavailable") : sub.url_hint}
                    </div>
                  )}
                  <div
                    className={`text-xs mt-1 ${sub.last_status === "error" ? "text-danger-text" : "text-muted-foreground"}`}
                    role={sub.last_status === "error" ? "status" : undefined}
                  >
                    {sub.last_status === "error" ? copy("problem") : ""}
                    {statusText(sub, now, syncCopy, copy("refreshLastFailed"), copy)}
                  </div>
                </div>
              </div>
              {renaming?.id !== sub.id && (
                <div className="flex flex-wrap gap-2 mt-3">
                  <button
                    type="button"
                    onClick={() => refresh(sub.id)}
                    disabled={busy !== null || writeHeld}
                    className="inline-flex items-center min-h-[44px] px-3 rounded-lg border border-input text-foreground hover:bg-muted"
                    aria-label={copy("refreshLabel", { name: sub.name })}
                  >
                    <RefreshCw
                      className={`w-4 h-4 mr-2 ${busy === `refresh:${sub.id}` ? "animate-spin motion-reduce:animate-none" : ""}`}
                      aria-hidden="true"
                    />
                    {copy("refresh")}
                  </button>
                  <button
                    type="button"
                    onClick={() => setRenaming({ id: sub.id, name: sub.name })}
                    disabled={busy !== null || writeHeld}
                    className="inline-flex items-center min-h-[44px] px-3 rounded-lg border border-input text-foreground hover:bg-muted"
                    aria-label={copy("renameLabel", { name: sub.name })}
                  >
                    <Pencil className="w-4 h-4 mr-2" aria-hidden="true" />
                    {copy("rename")}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setError(null);
                      setRemoving(sub);
                    }}
                    disabled={busy !== null || writeHeld}
                    className="inline-flex items-center min-h-[44px] px-3 rounded-lg border border-[var(--danger-tint)] text-danger-text hover:bg-[var(--danger-tint)]"
                    aria-label={copy("removeLabel", { name: sub.name })}
                  >
                    <Trash2 className="w-4 h-4 mr-2" aria-hidden="true" />
                    {copy("remove")}
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      <form onSubmit={add} className="space-y-3">
        <fieldset disabled={busy !== null || writeHeld} className="space-y-4">
        <div>
          <label
            htmlFor="calendarSubName"
            className="block text-sm font-medium text-foreground mb-1"
          >
            {copy("calendarName")}
          </label>
          <input
            id="calendarSubName"
            value={name}
            maxLength={60}
            onChange={(e) => setName(e.target.value)}
            className="input-field w-full"
            placeholder={copy("calendarExample")}
          />
        </div>
        <div>
          <label
            htmlFor="calendarSubUrl"
            className="block text-sm font-medium text-foreground mb-1"
          >
            {copy("calendarLink")}
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
            placeholder={SUBSCRIPTION_URL_EXAMPLE}
            aria-describedby="calendarSubUrlHelp"
          />
          <p
            id="calendarSubUrlHelp"
            className="text-xs text-label-tertiary mt-1"
          >
            {copy("calendarLinkPrivacy")}
          </p>
        </div>
        <details className="rounded-lg border border-border px-3">
          <summary className="min-h-[44px] cursor-pointer py-3 text-sm font-medium">
            {copy("calendarColourSummary", { colour: copy(COLORS.find(option => option.value === color)?.label ?? "blue") })}
          </summary>
        <fieldset>
          <legend className="block text-sm font-medium text-foreground mb-1">
            {copy("colour")}
          </legend>
          <div className="flex flex-wrap gap-2">
            {COLORS.map((c) => (
              <label
                key={c.value}
                className={`inline-flex items-center gap-2 min-h-[44px] px-3 rounded-lg border cursor-pointer ${
                  color === c.value ? "border-foreground" : "border-input"
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
                {copy(c.label)}
              </label>
            ))}
          </div>
        </fieldset>
        </details>
        <button
          type="submit"
          disabled={
            !loaded ||
            loadFailed ||
            busy !== null || writeHeld ||
            subs.length >= MAX_SUBSCRIPTIONS_PER_FAMILY ||
            !name.trim() ||
            !url.trim()
          }
          className="btn-primary inline-flex items-center min-h-[44px]"
          aria-describedby={loaded && !loadFailed ? "calendar-subscription-capacity" : undefined}
        >
          <CalendarPlus className="w-4 h-4 mr-2" aria-hidden="true" />
          {busy === "add" ? copy("adding") : copy("addCalendar")}
        </button>
        </fieldset>
      </form>
      </>}

      <div aria-live="polite" className="mt-3">
        {error && !removing && !writeHeld && (
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
      {removing && (
        <CalendarRemovalDialog
          title={copy("removeLabel", { name: removing.name })}
          description={copy("removeSubscriptionConfirm", {
            name: removing.name,
          })}
          action={copy("remove")}
          busy={busy !== null}
          error={error}
          onCancel={() => {
            setRemoving(null);
            setError(null);
          }}
          onConfirm={() => void remove(removing)}
        />
      )}
    </SettingsDisclosure>
  );
}
