"use client";

/**
 * "Import from text or photo" (#270): paste the text of a flyer or email, or
 * choose a photo or PDF of it; the event reader suggests events
 * (POST /api/calendar/import-suggestions, which writes nothing); the person
 * reviews and edits them, then adds the ticked ones in one request to
 * POST /api/calendar/import-suggestions/commit. That route creates them in
 * one transaction under an `Idempotency-Key` kept for this exact batch until
 * it has a definite answer, so a retry after a lost response replays the
 * original result instead of adding the events twice. Its undo token is
 * handed to the page for the "Added N events" Undo.
 *
 * Built on the shared `Dialog` (aria-modal, focus moved in, Tab kept inside,
 * Escape closes, focus restored to the opener on close). Focus follows each
 * step so it never falls back to <body>.
 *
 * Suggestions are untrusted model text: they are only ever rendered as React
 * text and input values. Confidence is shown in words, never colour alone.
 */
import * as React from "react";
import { useTranslation } from "@/i18n";
import {
  calendarImportEnglish,
  calendarImportMessages,
  type CalendarImportMessage,
  type CalendarImportError,
} from "@/i18n/calendar-import";
import { FileText, Loader2, Sparkles } from "lucide-react";
import { Dialog } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { IDEMPOTENCY_HEADER, newIdempotencyKey } from "@/lib/idempotency-key";
import {
  IMPORT_IMAGE_MAX_BYTES,
  IMPORT_PDF_MAX_BYTES,
  IMPORT_TEXT_MAX_CHARS,
  confidenceCategory,
  importValidationKey,
  deviceTimeZone,
  deviceToday,
  draftToEventBody,
  toDrafts,
  type EventCreateBody,
  type ImportCommitResult,
  type ImportDraft,
  type ImportSuggestion,
} from "@/lib/event-import-client";

/** Longest edge sent to the provider; larger photos are downscaled in the browser when it can decode them. */
const MAX_EDGE = 1568;

export const UNREADABLE_MESSAGE = calendarImportEnglish.unreadable;

type Mode = "text" | "file";
type Phase =
  | { step: "input" }
  | { step: "reading" }
  | { step: "review" }
  | { step: "error"; message: CalendarImportError };

/** Downscale to MAX_EDGE as JPEG where the browser can decode the photo; otherwise send it unchanged. */
async function prepareImage(file: Blob): Promise<Blob> {
  if (
    typeof createImageBitmap !== "function" ||
    typeof document === "undefined"
  )
    return file;
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
    if (
      scale === 1 &&
      file.size <= 4 * 1024 * 1024 &&
      /^image\/(jpeg|png|webp)$/.test(file.type)
    ) {
      bitmap.close?.();
      return file;
    }
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const ctx = canvas.getContext("2d");
    if (!ctx) return file;
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close?.();
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", 0.85),
    );
    return blob ?? file;
  } catch {
    return file;
  }
}

async function errorMessage(res: Response): Promise<string | null> {
  try {
    const body = await res.json();
    const err = body?.error;
    if (typeof err === "string") return err;
    if (err && typeof err.message === "string") return err.message;
  } catch {
    // fall through
  }
  return null;
}

async function readError(res: Response): Promise<CalendarImportError> {
  const message = await errorMessage(res);
  if (res.status === 404) return { key: "unavailable" };
  if (res.status === 403)
    return message !== null ? { raw: message } : { key: "forbidden" };
  if ([400, 411, 413, 415, 429, 502].includes(res.status) && message)
    return { raw: message };
  return { key: "readFailed" };
}

export interface ImportEventsDialogProps {
  onClose: () => void;
  /** Called once the reviewed events were added (201 or a replay of it). */
  onDone: (result: ImportCommitResult) => void;
}

