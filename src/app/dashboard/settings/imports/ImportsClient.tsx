"use client";

import { useEffect, useRef, useState } from "react";
import { z } from "zod";
import { useImportSettingsText, type ImportSettingsError } from "@/i18n/import-settings";
import Link from "next/link";
import {
  ArrowLeft,
  Database,
  FileJson,
  Loader2,
  ShieldCheck,
} from "lucide-react";

type Source = "chore-champs" | "meal-planner" | "budget-app";

// Validate the response envelope before it can enable approval. Source plans
// and diagnostic records remain literal; this does not certify reconciliation.
const resultSchema = z.object({
  plan: z.record(z.string(), z.unknown()),
  summary: z.object({
    created: z.record(z.string(), z.number().int().nonnegative()),
    reused: z.record(z.string(), z.number().int().nonnegative()),
    skipped: z.array(z.object({ sourceModel: z.string(), sourceId: z.string(), reason: z.string() }).passthrough()),
  }).passthrough(),
  jobId: z.string().regex(/^[A-Za-z0-9_-]{1,128}$/).nullable(),
}).passthrough();
function responseError(body: unknown): ImportSettingsError | null {
  if (!body || typeof body !== "object") return null;
  const value = body as { code?: unknown; error?: unknown };
  if (value.code === "SESSION_CHANGED" || value.error === "Unauthorized") return "sessionChanged";
  if (value.code === "IDENTITY_CONFLICT") return "identityChanged";
  if (value.error === "Identity map contains users outside this family") return "foreignMapping";
  if (value.error === "Invalid source export") return "invalidExport";
  if (value.error === "Import payload exceeds 10 MB") return "payloadTooLarge";
  return null;
}

