import type { ReactNode } from "react";

/** Native disclosure keeps mounted form state and exposes keyboard controls. */
export function ChoreFormSection({
  title,
  summary,
  children,
}: {
  title: string;
  summary: string;
  children: ReactNode;
}) {
  return (
    <details
      className="rounded-[var(--radius-lg)] border border-[var(--surface-separator)] bg-[var(--surface-elevated)]"
      onInvalidCapture={(event) => {
        event.currentTarget.open = true;
      }}
    >
      <summary className="min-h-[44px] cursor-pointer px-4 py-3 text-body text-label-primary [overflow-wrap:anywhere] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)]">
        <span className="font-semibold">{title}</span>
        <span className="block text-footnote text-label-secondary mt-1">
          {summary}
        </span>
      </summary>
      <div className="px-4 pb-4 space-y-5">{children}</div>
    </details>
  );
}
