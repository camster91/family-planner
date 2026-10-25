"use client";

import { useEffect, useRef, useState } from "react";
import { z } from "zod";
import { IMPORT_OWNER_HEADER, importOwner, sameImportOwner, type ImportOwner } from "@/lib/imports/import-owner-contract";
import { runOwnedForeground } from "@/lib/owned-request-http";
import { abortable, readBoundedJsonResponse } from "@/lib/bounded-json-response";
import { duplicateSourceRows, type DuplicateSourceRow } from "@/lib/imports/source-identity-validation";
import { useImportSettingsText, type ImportSettingsError } from "@/i18n/import-settings";
import Link from "next/link";
import {
  ArrowLeft,
  Database,
  FileJson,
  Loader2,
  ShieldCheck,
} from "lucide-react";

const IMPORT_FILE_TIMEOUT_MS = 15_000;
const IMPORT_FILE_BYTES = 10 * 1024 * 1024;
const IMPORT_PREVIEW_TIMEOUT_MS = 15_000;
// Existing canonical effect transactions allow60s, plus job/auth/transport work.
const IMPORT_WRITE_TIMEOUT_MS = 90_000;
const IMPORT_RESPONSE_BYTES = 16 * 1024 * 1024;

type Source = "chore-champs" | "meal-planner" | "budget-app";

// Validate the response envelope before it can enable approval. Source plans
// and diagnostic records remain literal; this does not certify reconciliation.
const reviewSchema = z.object({
  protocol: z.literal(1),
  actorId: z.string().regex(/^[A-Za-z0-9_-]{1,128}$/),
  familyId: z.string().regex(/^[A-Za-z0-9_-]{1,128}$/),
}).strict();
const resultSchema = z.object({
  plan: z.record(z.string(), z.unknown()),
  summary: z.object({
    created: z.record(z.string(), z.number().int().nonnegative()),
    reused: z.record(z.string(), z.number().int().nonnegative()),
    skipped: z.array(z.object({ sourceModel: z.string(), sourceId: z.string(), reason: z.string() }).passthrough()),
  }).passthrough(),
  jobId: z.string().regex(/^[A-Za-z0-9_-]{1,128}$/).nullable(),
  review: reviewSchema.optional(),
  originalOwner: importOwner.optional(),
}).passthrough();
function responseError(body: unknown): ImportSettingsError | null {
  if (!body || typeof body !== "object") return null;
  const value = body as { code?: unknown; error?: unknown };
  if (value.code === "IMPORT_OWNER_REQUIRED") return "reviewUnsupported";
  if (value.code === "IMPORT_SCOPE_CHANGED") return "scopeChanged";
  if (value.code === "IMPORT_REVIEW_REQUIRED") return "previewRequired";
  if (value.code === "SESSION_CHANGED" || value.error === "Unauthorized") return "sessionChanged";
  if (value.code === "IDENTITY_CONFLICT") return "identityChanged";
  if (value.error === "Identity map contains users outside this family") return "foreignMapping";
  if (value.error === "Invalid source export") return "invalidExport";
  if (value.error === "Import payload exceeds 10 MB") return "payloadTooLarge";
  return null;
}

