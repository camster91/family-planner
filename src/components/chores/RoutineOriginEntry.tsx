"use client";
import Link from "next/link";
import {
  preparationOriginHref,
  type PreparationRoutineOrigins,
} from "@/lib/event-preparation/origin-contract";
import { routineViewsEnglish, routineViewsSpanish } from "@/i18n/routine-views";
import { useTranslation } from "@/i18n";
import { useDisplayLocale } from "@/components/ui/use-display-locale";
export function RoutineOriginEntry({
  origin,
  explain = false,
}: {
  origin: PreparationRoutineOrigins[string];
  explain?: boolean;
}) {
  const { t } = useTranslation();
  const display = useDisplayLocale();
  const text = (key: keyof typeof routineViewsEnglish, params?: Record<string, string | number>) =>
    t(key, params, { en: routineViewsEnglish, es: routineViewsSpanish });
  return (
    <aside className="min-w-0 max-w-full space-y-1 text-footnote text-label-secondary [overflow-wrap:anywhere]">
      {origin.state === "available" ? (
        <Link
          href={preparationOriginHref(origin)}
          className="btn-plain inline-flex min-h-11 items-center text-start"
          onClick={(event) => event.stopPropagation()}
        >
          {text("sourceLink")}: {origin.label}{" "}
          · {origin.occurrenceDay}
        </Link>
      ) : (
        <p>
          {text("sourceUnverified")}
        </p>
      )}
      {explain && (
        <>
          <p>
            {text("separateTask")}
          </p>
          <p>
            <time dateTime={origin.copiedAt}>
              {text("copiedAt", { date: new Date(origin.copiedAt).toLocaleString(display) })}
            </time>
          </p>
        </>
      )}
    </aside>
  );
}
