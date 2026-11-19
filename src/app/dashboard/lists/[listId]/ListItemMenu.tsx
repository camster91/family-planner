"use client";

import * as React from "react";
import { MoreHorizontal } from "lucide-react";
import { cn } from "@/lib/utils";

export interface ListItemAction {
  key: string;
  /** Visible text ("Edit", "Move to section", "Delete"). */
  label: string;
  /** Accessible name naming the item ("Edit Milk"). */
  ariaLabel: string;
  onSelect: () => void;
  disabled?: boolean;
  danger?: boolean;
  /** The action opens a dialog. */
  dialog?: boolean;
  testId?: string;
}

/**
 * The "•••" button at the end of a list row. It shows and hides the row's
 * actions in a panel under the row (see ListItemActions), so the item name
 * keeps the row's full width. A panel, not a floating popup, because rows sit
 * in clipped, swipeable containers.
 */
export const ListItemMoreButton = React.forwardRef<
  HTMLButtonElement,
  {
    label: string;
    open: boolean;
    controls: string;
    onToggle: () => void;
  }
>(function ListItemMoreButton({ label, open, controls, onToggle }, ref) {
  return (
    <button
      ref={ref}
      type="button"
      aria-label={label}
      aria-expanded={open}
      aria-controls={open ? controls : undefined}
      onPointerDown={(event) => event.stopPropagation()}
      onClick={onToggle}
      data-testid="list-item-more"
      className={cn(
        "flex min-h-[44px] min-w-[44px] shrink-0 items-center justify-center self-center rounded-full text-label-secondary",
        "active:bg-[var(--surface-fill-secondary)] focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-[var(--accent-text)]",
        open && "bg-[var(--surface-fill-secondary)]",
      )}
    >
      <MoreHorizontal className="h-5 w-5" aria-hidden="true" />
    </button>
  );
});

/** The open row's actions; Escape closes them and returns focus to "•••". */
export function ListItemActions({
  id,
  label,
  actions,
  onClose,
}: {
  id: string;
  label: string;
  actions: ListItemAction[];
  onClose: (restoreFocus: boolean) => void;
}) {
  const ref = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    ref.current
      ?.querySelector<HTMLButtonElement>("button:not(:disabled)")
      ?.focus();
  }, []);
  return (
    <div
      ref={ref}
      id={id}
      role="group"
      aria-label={label}
      data-testid="list-item-actions"
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.stopPropagation();
          onClose(true);
        }
      }}
      className="flex flex-wrap gap-2 px-4 pb-3"
    >
      {actions.map((action) => (
        <button
          key={action.key}
          type="button"
          disabled={action.disabled}
          aria-label={action.ariaLabel}
          aria-haspopup={action.dialog ? "dialog" : undefined}
          data-testid={action.testId}
          onPointerDown={(event) => event.stopPropagation()}
          onClick={() => {
            // A dialog returns focus to what was focused when it opened, so
            // hand focus back to "•••" first (this panel is about to go).
            onClose(Boolean(action.dialog));
            action.onSelect();
          }}
          className={cn(
            "btn-tinted min-h-[44px] px-4 disabled:opacity-40",
            action.danger && "text-danger-text",
          )}
        >
          {action.label}
        </button>
      ))}
    </div>
  );
}
