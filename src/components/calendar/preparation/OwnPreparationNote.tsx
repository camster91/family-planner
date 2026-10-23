"use client";
import { usePreparationShellText } from "@/i18n/event-preparation-shell";
/** Deliberately read-only. No whole-plan progress, editing or actor switching. */
export function OwnPreparationNote({ title }: { title: string }) {
  const copy = usePreparationShellText();
  return (
    <span className="mt-1 block text-footnote text-label-secondary [overflow-wrap:anywhere]">
      {copy.forEvent} {title}
    </span>
  );
}
