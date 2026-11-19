"use client";

import * as React from "react";
import { Volume2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { useCoreI18n } from "@/i18n/core";

/** Whether this browser can speak text (Web Speech API). */
export function canSpeak(): boolean {
  return (
    typeof window !== "undefined" &&
    "speechSynthesis" in window &&
    typeof window.SpeechSynthesisUtterance === "function"
  );
}

/**
 * "Read aloud" for pre-readers: speaks `text` with the browser's own
 * speechSynthesis (nothing leaves the device, no provider). Rendered only
 * after mount and only where the browser supports it, so the server HTML and
 * the first client render match and unsupported browsers show no dead button.
 * A new tap stops whatever was being read first.
 */
export function ReadAloudButton({
  text,
  label,
  describedBy,
  className,
}: {
  text: string;
  /** Visible-free accessible name, e.g. "Read aloud". */
  label: string;
  /** Id of the element that names what will be read (the title). */
  describedBy?: string;
  className?: string;
}) {
  const { locale } = useCoreI18n();
  const [supported, setSupported] = React.useState(false);
  React.useEffect(() => setSupported(canSpeak()), []);
  if (!supported || !text.trim()) return null;
  return (
    <button
      type="button"
      aria-label={label}
      aria-describedby={describedBy}
      data-testid="read-aloud"
      onClick={(event) => {
        event.stopPropagation();
        const synth = window.speechSynthesis;
        synth.cancel();
        const utterance = new window.SpeechSynthesisUtterance(text);
        utterance.lang = locale === "es" ? "es" : "en";
        synth.speak(utterance);
      }}
      className={cn(
        "inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-label-secondary",
        "hover:bg-[var(--surface-fill)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]",
        className,
      )}
    >
      <Volume2 className="h-5 w-5" aria-hidden="true" />
    </button>
  );
}
