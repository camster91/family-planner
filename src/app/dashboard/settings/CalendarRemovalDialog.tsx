"use client";
import { useRef } from "react";
import { Dialog } from "@/components/ui/dialog";
import { SettingsText, useSettingsCopy } from "./settings-copy";
import type { SettingsFeedback } from "@/i18n/settings";
/** Shared confirmation and failure recovery for calendar removal. */
export default function CalendarRemovalDialog({
  title,
  description,
  action,
  busy,
  error,
  onCancel,
  onConfirm,
}: {
  title: string;
  description: string;
  action: string;
  busy: boolean;
  error: SettingsFeedback | null;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const copy = useSettingsCopy();
  const cancelRef = useRef<HTMLButtonElement>(null);
  return (
    <Dialog
      open
      role="alertdialog"
      title={title}
      description={description}
      initialFocusRef={cancelRef}
      onClose={busy ? undefined : onCancel}
      closeLabel={copy("close")}
    >
      <div aria-busy={busy}>
        {error && (
          <p role="alert" className="mb-4 text-sm text-danger-text">
            <SettingsText feedback={error} />
          </p>
        )}
        <div className="flex flex-wrap justify-end gap-3">
          <button
            ref={cancelRef}
            type="button"
            disabled={busy}
            onClick={onCancel}
            className="min-h-[44px] min-w-[44px] rounded-lg border border-input px-4 text-foreground disabled:opacity-60"
          >
            {copy("cancel")}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={onConfirm}
            className="btn-destructive min-w-[44px] disabled:opacity-60"
          >
            {action}
          </button>
        </div>
      </div>
    </Dialog>
  );
}

/** The deleted row's opener disappears; move focus to its surviving section. */
export function focusCalendarSection(headingId: string) {
  requestAnimationFrame(() =>
    document.getElementById(headingId)?.closest("summary")?.focus(),
  );
}