export default function ImportsClient() {
  const text = useImportSettingsText();
  const [source, setSource] = useState<Source>("chore-champs");
  const [fileData, setFileData] = useState<unknown>(null);
  const [fileName, setFileName] = useState("");
  const [identityMap, setIdentityMap] = useState("{}");
  const [result, setResult] = useState<Record<string, unknown> | null>(null);
  const [error, setError] = useState<ImportSettingsError | null>(null);
  const [loading, setLoading] = useState(false);
  const [writing, setWriting] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [reading, setReading] = useState(false);
  const [previewReady, setPreviewReady] = useState(false);
  const [inputVersion, setInputVersion] = useState(0);
  const revision = useRef(0);
  const fileRequest = useRef(0);
  const operation = useRef(0);
  const pending = useRef(false);
  const fileReading = useRef(false);
  const reviewed = useRef<{ version: number; source: Source; body: string } | null>(null);
  useEffect(() => () => {
    fileRequest.current++;
    operation.current++;
    reviewed.current = null;
  }, []);

  const resetPreview = () => {
    reviewed.current = null;
    setPreviewReady(false);
    setInputVersion(++revision.current);
    setResult(null);
    setConfirmed(false);
    setError(null);
  };

  const handleFile = async (file: File | undefined) => {
    if (pending.current) return;
    const request = ++fileRequest.current;
    resetPreview();
    setFileData(null);
    setFileName("");
    fileReading.current = Boolean(file);
    setReading(Boolean(file));
    if (!file) return;
    try {
      if (file.size > 10 * 1024 * 1024) {
        setError("fileTooLarge");
        return;
      }
      const data: unknown = JSON.parse(await file.text());
      if (request !== fileRequest.current) return;
      setFileData(data);
      setFileName(file.name);
    } catch {
      if (request === fileRequest.current) setError("fileUnreadable");
    } finally {
      if (request === fileRequest.current) {
        fileReading.current = false;
        setReading(false);
      }
    }
  };

  const runImport = async (dryRun: boolean) => {
    if (pending.current || fileReading.current || inputVersion !== revision.current) return;
    if (!fileData) return setError("fileRequired");
    let body: string;
    let selectedSource = source;
    const version = revision.current;
    if (dryRun) {
      let parsedMap: unknown;
      try { parsedMap = JSON.parse(identityMap); }
      catch { return setError("mappingInvalid"); }
      if (!parsedMap || Array.isArray(parsedMap) || typeof parsedMap !== "object" ||
        !Object.values(parsedMap).every(value => typeof value === "string" && value.length > 0))
        return setError("mappingObject");
      body = JSON.stringify({ data: fileData, identityMap: parsedMap, dryRun: true });
      reviewed.current = null;
      setPreviewReady(false);
      setConfirmed(false);
      setResult(null);
    } else {
      const preview = reviewed.current;
      if (!confirmed || !previewReady || !preview || preview.version !== version) return setError("previewRequired");
      selectedSource = preview.source;
      body = preview.body;
      // Every persistence attempt consumes local review, including an unknown
      // result. No transport retry or second write is started automatically.
      reviewed.current = null;
      setPreviewReady(false);
      setConfirmed(false);
    }
    pending.current = true;
    const own = ++operation.current;
    setLoading(true);
    setWriting(!dryRun);
    setError(null);
    try {
      const response = await fetch(`/api/admin/imports/${selectedSource}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
      });
      const value: unknown = await response.json().catch(() => null);
      if (own !== operation.current || version !== revision.current) return;
      if (!response.ok) {
        setError(responseError(value) ?? (dryRun ? "failed" : "writeUnconfirmed"));
        return;
      }
      const parsed = resultSchema.safeParse(value);
      if (!parsed.success || (dryRun ? parsed.data.jobId !== null : parsed.data.jobId === null)) {
        setError(dryRun ? "failed" : "writeUnconfirmed");
        return;
      }
      setResult(parsed.data);
      if (dryRun) {
        const payload = JSON.parse(body) as Record<string, unknown>;
        reviewed.current = { version, source: selectedSource, body: JSON.stringify({ ...payload, dryRun: false }) };
        setPreviewReady(true);
      }
    } catch {
      if (own === operation.current && version === revision.current)
        setError(dryRun ? "failed" : "writeUnconfirmed");
    } finally {
      if (own === operation.current) { pending.current = false; setLoading(false); }
    }
  };

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <Link
        href="/dashboard/settings"
        className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="w-4 h-4" aria-hidden="true" /> {text("back")}
      </Link>

      <div>
        <h1 className="text-3xl font-bold text-foreground flex items-center gap-3">
          <Database className="w-8 h-8 text-primary" aria-hidden="true" /> {text("title")}
        </h1>
        <p className="mt-2 text-muted-foreground">
          {text("description")}
        </p>
      </div>

      <div className="card space-y-6">
        <div>
          <label
            htmlFor="importSource"
            className="block text-sm font-medium text-foreground mb-2"
          >
            {text("source")}
          </label>
          <select
            id="importSource"
            value={source}
            disabled={loading}
            onChange={(event) => {
              if (pending.current) return;
              setSource(event.target.value as Source);
              resetPreview();
            }}
            className="input-field w-full"
          >
            <option value="chore-champs">ChoreChamps</option>
            <option value="meal-planner">Meal Planner</option>
            <option value="budget-app">Budget App</option>
          </select>
        </div>

        <div>
          <label
            htmlFor="importFile"
            className="block text-sm font-medium text-foreground mb-2"
          >
            {text("file")}
          </label>
          <label
            htmlFor="importFile"
            className="flex cursor-pointer items-center justify-center gap-3 rounded-xl border-2 border-dashed border-input p-8 hover:border-primary"
          >
            <FileJson className="w-6 h-6 text-primary" aria-hidden="true" />
            <span>
              {fileName || text("chooseFile")}
            </span>
          </label>
          <input
            id="importFile"
            className="sr-only"
            type="file"
            accept="application/json,.json"
            disabled={loading}
            onChange={(event) => void handleFile(event.target.files?.[0])}
          />
        </div>

        {reading && <p role="status" className="text-sm text-muted-foreground">{text("reading")}</p>}

        {source !== "budget-app" && (
          <div>
            <label
              htmlFor="identityMap"
              className="block text-sm font-medium text-foreground mb-2"
            >
              {text("mapping")}
            </label>
            <textarea
              id="identityMap"
              rows={5}
              value={identityMap}
              disabled={loading}
              onChange={(event) => {
                if (pending.current) return;
                setIdentityMap(event.target.value);
                resetPreview();
              }}
              className="input-field w-full font-mono text-sm"
            />
            <p className="mt-2 text-xs text-label-tertiary">
              {text("mappingHelp")} {`{"source-id":"family-user-id"}`}.
            </p>
          </div>
        )}

        {error && (
          <div
            role="alert"
            className="rounded-lg border border-[var(--danger-tint)] bg-[var(--danger-tint)] p-3 text-danger-text"
          >
            {text(error)}
          </div>
        )}

        <button
          type="button"
          disabled={loading || reading || !fileData}
          onClick={() => void runImport(true)}
          className="btn-primary min-h-11 inline-flex items-center gap-2 disabled:opacity-50"
        >
          {loading ? (
            <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
          ) : (
            <ShieldCheck className="w-4 h-4" aria-hidden="true" />
          )}{" "}
          {text(loading ? (writing ? "persisting" : "validating") : "validate")}
        </button>
      </div>

      {result && (
        <div className="card space-y-4">
          <h2 className="text-xl font-semibold text-foreground">
            {text(result.jobId === null ? "preview" : "result")}
          </h2>
          <pre className="max-h-96 overflow-auto rounded-lg bg-muted p-4 text-xs text-foreground">
            {JSON.stringify(result, null, 2)}
          </pre>
          <label className="flex items-start gap-3 text-sm text-foreground">
            <input
              type="checkbox"
              checked={confirmed}
              disabled={loading || !previewReady}
              onChange={(event) => {
                if (pending.current || !reviewed.current || reviewed.current.version !== revision.current) return;
                setConfirmed(event.target.checked);
              }}
              className="mt-1"
            />
            {text("confirm")}
          </label>
          <button
            type="button"
            disabled={loading || !confirmed || !previewReady}
            onClick={() => void runImport(false)}
            className="btn-primary min-h-11 disabled:opacity-50"
          >
            {text(loading && writing ? "persisting" : "persist")}
          </button>
        </div>
      )}
    </div>
  );
}
