"use client";

import * as React from "react";
import { createPortal } from "react-dom";
import { Sparkles } from "lucide-react";
import { useTranslation } from "@/i18n";
import { captureMessages, type CaptureMessage } from "@/i18n/capture";
import { CaptureBox } from "./CaptureBox";

type CaptureAvailability = "available" | "unavailable" | "retry";

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
    "loading" | CaptureAvailability
  >("loading");
  const [portalReady, setPortalReady] = React.useState(false);
  const available = availability === "available" || availability === "retry";
  const pageLock = React.useRef<{
    background: HTMLElement | null;
    wasInert: boolean;
    overflow: string;
  } | null>(null);

  const releasePageLock = React.useCallback(() => {
    const lock = pageLock.current;
    if (!lock) return;
    if (lock.background) lock.background.inert = lock.wasInert;
    document.body.style.overflow = lock.overflow;
    pageLock.current = null;
  }, []);

  const close = React.useCallback(() => {
    // Dialog restores its opener during its child effect cleanup. Release the
    // page lock first so an inert opener can receive focus synchronously.
    releasePageLock();
    setOpen(false);
  }, [releasePageLock]);

  const handleAvailabilityChange = React.useCallback(
    (next: CaptureAvailability) => {
      setAvailability(next);
      if (next === "unavailable") close();
    },
    [close],
  );

  React.useEffect(() => {
    setPortalReady(true);
  }, []);

  React.useEffect(() => {
    if (!open) return;
    const background = document.querySelector<HTMLElement>(
      "[data-dashboard-background]",
    );
    const lock = {
      background,
      wasInert: background?.inert ?? false,
      overflow: document.body.style.overflow,
    };
    pageLock.current = lock;
    if (background) background.inert = true;
    document.body.style.overflow = "hidden";
    return () => {
      if (pageLock.current === lock) releasePageLock();
    };
  }, [open, releasePageLock]);

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
              onClose={close}
              onSaved={onSaved}
              onAvailabilityChange={handleAvailabilityChange}
            />,
            document.body,
          )
        : null}
    </>
  );
}