export default function ImportsClient({ owner: ownerInput = null }: { owner?: ImportOwner | null }) {
  const text = useImportSettingsText();
  const suppliedOwner = importOwner.safeParse(ownerInput);
  const suppliedOwnerKey = suppliedOwner.success ? JSON.stringify(suppliedOwner.data) : null;
  const boundOwner = useRef<ImportOwner | null>(suppliedOwner.success ? suppliedOwner.data : null).current;
  const boundOwnerKey = boundOwner ? JSON.stringify(boundOwner) : null;
  const ownerChanged = suppliedOwnerKey !== boundOwnerKey;
  const [authorityHold, setAuthorityHold] = useState<'scopeChanged' | 'sessionChanged' | 'reviewUnsupported' | null>(null);
  const backendUnavailable = !boundOwner || authorityHold === 'reviewUnsupported';
  const [source, setSource] = useState<Source>("chore-champs");
  const [fileData, setFileData] = useState<unknown>(null);
  const [fileName, setFileName] = useState("");
  const [identityMap, setIdentityMap] = useState("{}");
  const [result, setResult] = useState<Record<string, unknown> | null>(null);
  const [error, setError] = useState<ImportSettingsError | null>(null);
  const [sourceDuplicates, setSourceDuplicates] = useState<DuplicateSourceRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [writing, setWriting] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [reading, setReading] = useState(false);
  const [previewReady, setPreviewReady] = useState(false);
  const [inputVersion, setInputVersion] = useState(0);
  const revision = useRef(0);
  const fileRequest = useRef(0);
  const activeFileRead = useRef<AbortController | null>(null);
  const fileInput = useRef<HTMLInputElement | null>(null);
  const operation = useRef(0);
  const pending = useRef(false);
  const activeRequest = useRef<AbortController | null>(null);
  const reloadControl = useRef<HTMLButtonElement | null>(null);
  const fileReading = useRef(false);
  const reviewed = useRef<{ version: number; source: Source; body: string } | null>(null);
  useEffect(() => () => {
    fileRequest.current++;
    activeFileRead.current?.abort();
    activeFileRead.current = null;
    operation.current++;
    activeRequest.current?.abort();
    activeRequest.current = null;
    reviewed.current = null;
  }, []);

  useEffect(() => {
    if (!ownerChanged) return;
    // Never rebind the old file/map/review after an account or generation change.
    operation.current++;
    fileRequest.current++;
    activeFileRead.current?.abort();
    activeFileRead.current = null;
    activeRequest.current?.abort();
    activeRequest.current = null;
    reviewed.current = null;
    pending.current = false;
    fileReading.current = false;
    setPreviewReady(false); setConfirmed(false); setResult(null);
    setLoading(false); setReading(false); setAuthorityHold('scopeChanged');
  }, [ownerChanged]);

  useEffect(() => {
    if ((ownerChanged || authorityHold === 'scopeChanged' || authorityHold === 'sessionChanged') && document.activeElement === document.body)
      reloadControl.current?.focus();
  }, [ownerChanged, authorityHold]);

  const resetPreview = () => {
    reviewed.current = null;
    setPreviewReady(false);
    setInputVersion(++revision.current);
    setResult(null);
    setConfirmed(false);
    setError(null);
    setSourceDuplicates([]);
  };

  const handleFile = async (file: File | undefined) => {
    if (pending.current) return;
    const request = ++fileRequest.current;
    activeFileRead.current?.abort();
    activeFileRead.current = null;
    resetPreview();
    setFileData(null);
    setFileName("");
    fileReading.current = Boolean(file);
    setReading(Boolean(file));
    if (!file) return;
    const controller = new AbortController();
    activeFileRead.current = controller;
    try {
      if (file.size > IMPORT_FILE_BYTES) {
        setError("fileTooLarge");
        if (fileInput.current) fileInput.current.value = "";
        return;
      }
      const contents = await runOwnedForeground(signal => abortable(file.text(), signal), {
        signal: controller.signal, timeoutMs: IMPORT_FILE_TIMEOUT_MS,
      });
      if (request !== fileRequest.current) return;
      if (typeof contents !== 'string') {
        setError('fileUnreadable');
        if (fileInput.current) fileInput.current.value = "";
        return;
      }
      // Metadata can be incomplete on bridges; refuse decoded overflow BEFORE
      // JSON.parse. A text-only bridge has already allocated the source string.
      if (contents.length > IMPORT_FILE_BYTES || new Blob([contents]).size > IMPORT_FILE_BYTES) {
        setError('fileTooLarge');
        if (fileInput.current) fileInput.current.value = "";
        return;
      }
      const data: unknown = JSON.parse(contents);
      setFileData(data);
      setFileName(file.name);
    } catch {
      if (request === fileRequest.current) {
        setError("fileUnreadable");
        if (fileInput.current) fileInput.current.value = "";
      }
    } finally {
      if (activeFileRead.current === controller) activeFileRead.current = null;
      if (request === fileRequest.current) {
        fileReading.current = false;
        setReading(false);
      }
    }
  };

  const runImport = async (dryRun: boolean) => {
    if (pending.current || fileReading.current || inputVersion !== revision.current) return;
    if (!boundOwner || ownerChanged || authorityHold) return;
    setSourceDuplicates([]);
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
      body = JSON.stringify({ data: fileData, identityMap: parsedMap, dryRun: true, reviewProtocol: 1 });
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
    const controller = new AbortController();
    activeRequest.current = controller;
    setLoading(true);
    setWriting(!dryRun);
    setError(null);
    try {
      const outcome = await runOwnedForeground(async signal => {
        const response = await fetch(`/api/admin/imports/${selectedSource}/owned`, {
          method: "POST", headers: { "Content-Type": "application/json", [IMPORT_OWNER_HEADER]: JSON.stringify(boundOwner) }, body,
          signal, cache: "no-store", credentials: "same-origin",
        });
        if (response.status === 401 || response.status === 403) return { kind: 'reply' as const, response, value: { code: response.status === 401 ? 'SESSION_CHANGED' : 'IMPORT_SCOPE_CHANGED' } };
        if (response.status === 404) return { kind: 'reply' as const, response, value: { code: 'IMPORT_OWNER_REQUIRED' } };
        const value = await readBoundedJsonResponse(response, signal, IMPORT_RESPONSE_BYTES);
        return { kind: 'reply' as const, response, value };
      }, { signal: controller.signal, timeoutMs: dryRun ? IMPORT_PREVIEW_TIMEOUT_MS : IMPORT_WRITE_TIMEOUT_MS });
      if (own !== operation.current || version !== revision.current) return;
      if (outcome.kind === 'unknown') {
        setError(dryRun ? "failed" : "writeUnconfirmed");
        return;
      }
      const { response, value } = outcome;
      if (!response.ok) {
        const reason = responseError(value);
        if (response.status === 401 || reason === 'sessionChanged') setAuthorityHold('sessionChanged');
        else if (response.status === 403 || reason === 'scopeChanged') setAuthorityHold('scopeChanged');
        else if (reason === 'reviewUnsupported') setAuthorityHold('reviewUnsupported');
        if (responseError(value) === 'invalidExport' && value && typeof value === 'object' && 'duplicateSourceIds' in value) {
          const rows = duplicateSourceRows.safeParse(value.duplicateSourceIds);
          if (rows.success) setSourceDuplicates(rows.data);
        }
        setError(!dryRun && ["scopeChanged", "sessionChanged", "reviewUnsupported"].includes(reason ?? "") ? "writeUnconfirmed" : reason ?? (dryRun ? "failed" : "writeUnconfirmed"));
        return;
      }
      const marker = importOwner.safeParse(value && typeof value === 'object' && 'originalOwner' in value ? value.originalOwner : null);
      if (!marker.success) {
        setAuthorityHold('reviewUnsupported'); setError(dryRun ? 'reviewUnsupported' : 'writeUnconfirmed'); return;
      }
      if (!sameImportOwner(marker.data, boundOwner)) {
        setAuthorityHold('scopeChanged'); setError(dryRun ? 'scopeChanged' : 'writeUnconfirmed'); return;
      }
      const parsed = resultSchema.safeParse(value);
      if (!parsed.success || (dryRun ? parsed.data.jobId !== null : parsed.data.jobId === null)) {
        setError(dryRun ? "failed" : "writeUnconfirmed");
        return;
      }
      if (!parsed.data.review || !parsed.data.originalOwner) {
        setAuthorityHold('reviewUnsupported');
        setError(dryRun ? "reviewUnsupported" : "writeUnconfirmed");
        return;
      }
      const { review, originalOwner: receiptOwner, ...report } = parsed.data;
      if (!sameImportOwner(receiptOwner, boundOwner) || review.actorId !== boundOwner.actorId || review.familyId !== boundOwner.familyId) {
        setAuthorityHold('scopeChanged'); setError(dryRun ? 'scopeChanged' : 'writeUnconfirmed'); return;
      }
      // Review IDs belong to request control, not the reconciliation display.
      setResult(report);
      if (dryRun && review) {
        const payload = JSON.parse(body) as Record<string, unknown>;
        reviewed.current = { version, source: selectedSource, body: JSON.stringify({
          ...payload, dryRun: false,
          expectedScope: { actorId: review.actorId, familyId: review.familyId },
        }) };
        setPreviewReady(true);
      }
    } catch {
      if (own === operation.current && version === revision.current)
        setError(dryRun ? "failed" : "writeUnconfirmed");
    } finally {
      if (activeRequest.current === controller) activeRequest.current = null;
      if (own === operation.current) { pending.current = false; setLoading(false); }
    }
  };

  if (ownerChanged || authorityHold === 'scopeChanged' || authorityHold === 'sessionChanged') return <div role="alert" className="card space-y-3 p-5">
    <h1 className="text-title-1">{text('title')}</h1><p>{text('ownerChanged')}</p>
    <p>{text(writing ? 'writeUnconfirmed' : authorityHold === 'sessionChanged' ? 'sessionChanged' : 'scopeChanged')}</p>
    <button ref={reloadControl} type="button" className="btn-primary min-h-[44px]" onClick={() => window.location.reload()}>{text('reloadImports')}</button>
  </div>;

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
            ref={fileInput}
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

        {backendUnavailable && error !== 'reviewUnsupported' && <p role="status" className="text-sm text-muted-foreground">{text('reviewUnsupported')}</p>}
        {error && (
          <div
            role="alert"
            className="rounded-lg border border-[var(--danger-tint)] bg-[var(--danger-tint)] p-3 text-danger-text"
          >
            <p>{text(error)}</p>
            {error === 'invalidExport' && sourceDuplicates.length > 0 && <ul className="mt-2 list-disc space-y-1 pl-5">{sourceDuplicates.map((row, index) => <li key={`${row.collection}:${row.rowIndex}:${index}`}>{text('duplicateSourceId', { collection: row.collection, row: row.rowIndex + 1 })}</li>)}</ul>}
          </div>
        )}

        <button
          type="button"
          disabled={loading || reading || !fileData || backendUnavailable}
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
              disabled={loading || !previewReady || backendUnavailable}
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
            disabled={loading || !confirmed || !previewReady || backendUnavailable}
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
