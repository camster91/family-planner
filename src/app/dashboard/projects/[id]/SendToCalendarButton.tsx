"use client";

import { useState, useRef, useEffect } from "react";
import { PROJECT_CALENDAR_SUMMARY_MODE, projectCalendarSummary } from "@/lib/project-calendar-response";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/ui/toast";
import { useProjectOverviewText } from "@/i18n/project-overview";

class UnconfirmedCalendarSend extends Error {}

function viewerTimeZone(): string | undefined {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || undefined;
  } catch {
    return undefined;
  }
}

/**
 * "Send to Calendar": adds the project's incomplete, dated tasks to the
 * household calendar as all-day events on their due day (in the viewer's
 * time zone). Tasks already sent are skipped by the API.
 */
export function SendToCalendarButton({ projectId }: { projectId: string }) {
  const router = useRouter();
  const { addToast } = useToast();
  const text = useProjectOverviewText();
  const [sending, setSending] = useState(false);
  const generation = useRef(0);
  const pending = useRef(false);
  useEffect(() => {
    generation.current++;
    pending.current = false;
    setSending(false);
    return () => { generation.current++; };
  }, [projectId]);

  const send = async () => {
    if (pending.current) return;
    const epoch = generation.current;
    pending.current = true;
    setSending(true);
    try {
      const res = await fetch(
        `/api/projects/${encodeURIComponent(projectId)}/send-to-calendar`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ timeZone: viewerTimeZone(), responseMode: PROJECT_CALENDAR_SUMMARY_MODE }),
        },
      );
      const data = await res.json().catch(() => null);
      if (epoch !== generation.current) return;
      if (!res.ok) {
        if (res.status >= 500) throw new UnconfirmedCalendarSend();
        throw new Error(
          (data && typeof data.error === "string" && data.error) ||
            text("taskUpdateFallback"),
        );
      }
      const result = projectCalendarSummary.safeParse(data);
      if (!result.success) throw new UnconfirmedCalendarSend();
      const created = result.data.eventsCreated;
      addToast({
        type: "success",
        title:
          created > 0
            ? created === 1
              ? text("calendarAddedOne")
              : text("calendarAddedMany", { count: created })
            : text("calendarNothing"),
        message: created > 0 ? undefined : text(result.data.state === "no-tasks" ? "calendarNoDatedTasks" : "calendarNothingMessage"),
      });
      router.refresh();
    } catch (error) {
      if (epoch !== generation.current) return;
      addToast({
        type: "error",
        title: text("calendarError"),
        message:
          error instanceof TypeError || error instanceof UnconfirmedCalendarSend
            ? text("calendarResultUnknown")
            : error instanceof Error
              ? error.message
              : text("taskUpdateFallback"),
      });
    } finally {
      if (epoch === generation.current) {
        pending.current = false;
        setSending(false);
      }
    }
  };

  return (
    <button
      type="button"
      onClick={send}
      disabled={sending}
      aria-busy={sending || undefined}
      className="btn-tinted bg-tint-projects text-white min-h-[44px] px-4 py-2 text-sm font-medium shrink-0 disabled:opacity-60"
    >
      {sending ? text("sending") : text("sendToCalendar")}
    </button>
  );
}