export function ImportEventsDialog({
  onClose,
  onDone,
}: ImportEventsDialogProps) {
  const { t } = useTranslation();
  const msg = (
    key: CalendarImportMessage,
    params?: Record<string, string | number>,
  ) => t(key, params, calendarImportMessages);
  const errorText = (error: CalendarImportError) =>
    "raw" in error ? error.raw : msg(error.key);
  const [mode, setMode] = React.useState<Mode>("text");
  const [text, setText] = React.useState("");
  const [phase, setPhase] = React.useState<Phase>({ step: "input" });
  const [drafts, setDrafts] = React.useState<ImportDraft[]>([]);
  const [timeZone, setTimeZone] = React.useState<string>("America/Toronto");
  const [adding, setAdding] = React.useState(false);
  const [addError, setAddError] = React.useState<CalendarImportError | null>(
    null,
  );
  const titleId = React.useId();
  const fileRef = React.useRef<HTMLInputElement>(null);
  // One Idempotency-Key per batch: kept while the same bodies are retried,
  // replaced as soon as the batch changes or gets a definite answer.
  const pending = React.useRef<{ key: string; batch: string } | null>(null);

  // Focus target of the current step. Dialog focuses the first one on open;
  // after that, focus follows every step change so it never falls to <body>.
  const stepFocusRef = React.useRef<HTMLElement | null>(null);
  const setStepFocus = React.useCallback((el: HTMLElement | null) => {
    if (el) stepFocusRef.current = el;
  }, []);
  const opened = React.useRef(false);
  React.useEffect(() => {
    if (!opened.current) {
      opened.current = true;
      return;
    }
    stepFocusRef.current?.focus();
  }, [phase.step]);

  const close = () => {
    if (adding) return;
    onClose();
  };

  const startOver = () => {
    setPhase({ step: "input" });
    setDrafts([]);
    setAddError(null);
    pending.current = null;
    if (fileRef.current) fileRef.current.value = "";
  };

  const request = async (init: RequestInit) => {
    setPhase({ step: "reading" });
    setAddError(null);
    try {
      const res = await fetch("/api/calendar/import-suggestions", {
        method: "POST",
        ...init,
      });
      if (!res.ok) {
        setPhase({ step: "error", message: await readError(res) });
        return;
      }
      const body = await res.json();
      const suggestions = Array.isArray(body?.suggestions)
        ? (body.suggestions as ImportSuggestion[])
        : [];
      if (typeof body?.timeZone === "string") setTimeZone(body.timeZone);
      // `unreadable: true` always comes with no suggestions; both show UNREADABLE_MESSAGE.
      setDrafts(toDrafts(suggestions));
      pending.current = null;
      setPhase({ step: "review" });
    } catch {
      setPhase({ step: "error", message: { key: "readConnection" } });
    }
  };

  const submitText = async () => {
    const value = text.trim();
    if (!value) return;
    await request({
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text: value,
        today: deviceToday(),
        timeZone: deviceTimeZone(),
      }),
    });
  };

  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const isPdf = file.type === "application/pdf" || /\.pdf$/i.test(file.name);
    let upload: Blob = file;
    if (isPdf) {
      if (file.size > IMPORT_PDF_MAX_BYTES) {
        setPhase({ step: "error", message: { key: "pdfLarge" } });
        return;
      }
    } else {
      setPhase({ step: "reading" });
      upload = await prepareImage(file);
      if (upload.size > IMPORT_IMAGE_MAX_BYTES) {
        setPhase({ step: "error", message: { key: "photoLarge" } });
        return;
      }
    }
    const form = new FormData();
    form.append("file", upload, isPdf ? "flyer.pdf" : "flyer.jpg");
    form.append("today", deviceToday());
    const zone = deviceTimeZone();
    if (zone) form.append("timeZone", zone);
    await request({ body: form });
    if (fileRef.current) fileRef.current.value = "";
  };

  const update = (key: string, patch: Partial<ImportDraft>) =>
    setDrafts((prev) =>
      prev.map((d) => (d.key === key ? { ...d, ...patch, error: null } : d)),
    );

  const selected = drafts.filter((d) => d.include);

  const addSelected = async () => {
    if (adding) return;
    setAddError(null);
    // Validate every ticked card first; nothing is sent while one is wrong.
    const events: EventCreateBody[] = [];
    let invalid = false;
    const checked = drafts.map((d) => {
      if (!d.include) return d;
      const result = draftToEventBody(d, timeZone);
      if (!result.ok) {
        invalid = true;
        return { ...d, error: result.error };
      }
      events.push(result.body);
      return d;
    });
    if (invalid || events.length === 0) {
      setDrafts(checked);
      setAddError({ key: "fix" });
      return;
    }

    const batch = JSON.stringify(events);
    if (!pending.current || pending.current.batch !== batch)
      pending.current = { key: newIdempotencyKey(), batch };
    setAdding(true);
    try {
      const res = await fetch("/api/calendar/import-suggestions/commit", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          [IDEMPOTENCY_HEADER]: pending.current.key,
        },
        body: JSON.stringify({ events }),
      });
      if (res.ok) {
        const body = (await res.json()) as ImportCommitResult;
        pending.current = null;
        setAdding(false);
        onDone(body);
        return;
      }
      const message = await errorMessage(res);
      // Retryable: keep the key so the retry replays instead of adding twice.
      const retryable =
        res.status >= 500 || res.status === 409 || res.status === 429;
      if (!retryable) pending.current = null;
      setAddError(
        retryable
          ? { key: "addRetry" }
          : message !== null
            ? { raw: message }
            : { key: "addFailed" },
      );
    } catch {
      setAddError({ key: "addConnection" });
    }
    setAdding(false);
  };

  const tab = (value: Mode, label: string) => (
    <button
      type="button"
      role="tab"
      aria-selected={mode === value}
      onClick={() => setMode(value)}
      className={cn(
        "flex-1 min-h-[44px] rounded-md px-3 text-subhead font-medium",
        mode === value
          ? "bg-[var(--surface-elevated)] text-label-primary shadow-sm"
          : "text-label-secondary",
      )}
    >
      {label}
    </button>
  );

  return (
    <Dialog
      open
      onClose={close}
      title={msg("title")}
      closeLabel={msg("close")}
      testId="import-dialog"
      className="sm:max-w-xl"
      initialFocusRef={stepFocusRef}
    >
      <div aria-busy={phase.step === "reading" || adding} className="space-y-4">
        {/* Stays mounted (visually hidden) so "Choose a photo or PDF" works from every step. */}
        <input
          ref={fileRef}
          data-testid="import-file-input"
          type="file"
          accept="image/*,application/pdf"
          onChange={onFile}
          className="sr-only"
          tabIndex={-1}
          aria-hidden="true"
        />

        {phase.step === "input" && (
          <div className="space-y-4">
            <p className="text-body text-label-primary">{msg("intro")}</p>
            <div
              role="tablist"
              aria-label={msg("from")}
              className="flex bg-[var(--surface-fill)] rounded-lg p-1 gap-1"
            >
              {tab("text", msg("paste"))}
              {tab("file", msg("file"))}
            </div>
            {mode === "text" ? (
              <div className="space-y-3">
                <label htmlFor={`${titleId}-text`} className="label-apple">
                  {msg("textLabel")}
                </label>
                <textarea
                  ref={setStepFocus}
                  id={`${titleId}-text`}
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  maxLength={IMPORT_TEXT_MAX_CHARS}
                  rows={8}
                  className="input-apple w-full min-h-[160px]"
                  placeholder={msg("placeholder")}
                />
                <button
                  type="button"
                  className="btn-filled w-full min-h-[44px]"
                  onClick={submitText}
                  disabled={!text.trim()}
                >
                  <Sparkles className="w-4 h-4" aria-hidden="true" />
                  <span>{msg("find")}</span>
                </button>
              </div>
            ) : (
              <button
                ref={setStepFocus}
                type="button"
                className="btn-tinted w-full min-h-[44px]"
                onClick={() => fileRef.current?.click()}
              >
                <FileText className="w-4 h-4" aria-hidden="true" />
                <span>{msg("choose")}</span>
              </button>
            )}
            <p
              className="text-footnote text-label-secondary"
              data-testid="import-privacy-note"
            >
              {msg("privacy")}
            </p>
          </div>
        )}

        {phase.step === "reading" && (
          <div
            ref={setStepFocus}
            tabIndex={-1}
            role="status"
            className="flex items-center gap-3 py-6 justify-center text-body text-label-primary outline-none"
          >
            <Loader2
              className="w-5 h-5 animate-spin motion-reduce:animate-none"
              aria-hidden="true"
            />
            <span>{msg("reading")}</span>
          </div>
        )}

        {phase.step === "error" && (
          <div className="space-y-4">
            <p
              role="alert"
              className="text-body text-[var(--danger-text)]"
              data-testid="import-error"
            >
              {errorText(phase.message)}
            </p>
            <button
              ref={setStepFocus}
              type="button"
              className="btn-tinted w-full min-h-[44px]"
              onClick={startOver}
            >
              {msg("retry")}
            </button>
          </div>
        )}

        {phase.step === "review" &&
          (drafts.length === 0 ? (
            <div className="space-y-4">
              <p
                className="text-body text-label-primary"
                role="status"
                data-testid="import-empty"
              >
                {msg("unreadable")}
              </p>
              <button
                ref={setStepFocus}
                type="button"
                className="btn-tinted w-full min-h-[44px]"
                onClick={startOver}
              >
                {msg("retry")}
              </button>
            </div>
          ) : (
            <>
              <p
                ref={setStepFocus}
                tabIndex={-1}
                className="text-subhead text-label-secondary outline-none"
                role="status"
              >
                {msg(drafts.length === 1 ? "foundOne" : "foundMany", {
                  count: drafts.length,
                })}
              </p>
              <ul className="space-y-3" aria-label={msg("suggestions")}>
                {drafts.map((draft, i) => (
                  <SuggestionCard
                    key={draft.key}
                    draft={draft}
                    index={i}
                    idBase={titleId}
                    disabled={adding}
                    onChange={update}
                  />
                ))}
              </ul>
              <div className="sticky -bottom-6 -mx-6 -mb-6 border-t border-[var(--surface-separator)] bg-[var(--surface-elevated)] px-6 py-4 space-y-2">
                {addError && (
                  <p
                    role="alert"
                    className="text-subhead text-[var(--danger-text)]"
                  >
                    {errorText(addError)}
                  </p>
                )}
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    className="btn-plain min-h-[44px] flex-1 min-w-[10rem]"
                    onClick={startOver}
                    disabled={adding}
                  >
                    {msg("startOver")}
                  </button>
                  <button
                    type="button"
                    className="btn-filled min-h-[44px] flex-1 min-w-[10rem]"
                    onClick={addSelected}
                    disabled={adding || selected.length === 0}
                    data-testid="import-add"
                  >
                    {adding
                      ? msg("adding")
                      : msg(selected.length === 1 ? "addOne" : "addMany", {
                          count: selected.length,
                        })}
                  </button>
                </div>
              </div>
            </>
          ))}
      </div>
    </Dialog>
  );
}

