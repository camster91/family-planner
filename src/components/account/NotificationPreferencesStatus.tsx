"use client";
import { useTranslation } from "@/i18n";
import { notificationPreferencesMessages } from "@/i18n/notification-preferences";
/** Existing preference loading/retry UI, shared by module and API loading. */
export function NotificationPreferencesLoading() {
  const { t } = useTranslation();
  return (
    <p className="py-3 text-[15px] text-label-secondary" role="status">
      {t("loading", undefined, notificationPreferencesMessages)}
    </p>
  );
}

export function NotificationPreferencesFailure({
  onRetry,
}: {
  onRetry: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="py-2">
      <p role="alert" className="text-[15px] text-label-primary">
        {t("loadFailed", undefined, notificationPreferencesMessages)}
      </p>
      <button
        type="button"
        onClick={onRetry}
        className="mt-2 inline-flex min-h-[44px] items-center rounded-full bg-[var(--surface-fill)] px-4 text-[15px] font-medium text-label-primary focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-[var(--accent-text)]"
      >
        {t("retry", undefined, notificationPreferencesMessages)}
      </button>
    </div>
  );
}
