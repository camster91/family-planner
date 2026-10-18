"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/ui/toast";
import { useProjectOverviewText } from "@/i18n/project-overview";

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

  const send = async () => {
    if (sending) return;
    setSending(true);
    try {
      const res = await fetch(
        `/api/projects/${encodeURIComponent(projectId)}/send-to-calendar`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ timeZone: viewerTimeZone() }),
        },
      );
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error(
          (data && typeof data.error === "string" && data.error) ||
            text("taskUpdateFallback"),
        );
      }
      const created = data?.eventsCreated;
      if (!Number.isInteger(created) || created < 0)
        throw new Error(text("calendarError"));
      addToast({
        type: "success",
        title:
          created > 0
            ? created === 1
              ? text("calendarAddedOne")
              : text("calendarAddedMany", { count: created })
            : text("calendarNothing"),
        message: created > 0 ? undefined : text("calendarNothingMessage"),
      });
      router.refresh();
    } catch (error) {
      addToast({
        type: "error",
        title: text("calendarError"),
        message:
          error instanceof TypeError
            ? text("taskUpdateNetworkError")
            : error instanceof Error
              ? error.message
              : text("taskUpdateFallback"),
      });
    } finally {
      setSending(false);
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
