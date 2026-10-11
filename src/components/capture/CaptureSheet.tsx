"use client";

import * as React from "react";
import { createPortal } from "react-dom";
import { Sparkles } from "lucide-react";
import { useTranslation } from "@/i18n";
import { captureMessages, type CaptureMessage } from "@/i18n/capture";
import { CaptureBox } from "./CaptureBox";

/**
 * Calendar's compact entry point for capture. CaptureBox stays mounted after
 * the first page load so a dismissed proposal remains available, while the
 * shared Dialog owns the actual overlay, focus and scroll boundary.
 */
export function CaptureSheet({ onSaved }: { onSaved?: () => void }) {
  const { t } = useTranslation();
  const msg = (key: CaptureMessage) => t(key, undefined, captureMessages);
  const [open, setOpen] = React.useState(false);
  const [availability, setAvailability] = React.useState<
    "loading" | "available" | "unavailable"
  >("loading");
  const [portalReady, setPortalReady] = React.useState(false);
  const available = availability === "available";

  const handleAvailabilityChange = React.useCallback((next: boolean) => {
    setAvailability(next ? "available" : "unavailable");
    if (!next) setOpen(false);
  }, []);

  React.useEffect(() => {
    setPortalReady(true);
  }, []);

  React.useEffect(() => {
    if (!open) return;
    const background = document.querySelector<HTMLElement>(
      "[data-dashboard-background]",
    );
    const wasInert = background?.inert ?? false;
    const overflow = document.body.style.overflow;
    if (background) background.inert = true;
    document.body.style.overflow = "hidden";
    return () => {
      if (background) background.inert = wasInert;
      document.body.style.overflow = overflow;
    };
  }, [open]);

  return (
    <>
      {available && (
        <button
          type="button"
          className="btn-tinted min-h-[44px]"
          aria-haspopup="dialog"
          aria-expanded={open}
          onClick={() => setOpen(true)}
        >
          <Sparkles className="h-4 w-4" aria-hidden="true" />
          {msg("openQuickAdd")}
        </button>
      )}
      {portalReady
        ? createPortal(
            <CaptureBox
              presentation="sheet"
              open={open}
              onClose={() => setOpen(false)}
              onSaved={onSaved}
              onAvailabilityChange={handleAvailabilityChange}
            />,
            document.body,
          )
        : null}
    </>
  );
}
