"use client";

import * as React from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

// One active modal owns keyboard handling. Ancestors register below children
// even when React runs child effects first (including StrictMode remounts).
const openPanels: Array<{ panel: HTMLElement; previous: HTMLElement | null }> =
  [];

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Modal dialog: `role="dialog"`, `aria-modal`, labelled by its title, focus
 * moved in on open and restored on close, Tab kept inside, Escape closes when
 * `onClose` is given. Motion only when the viewer allows it.
 */
export function Dialog({
  open,
  onClose,
  title,
  description,
  children,
  className,
  testId,
  initialFocusRef,
  role = "dialog",
}: {
  open: boolean;
  /** Omit to make the dialog non-dismissible (no close button, no Escape). */
  onClose?: () => void;
  title: string;
  description?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  testId?: string;
  initialFocusRef?: React.RefObject<HTMLElement | null>;
  /** `alertdialog` for confirmations that interrupt (delete, discard). */
  role?: "dialog" | "alertdialog";
}) {
  const panelRef = React.useRef<HTMLDivElement>(null);
  const titleId = React.useId();
  const descId = React.useId();
  const onCloseRef = React.useRef(onClose);
  onCloseRef.current = onClose;

  React.useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    const panel = panelRef.current;
    if (!panel) return;
    const descendant = openPanels.findIndex((other) =>
      panel.contains(other.panel),
    );
    // An initially-open child may already have moved focus before its parent's
    // effect runs. Preserve the original outside opener for that parent.
    const entry = {
      panel,
      previous:
        descendant >= 0 && previous && panel.contains(previous)
          ? openPanels[descendant].previous
          : previous,
    };
    openPanels.splice(
      descendant < 0 ? openPanels.length : descendant,
      0,
      entry,
    );
    const isTopmost = () => openPanels[openPanels.length - 1] === entry;
    const first =
      initialFocusRef?.current ??
      panel.querySelector<HTMLElement>(FOCUSABLE) ??
      panel;
    if (isTopmost()) first.focus();

    const onKey = (e: KeyboardEvent) => {
      if (!isTopmost() || e.defaultPrevented) return;
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        onCloseRef.current?.();
        return;
      }
      if (e.key !== "Tab" || !panel) return;
      const items = Array.from(
        panel.querySelectorAll<HTMLElement>(FOCUSABLE),
      ).filter((el) => el.offsetParent !== null);
      if (items.length === 0) {
        e.preventDefault();
        return;
      }
      const firstItem = items[0];
      const lastItem = items[items.length - 1];
      if (e.shiftKey && document.activeElement === firstItem) {
        e.preventDefault();
        lastItem.focus();
      } else if (!e.shiftKey && document.activeElement === lastItem) {
        e.preventDefault();
        firstItem.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      const wasTopmost = isTopmost();
      openPanels.splice(openPanels.indexOf(entry), 1);
      // If an ancestor closes too, hand its opener to surviving descendants
      // rather than restoring focus to a now-detached control in that ancestor.
      for (const other of openPanels) {
        if (other.previous && panel.contains(other.previous))
          other.previous = entry.previous;
      }
      if (!wasTopmost) return;
      const remaining = openPanels
        .filter((other) => other.panel.isConnected)
        .at(-1)?.panel;
      const restore = entry.previous;
      if (restore?.isConnected && (!remaining || remaining.contains(restore))) {
        restore.focus();
      } else if (remaining) {
        (remaining.querySelector<HTMLElement>(FOCUSABLE) ?? remaining).focus();
      }
    };
    // Focus is managed once per opening.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[80] flex items-end justify-center bg-black/50 p-0 sm:items-center sm:p-4">
      <div
        ref={panelRef}
        role={role}
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descId : undefined}
        tabIndex={-1}
        data-testid={testId}
        className={cn(
          "max-h-[100dvh] w-full overflow-y-auto rounded-t-[var(--radius-2xl)] bg-[var(--surface-elevated)] p-6 shadow-[var(--shadow-lg)] outline-none sm:max-w-lg sm:rounded-[var(--radius-2xl)]",
          "motion-safe:animate-spring-in",
          className,
        )}
      >
        <div className="mb-4 flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h2
              id={titleId}
              className="text-[22px] font-bold leading-tight text-label-primary"
            >
              {title}
            </h2>
            {description && (
              <div
                id={descId}
                className="mt-1 text-[16px] leading-snug text-label-secondary"
              >
                {description}
              </div>
            )}
          </div>
          {onClose && (
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="-mr-2 -mt-2 inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-label-secondary hover:bg-[var(--surface-fill)] focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-[var(--accent-text)]"
            >
              <X className="h-5 w-5" aria-hidden="true" />
            </button>
          )}
        </div>
        {children}
      </div>
    </div>
  );
}
