"use client";
import { useTranslation } from "@/i18n";
import {
  accountDeletionStatusMessages,
  type AccountDeletionStatusMessage,
} from "@/i18n/account-deletion-status";
/** Original account-dialog loading and retry presentation, shared with its chunk loader. */
export function AccountDeletionLoading() {
  const { t } = useTranslation();
  const msg = (key: AccountDeletionStatusMessage) =>
    t(key, undefined, accountDeletionStatusMessages);
  return (
    <p role="status" className="text-[16px] text-label-secondary">
      {msg("loading")}
    </p>
  );
}

export function AccountDeletionFailure({ onRetry }: { onRetry: () => void }) {
  const { t } = useTranslation();
  const msg = (key: AccountDeletionStatusMessage) =>
    t(key, undefined, accountDeletionStatusMessages);
  return (
    <div className="space-y-4">
      <p role="alert" className="text-[16px] text-[var(--danger-text)]">
        {msg("loadFailed")}
      </p>
      <button
        type="button"
        className="btn-tinted min-h-[44px] w-full"
        onClick={onRetry}
      >
        {msg("retry")}
      </button>
    </div>
  );
}
