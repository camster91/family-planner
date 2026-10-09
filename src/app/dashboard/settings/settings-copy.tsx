"use client";
import { useTranslation } from "@/i18n";
import {
  settingsMessages,
  type SettingsMessage,
  type SettingsFeedback,
} from "@/i18n/settings";
export function useSettingsCopy() {
  const { t } = useTranslation();
  return (key: SettingsMessage, params?: Record<string, string | number>) =>
    t(key, params, settingsMessages);
}
/** Render semantic feedback without replacing state or replaying its originating action. */
export function SettingsText({ feedback }: { feedback: SettingsFeedback }) {
  const copy = useSettingsCopy();
  return (
    <>
      {"raw" in feedback ? feedback.raw : copy(feedback.key, feedback.params)}
    </>
  );
}

/** Use the canonical clock/description helper with scoped words; never duplicate its time policy. */
export function useCalendarSyncCopy(): import("@/lib/calendar-sync-status").CalendarSyncMessages {
  const copy = useSettingsCopy();
  return {
    relativeTime: {
      justNow: copy("justNow"),
      invalid: copy("aWhileAgo"),
      minutes: (n) => copy("minutesAgo", { count: n }),
      hours: (n) =>
        n === 1 ? copy("hourAgo") : copy("hoursAgo", { count: n }),
      yesterday: copy("yesterday"),
      days: (n) => copy("daysAgo", { count: n }),
    },
    waiting: (verb) =>
      copy(verb === "synced" ? "waitingSync" : "waitingRefresh"),
    last: (verb, time) =>
      copy(verb === "synced" ? "lastSynced" : "lastUpdated", { time }),
    tried: (message, time) => copy("lastTried", { message, time }),
  };
}