function SuggestionCard({
  draft,
  index,
  idBase,
  disabled,
  onChange,
}: {
  draft: ImportDraft;
  index: number;
  idBase: string;
  disabled: boolean;
  onChange: (key: string, patch: Partial<ImportDraft>) => void;
}) {
  const { t } = useTranslation();
  const msg = (
    key: CalendarImportMessage,
    params?: Record<string, string | number>,
  ) => t(key, params, calendarImportMessages);
  const id = `${idBase}-card${index}`;
  return (
    <li
      data-testid="import-suggestion"
      className={cn(
        "rounded-xl border p-3 space-y-3",
        draft.error
          ? "border-[var(--danger-text)]"
          : "border-[var(--surface-separator)]",
        !draft.include && "opacity-70",
      )}
    >
      <div className="flex items-center gap-3">
        <label className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center -m-2 cursor-pointer">
          <input
            type="checkbox"
            checked={draft.include}
            onChange={(e) => onChange(draft.key, { include: e.target.checked })}
            disabled={disabled}
            className="h-5 w-5 accent-[var(--accent)]"
            aria-label={msg("addNamed", {
              title: draft.title || msg("eventNumber", { number: index + 1 }),
            })}
          />
        </label>
        <div className="flex-1 min-w-0">
          <label htmlFor={`${id}-title`} className="sr-only">
            {msg("eventTitle")}
          </label>
          <input
            id={`${id}-title`}
            type="text"
            value={draft.title}
            onChange={(e) => onChange(draft.key, { title: e.target.value })}
            maxLength={200}
            disabled={disabled}
            className="w-full input-apple"
          />
        </div>
        <span
          className="shrink-0 rounded-full bg-[var(--surface-fill)] px-2 py-0.5 text-footnote font-semibold text-label-secondary"
          data-testid="import-confidence"
        >
          {msg(confidenceCategory(draft.confidence))}
        </span>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div>
          <label
            htmlFor={`${id}-date`}
            className="text-footnote text-label-secondary block mb-1"
          >
            {msg("date")}
          </label>
          <input
            id={`${id}-date`}
            type="date"
            value={draft.date}
            onChange={(e) => onChange(draft.key, { date: e.target.value })}
            disabled={disabled}
            className="w-full input-apple min-h-[44px]"
          />
        </div>
        <label className="flex min-h-[44px] items-end gap-2 pb-2 text-subhead text-label-primary cursor-pointer">
          <input
            type="checkbox"
            checked={draft.allDay}
            onChange={(e) => onChange(draft.key, { allDay: e.target.checked })}
            disabled={disabled}
            className="h-5 w-5 accent-[var(--accent)]"
          />
          {msg("allDay")}
        </label>
        {!draft.allDay && (
          <>
            <div>
              <label
                htmlFor={`${id}-start`}
                className="text-footnote text-label-secondary block mb-1"
              >
                {msg("starts")}
              </label>
              <input
                id={`${id}-start`}
                type="time"
                value={draft.startTime}
                onChange={(e) =>
                  onChange(draft.key, { startTime: e.target.value })
                }
                disabled={disabled}
                className="w-full input-apple min-h-[44px]"
              />
            </div>
            <div>
              <label
                htmlFor={`${id}-end`}
                className="text-footnote text-label-secondary block mb-1"
              >
                {msg("ends")}
              </label>
              <input
                id={`${id}-end`}
                type="time"
                value={draft.endTime}
                onChange={(e) =>
                  onChange(draft.key, { endTime: e.target.value })
                }
                disabled={disabled}
                className="w-full input-apple min-h-[44px]"
              />
            </div>
          </>
        )}
        <div className="col-span-2 sm:col-span-1">
          <label
            htmlFor={`${id}-end-date`}
            className="text-footnote text-label-secondary block mb-1"
          >
            {msg("lastDay")}
          </label>
          <input
            id={`${id}-end-date`}
            type="date"
            value={draft.endDate}
            min={draft.date || undefined}
            onChange={(e) => onChange(draft.key, { endDate: e.target.value })}
            disabled={disabled}
            className="w-full input-apple min-h-[44px]"
          />
        </div>
      </div>

      <div>
        <label
          htmlFor={`${id}-location`}
          className="text-footnote text-label-secondary block mb-1"
        >
          {msg("location")}
        </label>
        <input
          id={`${id}-location`}
          type="text"
          value={draft.location}
          onChange={(e) => onChange(draft.key, { location: e.target.value })}
          maxLength={200}
          disabled={disabled}
          className="w-full input-apple"
        />
      </div>
      <div>
        <label
          htmlFor={`${id}-notes`}
          className="text-footnote text-label-secondary block mb-1"
        >
          {msg("notes")}
        </label>
        <textarea
          id={`${id}-notes`}
          value={draft.notes}
          onChange={(e) => onChange(draft.key, { notes: e.target.value })}
          maxLength={1000}
          rows={2}
          disabled={disabled}
          className="w-full input-apple resize-none"
        />
      </div>

      {draft.error && (
        <p
          className="text-footnote text-[var(--danger-text)]"
          data-testid="import-card-error"
        >
          {importValidationKey(draft.error)
            ? msg(importValidationKey(draft.error)!)
            : draft.error}
        </p>
      )}
    </li>
  );
}
