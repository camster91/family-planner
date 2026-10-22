"use client";
import Link from "next/link";
import {
  preparationOriginHref,
  type PreparationRoutineOrigins,
} from "@/lib/event-preparation/origin-contract";
import { useTranslation } from "@/i18n";
import { useDisplayLocale } from "@/components/ui/use-display-locale";
export function RoutineOriginEntry({
  origin,
  explain = false,
}: {
  origin: PreparationRoutineOrigins[string];
  explain?: boolean;
}) {
  const { locale } = useTranslation(),
    display = useDisplayLocale();
  const es = locale === "es";
  return (
    <aside className="min-w-0 max-w-full space-y-1 text-footnote text-label-secondary [overflow-wrap:anywhere]">
      {origin.state === "available" ? (
        <Link
          href={preparationOriginHref(origin)}
          className="btn-plain inline-flex min-h-11 items-center text-start"
          onClick={(event) => event.stopPropagation()}
        >
          {es ? "Ver rutina de origen" : "View source routine"}: {origin.label}{" "}
          · {origin.occurrenceDay}
        </Link>
      ) : (
        <p>
          {es
            ? "No se pudo verificar la rutina de origen."
            : "The source routine could not be verified."}
        </p>
      )}
      {explain && (
        <>
          <p>
            {es
              ? "Esta es una tarea independiente. Cambiarla no modifica la rutina ni su historial."
              : "This is a separate task. Editing it does not change the source routine or its history."}
          </p>
          <p>
            <time dateTime={origin.copiedAt}>
              {es ? "Copiada: " : "Copied: "}
              {new Date(origin.copiedAt).toLocaleString(display)}
            </time>
          </p>
        </>
      )}
    </aside>
  );
}
