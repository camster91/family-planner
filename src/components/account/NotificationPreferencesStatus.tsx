/** Existing preference loading/retry UI, shared by module and API loading. */
export function NotificationPreferencesLoading() {
  return (
    <p className="py-3 text-[15px] text-label-secondary" role="status">
      Loading your notification settings…
    </p>
  );
}

export function NotificationPreferencesFailure({
  onRetry,
}: {
  onRetry: () => void;
}) {
  return (
    <div className="py-2">
      <p role="alert" className="text-[15px] text-label-primary">
        Couldn&apos;t load your notification settings.
      </p>
      <button
        type="button"
        onClick={onRetry}
        className="mt-2 inline-flex min-h-[44px] items-center rounded-full bg-[var(--surface-fill)] px-4 text-[15px] font-medium text-label-primary focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-[var(--accent-text)]"
      >
        Try again
      </button>
    </div>
  );
}
