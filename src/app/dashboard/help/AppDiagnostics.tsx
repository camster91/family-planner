"use client";

import * as React from "react";
import { useTranslation } from "@/i18n";
import {
  readAppDiagnostics,
  type AppDiagnosticsReport,
} from "@/lib/app-diagnostics";

export default function AppDiagnostics() {
  const { t } = useTranslation();
  const [report, setReport] = React.useState<AppDiagnosticsReport | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [message, setMessage] = React.useState("");
  const mounted = React.useRef(true);
  React.useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const load = async () => {
    if (busy) return;
    setBusy(true);
    setMessage("");
    try {
      const next = await readAppDiagnostics();
      if (mounted.current) setReport(next);
    } catch {
      if (mounted.current) setMessage("appDiagnostics.failed");
    } finally {
      if (mounted.current) setBusy(false);
    }
  };
  const copy = async () => {
    if (!report) return;
    try {
      await navigator.clipboard.writeText(JSON.stringify(report, null, 2));
      if (mounted.current) setMessage("appDiagnostics.copied");
    } catch {
      if (mounted.current) setMessage("appDiagnostics.copyFailed");
    }
  };
  return (
    <section
      aria-labelledby="help-app-details"
      className="card-apple p-5 space-y-3"
    >
      <h2 id="help-app-details" className="text-title-3 text-label-primary">
        {t("appDiagnostics.title")}
      </h2>
      <p className="text-[15px] text-label-secondary">
        {t("appDiagnostics.description")}
      </p>
      <button
        type="button"
        disabled={busy}
        className="btn-secondary min-h-11"
        onClick={() => void load()}
      >
        {t(
          busy
            ? "appDiagnostics.loading"
            : report
              ? "appDiagnostics.refresh"
              : "appDiagnostics.view",
        )}
      </button>
      {report && (
        <>
          <dl className="space-y-2 text-[15px] text-label-primary">
            <div>
              <dt className="text-label-secondary">
                {t("appDiagnostics.client")}
              </dt>
              <dd className="break-words">
                {report.client.installed === "not-native"
                  ? t("appDiagnostics.web")
                  : report.client.installed === "available"
                    ? `${report.client.version} (${report.client.build})`
                    : t("appDiagnostics.unavailable")}
              </dd>
            </div>
            <div>
              <dt className="text-label-secondary">
                {t("appDiagnostics.server")}
              </dt>
              <dd className="break-words">
                {report.server
                  ? `${report.server.version} · ${report.server.commit}`
                  : t("appDiagnostics.unavailable")}
              </dd>
            </div>
          </dl>
          <details>
            <summary className="cursor-pointer min-h-11 py-3 text-accent">
              {t("appDiagnostics.report")}
            </summary>
            <p className="text-[15px] text-label-secondary">
              {t("appDiagnostics.capabilityHint")}
            </p>
            <pre
              className="overflow-x-auto rounded-lg bg-surface-grouped p-3 text-xs"
              data-testid="app-diagnostics-report"
            >
              {JSON.stringify(report, null, 2)}
            </pre>
          </details>
          <button
            type="button"
            className="btn-secondary min-h-11"
            onClick={() => void copy()}
          >
            {t("appDiagnostics.copy")}
          </button>
        </>
      )}
      <p
        role="status"
        aria-live="polite"
        className="text-[15px] text-label-secondary"
      >
        {busy ? t("appDiagnostics.loading") : message ? t(message) : ""}
      </p>
    </section>
  );
}
