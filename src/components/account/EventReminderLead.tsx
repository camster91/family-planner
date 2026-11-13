"use client";

import { useEffect, useId, useState } from "react";
import { useTranslation } from "@/i18n";
import { notificationPreferencesMessages, type NotificationPreferencesMessage } from "@/i18n/notification-preferences";
import { useEventRemindersSupported } from "@/components/providers/event-reminders-provider";
import { REMINDER_LEAD_HOURS, isReminderLeadHours, type ReminderLeadHours } from "@/lib/event-reminder-constants";

const ENDPOINT = "/api/events/reminders";
const LABEL: Record<ReminderLeadHours, NotificationPreferencesMessage> = {
  2: "reminderLead2", 12: "reminderLead12", 24: "reminderLead24", 48: "reminderLead48", 168: "reminderLead168",
};

/**
 * "Remind me about events": how far ahead the signed-in person gets an inbox
 * reminder. Own setting only. Renders nothing, and asks the server nothing,
 * unless event reminders are on.
 */
export default function EventReminderLead() {
  const supported = useEventRemindersSupported();
  const { t } = useTranslation();
  const msg = (key: NotificationPreferencesMessage) => t(key, undefined, notificationPreferencesMessages);
  const id = useId();
  const [hours, setHours] = useState<ReminderLeadHours | null>(null);
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!supported) return;
    const controller = new AbortController();
    fetch(ENDPOINT, { cache: "no-store", signal: controller.signal })
      .then((response) => (response.ok ? response.json() : null))
      .then((body: { supported?: boolean; hours?: unknown } | null) => {
        if (!controller.signal.aborted && body?.supported === true && isReminderLeadHours(body.hours)) setHours(body.hours);
      })
      .catch(() => {});
    return () => controller.abort();
  }, [supported]);

  if (!supported || hours === null) return null;

  const choose = async (next: ReminderLeadHours) => {
    const previous = hours;
    setHours(next);
    setSaving(true);
    setFailed(false);
    try {
      const response = await fetch(ENDPOINT, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ hours: next }) });
      const body = response.ok ? await response.json() : null;
      if (!isReminderLeadHours(body?.hours)) throw new Error("save failed");
      setHours(body.hours);
    } catch {
      setHours(previous);
      setFailed(true);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div data-testid="event-reminder-lead" className="space-y-1 py-3">
      <label htmlFor={`${id}-lead`} className="block text-[15px] font-medium text-label-primary">{msg("reminderLeadLabel")}</label>
      <p id={`${id}-hint`} className="text-[14px] leading-snug text-label-secondary">{msg("reminderLeadHint")}</p>
      <select
        id={`${id}-lead`}
        className="input-apple min-h-[44px]"
        value={hours}
        disabled={saving}
        aria-describedby={`${id}-hint`}
        onChange={(event) => { const next = Number(event.target.value); if (isReminderLeadHours(next)) void choose(next); }}
      >
        {REMINDER_LEAD_HOURS.map((option) => <option key={option} value={option}>{msg(LABEL[option])}</option>)}
      </select>
      {failed && <p role="alert" className="text-[14px] text-[var(--danger-text,#b3261e)]">{msg("reminderLeadFailed")}</p>}
    </div>
  );
}
