"use client";

import * as React from "react";
import { readPersonQueueDiagnostics } from "@/lib/offline-queue-browser";
import type { QueueDiagnostics } from "@/lib/offline-queue";

/** Deliberate local support report, never an automatic analytics export. */
export default function SyncDiagnostics({ userId }: { userId: string }) {
  const [report, setReport] = React.useState<QueueDiagnostics | null>(null);
  const [message, setMessage] = React.useState("");
  React.useEffect(() => {
    setReport(null);
    setMessage("");
  }, [userId]);
  const load = () => {
    const next = readPersonQueueDiagnostics(userId);
    setReport(next);
    setMessage(
      next
        ? ""
        : "Open a grocery list first, then return here. Sync details are available only for this open app session.",
    );
  };
  const copy = async () => {
    if (!report) return;
    try {
      await navigator.clipboard.writeText(JSON.stringify(report, null, 2));
      setMessage(
        "Copied. Nothing was sent. You can choose whether to share this report with support.",
      );
    } catch {
      setMessage(
        "Could not copy. You can select the report below and copy it yourself.",
      );
    }
  };
  return (
    <section aria-labelledby="help-sync" className="card-apple p-5 space-y-3">
      <h2 id="help-sync" className="text-title-3 text-label-primary">
        Trouble syncing?
      </h2>
      <p className="text-[15px] text-label-secondary">
        View counts of waiting changes, successful sends, failures and conflicts
        on this browser. No names, item text, account IDs or passwords are
        included. Nothing is sent automatically. Counts reset when this app
        session closes or you sign out; they are not a history of all your
        devices.
      </p>
      <button type="button" className="btn-secondary min-h-11" onClick={load}>
        {report ? "Refresh sync details" : "View sync details"}
      </button>
      {report && (
        <>
          <p className="text-[15px] text-label-primary">
            {report.depth} queued changes. {report.replay.successes} successful
            sends, {report.replay.failures} unsuccessful sends, including{" "}
            {report.replay.conflicts} conflicts.{" "}
            {report.durable
              ? "Queued changes are saved on this browser."
              : "Changes are only in memory. Keep this page open until they sync."}
          </p>
          <details>
            <summary className="cursor-pointer min-h-11 py-3 text-accent">
              Report for support
            </summary>
            <pre
              className="overflow-x-auto rounded-lg bg-surface-grouped p-3 text-xs"
              data-testid="sync-diagnostics-report"
            >
              {JSON.stringify(report, null, 2)}
            </pre>
          </details>
          <button
            type="button"
            className="btn-secondary min-h-11"
            onClick={() => void copy()}
          >
            Copy sync report
          </button>
        </>
      )}
      <p aria-live="polite" className="text-[15px] text-label-secondary">
        {message}
      </p>
    </section>
  );
}
