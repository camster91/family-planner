"use client";

import * as React from "react";
import { readPersonQueueDiagnostics } from "@/lib/person-queue-browser";
import type { QueueDiagnostics } from "@/lib/offline-queue";
import { useTranslation } from "@/i18n";
import {
  useSyncDiagnosticsText,
  type SyncDiagnosticsMessage,
} from "@/i18n/sync-diagnostics";

/** Deliberate local support report, never an automatic analytics export. */
export default function SyncDiagnostics({ userId }: { userId: string }) {
  const text = useSyncDiagnosticsText();
  const { locale } = useTranslation();
  const [snapshot, setSnapshot] = React.useState<{
    ownerId: string;
    report: QueueDiagnostics | null;
  } | null>(null);
  const [notice, setNotice] = React.useState<{
    ownerId: string;
    message: SyncDiagnosticsMessage;
  } | null>(null);
  const sequence = React.useRef(0);
  // Ownership is checked during render too, before the reset effect runs.
  const report = snapshot?.ownerId === userId ? snapshot.report : null;
  const message = notice?.ownerId === userId ? notice.message : null;
  React.useEffect(() => {
    sequence.current++;
    setSnapshot(null);
    setNotice(null);
    return () => { sequence.current++; };
  }, [userId]);
  const load = () => {
    sequence.current++;
    const next = readPersonQueueDiagnostics(userId);
    setSnapshot({ ownerId: userId, report: next });
    setNotice(next ? null : { ownerId: userId, message: "unavailable" });
  };
  const copy = async () => {
    if (!report) return;
    const request = ++sequence.current;
    const ownerId = userId;
    try {
      await navigator.clipboard.writeText(JSON.stringify(report, null, 2));
      if (request === sequence.current) setNotice({ ownerId, message: "copied" });
    } catch {
      if (request === sequence.current) setNotice({ ownerId, message: "copyFailed" });
    }
  };
  const number = (value: number) => new Intl.NumberFormat(locale).format(value);
  return (
    <section aria-labelledby="help-sync" className="card-apple p-5 space-y-3">
      <h2 id="help-sync" className="text-title-3 text-label-primary">
        {text("title")}
      </h2>
      <p className="text-[15px] text-label-secondary">
        {text("description")}
      </p>
      <button type="button" className="btn-secondary min-h-11" onClick={load}>
        {text(report ? "refresh" : "view")}
      </button>
      {report && (
        <>
          <p className="text-[15px] text-label-primary">
            {text(report.depth === 1 ? "queuedOne" : "queuedMany", { count: number(report.depth) })}{" "}
            {text(report.replay.successes === 1 ? "sentOne" : "sentMany", { count: number(report.replay.successes) })}{" "}
            {text(report.replay.failures === 1 ? "failedOne" : "failedMany", { count: number(report.replay.failures) })}{" "}
            {text("conflicts", { count: number(report.replay.conflicts) })}{" "}
            {text(report.durable ? "durable" : "memory")}
          </p>
          <details>
            <summary className="cursor-pointer min-h-11 py-3 text-accent">
              {text("support")}
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
            {text("copy")}
          </button>
        </>
      )}
      <p aria-live="polite" className="text-[15px] text-label-secondary">
        {message ? text(message) : ""}
      </p>
    </section>
  );
}
