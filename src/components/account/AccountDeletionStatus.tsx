/** Original account-dialog loading and retry presentation, shared with its chunk loader. */
export function AccountDeletionLoading() {
  return (
    <p role="status" className="text-[16px] text-label-secondary">
      Loading…
    </p>
  );
}

export function AccountDeletionFailure({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="space-y-4">
      <p role="alert" className="text-[16px] text-[var(--danger-text)]">
        Could not load your account details.
      </p>
      <button
        type="button"
        className="btn-tinted min-h-[44px] w-full"
        onClick={onRetry}
      >
        Try again
      </button>
    </div>
  );
}
