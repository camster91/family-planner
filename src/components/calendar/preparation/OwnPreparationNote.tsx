"use client";
import { usePreparationText } from "@/i18n/event-preparation";
/** Deliberately read-only. No whole-plan progress, editing or actor switching. */
export function OwnPreparationNote({ title }: { title: string }) {
  const copy = usePreparationText();
  return (
    <span className="mt-1 block text-footnote text-label-secondary [overflow-wrap:anywhere]">
      {copy.forEvent} {title}
    </span>
  );
}
