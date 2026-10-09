"use client";
import { useTranslation } from "@/i18n";
import {
  notificationPreferencesStatusMessages,
  type NotificationPreferencesStatusMessage,
} from "@/i18n/notification-preferences-status";
/** Existing preference loading/retry UI, shared by module and API loading. */
export function NotificationPreferencesLoading() {
  const { t } = useTranslation();
  const msg = (key: NotificationPreferencesStatusMessage) =>
    t(key, undefined, notificationPreferencesStatusMessages);
  return (
    <p className="py-3 text-[15px] text-label-secondary" role="status">
      {msg("loading")}
    </p>
  );
}

export function NotificationPreferencesFailure({
  onRetry,
}: {
  onRetry: () => void;
}) {
  const { t } = useTranslation();
  const msg = (key: NotificationPreferencesStatusMessage) =>
    t(key, undefined, notificationPreferencesStatusMessages);
  return (
    <div className="py-2">
      <p role="alert" className="text-[15px] text-label-primary">
        {msg("loadFailed")}
      </p>
      <button
        type="button"
        onClick={onRetry}
        className="mt-2 inline-flex min-h-[44px] items-center rounded-full bg-[var(--surface-fill)] px-4 text-[15px] font-medium text-label-primary focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-[var(--accent-text)]"
      >
        {msg("retry")}
      </button>
    </div>
  );
}
