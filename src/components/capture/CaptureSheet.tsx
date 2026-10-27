"use client";

import * as React from "react";
import Link from "next/link";
import { createPortal } from "react-dom";
import { Sparkles } from "lucide-react";
import { useCoreTranslation } from "@/i18n/core";
import { captureMessages, type CaptureMessage } from "@/i18n/capture";
import { CaptureBox } from "./CaptureBox";

type CaptureAvailability = "available" | "unavailable" | "retry";

/**
 * Calendar's compact entry point for capture. CaptureBox stays mounted after
 * the first page load so a dismissed proposal remains available, while the
 * shared Dialog owns the actual overlay, focus and scroll boundary.
 */
export function CaptureSheet({
  onSaved,
  requested = false,
  canCreateManually = false,
}: {
  onSaved?: () => void;
  requested?: boolean;
  canCreateManually?: boolean;
}) {
  const { t } = useCoreTranslation();
  const msg = (key: CaptureMessage) => t(key, undefined, captureMessages);
  const [open, setOpen] = React.useState(false);
  const [availability, setAvailability] = React.useState<
    "loading" | CaptureAvailability
  >("loading");
  const [portalReady, setPortalReady] = React.useState(false);
  const available = availability === "available" || availability === "retry";
  const requestConsumed = React.useRef(false);
  React.useEffect(() => {
    if (!requested) {
      requestConsumed.current = false;
      return;
    }
    if (available && !requestConsumed.current) {
      requestConsumed.current = true;
      setOpen(true);
    }
  }, [requested, available]);
  const openRef = React.useRef(open);
  openRef.current = open;
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
      // An open sheet must keep a safe refusal or recovery summary visible so
      // a final auth boundary cannot silently discard the user's result.
      // Initial unavailable/forbidden checks happen while closed and keep the
      // launcher/dialog policy unchanged.
      if (next === "unavailable" && !openRef.current) close();
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
      {requested && !available && (
        <div className="rounded-xl bg-[var(--surface-fill-secondary)] p-3 text-footnote text-label-secondary">
          <p role="status">
            {msg(
              availability === "loading"
                ? "openingCapture"
                : "captureUnavailable",
            )}
          </p>
          {availability === "unavailable" && canCreateManually && (
            <Link
              href="/dashboard/calendar/create"
              className="inline-flex min-h-[44px] items-center text-[var(--accent-text)] underline"
            >
              {msg("addManually")}
            </Link>
          )}
        </div>
      )}
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
