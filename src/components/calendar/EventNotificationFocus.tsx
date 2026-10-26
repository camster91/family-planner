"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import type { EventNotificationFocus as Focus } from "@/lib/event-notification-focus";
import { useCoreTranslation } from "@/i18n/core";
import { calendarPageMessages } from "@/i18n/calendar-page";
import { useDisplayLocale } from "@/components/ui/use-display-locale";
/** Read-only event context; no source/edit/permission inference from the link. */
export function EventNotificationFocus({ target }: { target: Focus | null }) {
  const { t } = useCoreTranslation();
  const locale = useDisplayLocale();
  const [zone, setZone] = useState("UTC");
  const card = useRef<HTMLElement>(null);
  useEffect(() => {
    try { setZone(Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"); } catch {}
  }, []);
  useEffect(() => { card.current?.focus(); }, [target?.id]);
  const format = (value: string) => new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short", timeZone: zone }).format(new Date(value));
  return <section ref={card} tabIndex={-1} aria-label={t("focusHeading", undefined, calendarPageMessages)}
    className="mx-4 mb-4 rounded-[var(--radius-xl)] border border-[var(--surface-separator)] bg-[var(--surface-elevated)] p-4 space-y-3 outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]">
    <p className="text-footnote text-label-secondary">{t("focusHeading", undefined, calendarPageMessages)}</p>
    {target ? <>
      <h2 className="text-title-3 font-semibold [overflow-wrap:anywhere]">{target.title}</h2>
      <p className="text-body [overflow-wrap:anywhere]"><time dateTime={target.start}>{format(target.start)}</time> – <time dateTime={target.end}>{format(target.end)}</time></p>
      <p className="text-footnote text-label-secondary">{t("focusZone", { zone }, calendarPageMessages)}</p>
    </> : <p role="status" className="text-body">{t("focusUnavailable", undefined, calendarPageMessages)}</p>}
    <Link href="/dashboard/calendar" className="btn-tinted min-h-[44px] inline-flex items-center">{t("focusAll", undefined, calendarPageMessages)}</Link>
  </section>;
}
