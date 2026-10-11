"use client";

import * as React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Dialog } from "@/components/ui/dialog";
import { IDEMPOTENCY_HEADER, newIdempotencyKey } from "@/lib/idempotency-key";
import {
  routineStackMessages,
  type RoutineStackMessage,
} from "@/i18n/routine-stack";
import { useTranslation } from "@/i18n";
import type {
  ParentRoutineStackCandidates,
  ParentRoutineStackRead,
} from "@/lib/routine-stack-api";

type Candidate = ParentRoutineStackCandidates["candidates"][number];
type AssignmentOption =
  ParentRoutineStackCandidates["assignmentOptions"][number];

type DraftStep = {
  draftId: string;
  choreId?: string;
  title: string;
  description: string | null;
  assignedTo: string;
  assignedMemberId: string | null;
  dueDate: string;
  frequency: "once" | "daily" | "weekly" | "monthly";
  weeklyDays: number[];
  difficulty: "easy" | "medium" | "hard";
  icon: string | null;
  recurrenceId: string | null;
  isTemplate: boolean;
};

type RoutineEditorMode = "page" | "sheet";
const ROUTINE_STACK_MAX_STEPS = 99;

type RoutineStackEditorProps = {
  familyId: string;
  mode?: RoutineEditorMode;
  onClose?: () => void;
};

class RoutineEditorRequestError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "RoutineEditorRequestError";
    this.status = status;
  }
}

function displayError(error: unknown, fallback: string): string {
  return error instanceof RoutineEditorRequestError ? error.message : fallback;
}

function messageFromBody(body: unknown, fallback: string): string {
  if (!body || typeof body !== "object") return fallback;
  const error = (body as { error?: unknown }).error;
  if (!error || typeof error !== "object") return fallback;
  const message = (error as { message?: unknown }).message;
  return typeof message === "string" && message.trim() ? message : fallback;
}

async function requestJson<T>(
  url: string,
  init: RequestInit | undefined,
  fallback: string,
): Promise<T> {
  const response = await fetch(url, {
    ...init,
    credentials: "same-origin",
    cache: "no-store",
  });
  const body = (await response.json().catch(() => null)) as unknown;
  if (!response.ok) {
    throw new RoutineEditorRequestError(
      response.status,
      messageFromBody(body, fallback),
    );
  }
  return body as T;
}

function todayDate(): string {
  return new Date().toISOString().slice(0, 10);
}

function dateOnly(value: string): string {
  return value.slice(0, 10);
}

function safeDifficulty(
  value: string | null | undefined,
): DraftStep["difficulty"] {
  return value === "easy" || value === "hard" ? value : "medium";
}

function safeFrequency(value: string | undefined): DraftStep["frequency"] {
  return value === "daily" || value === "weekly" || value === "monthly"
    ? value
    : "once";
}

function fromCandidate(candidate: Candidate, draftId: string): DraftStep {
  return {
    draftId,
    choreId: candidate.id,
    title: candidate.title,
    description: candidate.description,
    assignedTo: candidate.assigned_to,
    assignedMemberId: candidate.assigned_member_id,
    dueDate: dateOnly(candidate.due_date),
    frequency: safeFrequency(candidate.frequency),
    weeklyDays: [...(candidate.weekly_days ?? [])],
    difficulty: safeDifficulty(candidate.difficulty),
    icon: candidate.icon,
    recurrenceId: candidate.recurrence_id,
    isTemplate: candidate.is_template,
  };
}

function fromReadStep(
  step: ParentRoutineStackRead["steps"][number],
  draftId: string,
): DraftStep {
  return {
    draftId,
    choreId: step.id,
    title: step.title,
    description: step.description,
    assignedTo: step.assigned_to,
    assignedMemberId: step.assigned_member_id,
    dueDate: dateOnly(step.due_date),
    frequency: safeFrequency(step.frequency),
    weeklyDays: [...(step.weekly_days ?? [])],
    difficulty: safeDifficulty(step.difficulty),
    icon: step.icon,
    recurrenceId: step.recurrence_id,
    isTemplate: step.is_template,
  };
}

export default function RoutineStackEditor({
  familyId,
  mode = "page",
  onClose,
}: RoutineStackEditorProps) {
  const router = useRouter();
  const params = useSearchParams();
  const { t } = useTranslation();
  const msg = React.useCallback(
    (key: RoutineStackMessage, params?: Record<string, string | number>) =>
      t(key, params, routineStackMessages),
    [t],
  );
  const msgRef = React.useRef(msg);
  msgRef.current = msg;
  const occurrenceDate = dateOnly(params.get("occurrence_date") || todayDate());
  const requestedStackId = params.get("stack_id");
  const [stackId, setStackId] = React.useState<string | null>(requestedStackId);
  const [label, setLabel] = React.useState("");
  const [fingerprint, setFingerprint] = React.useState("");
  const [steps, setSteps] = React.useState<DraftStep[]>([]);
  const [removeChoreIds, setRemoveChoreIds] = React.useState<string[]>([]);
  const [candidates, setCandidates] = React.useState<Candidate[]>([]);
  const [assignmentOptions, setAssignmentOptions] = React.useState<
    AssignmentOption[]
  >([]);
  const [nextCursor, setNextCursor] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [loadingMore, setLoadingMore] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [loadError, setLoadError] = React.useState<string | null>(null);
  const [saveError, setSaveError] = React.useState<string | null>(null);
  const [newTitle, setNewTitle] = React.useState("");
  const [newAssignee, setNewAssignee] = React.useState("");
  const [reloadVersion, setReloadVersion] = React.useState(0);
  const labelRef = React.useRef<HTMLInputElement>(null);
  const idempotencyKeyRef = React.useRef<string | null>(null);
  const savingRef = React.useRef(false);
  const draftIdRef = React.useRef(0);
  const initialIdsRef = React.useRef<Set<string>>(new Set());

  const newDraftId = React.useCallback(() => {
    draftIdRef.current += 1;
    return `draft-${draftIdRef.current}`;
  }, []);

  React.useEffect(() => {
    const controller = new AbortController();
    let active = true;
    setLoading(true);
    setLoadError(null);
    setSaveError(null);
    setNextCursor(null);
    setCandidates([]);
    setAssignmentOptions([]);
    setSteps([]);
    setRemoveChoreIds([]);
    setFingerprint("");
    setStackId(requestedStackId);

    const load = async () => {
      try {
        const candidateUrl = new URL(
          "/api/chores/stacks/candidates",
          window.location.origin,
        );
        candidateUrl.searchParams.set("occurrence_date", occurrenceDate);
        const requests: [
          Promise<ParentRoutineStackCandidates>,
          Promise<ParentRoutineStackRead> | null,
        ] = [
          requestJson<ParentRoutineStackCandidates>(
            candidateUrl.toString(),
            { signal: controller.signal },
            msgRef.current("loadError"),
          ),
          requestedStackId
            ? requestJson<ParentRoutineStackRead>(
                `/api/chores/stacks?stack_id=${encodeURIComponent(requestedStackId)}&occurrence_date=${encodeURIComponent(occurrenceDate)}`,
                { signal: controller.signal },
                msgRef.current("loadError"),
              )
            : null,
        ];
        const [candidateResult, stackResult] = await Promise.all(requests);
        if (!active) return;
        const stack = stackResult;
        setCandidates(candidateResult.candidates);
        setAssignmentOptions(candidateResult.assignmentOptions);
        setNextCursor(candidateResult.nextCursor);
        setStackId(stack?.stack.id ?? requestedStackId);
        setLabel(stack?.stack.label ?? msg("newTitle"));
        setFingerprint(stack?.fingerprint ?? "");
        const loadedSteps = stack
          ? stack.steps.map((step) => fromReadStep(step, step.id))
          : [];
        initialIdsRef.current = new Set(
          loadedSteps.flatMap((step) => (step.choreId ? [step.choreId] : [])),
        );
        setSteps(loadedSteps);
      } catch (error) {
        if (
          !active ||
          (error instanceof DOMException && error.name === "AbortError")
        )
          return;
        setLoadError(displayError(error, msgRef.current("loadError")));
      } finally {
        if (active) setLoading(false);
      }
    };
    void load();
    return () => {
      active = false;
      controller.abort();
    };
    // The locale callback is read through msgRef so a language switch never
    // reloads the server data and discards an in-progress draft.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [occurrenceDate, reloadVersion, requestedStackId]);

  React.useEffect(() => {
    if (!newAssignee && assignmentOptions[0])
      setNewAssignee(assignmentOptions[0].accountId);
  }, [assignmentOptions, newAssignee]);

  const loadMore = async () => {
    if (!nextCursor || loadingMore) return;
    setLoadingMore(true);
    setLoadError(null);
    try {
      const url = new URL(
        "/api/chores/stacks/candidates",
        window.location.origin,
      );
      url.searchParams.set("occurrence_date", occurrenceDate);
      url.searchParams.set("cursor", nextCursor);
      const result = await requestJson<ParentRoutineStackCandidates>(
        url.toString(),
        undefined,
        msg("loadError"),
      );
      setCandidates((current) => [...current, ...result.candidates]);
      setNextCursor(result.nextCursor);
      if (result.assignmentOptions.length)
        setAssignmentOptions(result.assignmentOptions);
    } catch (error) {
      setLoadError(displayError(error, msg("loadError")));
    } finally {
      setLoadingMore(false);
    }
  };

  const addCandidate = (candidate: Candidate) => {
    if (steps.some((step) => step.choreId === candidate.id)) return;
    setSteps((current) => [...current, fromCandidate(candidate, newDraftId())]);
    setRemoveChoreIds((current) => current.filter((id) => id !== candidate.id));
  };

  const addNewStep = () => {
    const title = newTitle.trim();
    if (!title || !newAssignee) {
      setSaveError(!title ? msg("titleRequired") : msg("assignmentRequired"));
      return;
    }
    setSteps((current) => [
      ...current,
      {
        draftId: newDraftId(),
        title,
        description: null,
        assignedTo: newAssignee,
        assignedMemberId: null,
        dueDate: occurrenceDate,
        frequency: "once",
        weeklyDays: [],
        difficulty: "medium",
        icon: null,
        recurrenceId: null,
        isTemplate: false,
      },
    ]);
    setNewTitle("");
    setSaveError(null);
  };

  const removeStep = (step: DraftStep) => {
    if (steps.length <= 1) {
      setSaveError(msg("oneStepRequired"));
      return;
    }
    setSteps((current) =>
      current.filter((item) => item.draftId !== step.draftId),
    );
    if (step.choreId && initialIdsRef.current.has(step.choreId)) {
      setRemoveChoreIds((current) =>
        current.includes(step.choreId!) ? current : [...current, step.choreId!],
      );
    }
  };

  const moveStep = (index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= steps.length) return;
    setSteps((current) => {
      const copy = [...current];
      const [item] = copy.splice(index, 1);
      copy.splice(target, 0, item);
      return copy;
    });
  };

  const changeAssignment = (draftId: string, assignedTo: string) => {
    setSteps((current) =>
      current.map((step) =>
        step.draftId === draftId
          ? {
              ...step,
              assignedTo,
              assignedMemberId:
                step.assignedTo === assignedTo ? step.assignedMemberId : null,
            }
          : step,
      ),
    );
  };

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    if (saving || savingRef.current) return;
    if (!label.trim() || steps.length === 0) {
      setSaveError(
        steps.length === 0 ? msg("oneStepRequired") : msg("labelRequired"),
      );
      return;
    }
    const key = idempotencyKeyRef.current ?? newIdempotencyKey();
    idempotencyKeyRef.current = key;
    savingRef.current = true;
    setSaving(true);
    setSaveError(null);
    const body = {
      scope: "occurrence" as const,
      family_id: familyId,
      stack_id: stackId,
      occurrence_date: occurrenceDate,
      label: label.trim(),
      steps: steps.map((step) => ({
        ...(step.choreId ? { chore_id: step.choreId } : { title: step.title }),
        description: step.description,
        assigned_to: step.assignedTo,
        assigned_member_id: step.assignedMemberId,
        due_date: step.dueDate,
        frequency: step.frequency,
        weekly_days: step.weeklyDays,
        difficulty: step.difficulty,
        icon: step.icon,
        recurrence_id: step.recurrenceId,
        is_template: step.isTemplate,
      })),
      remove_chore_ids: removeChoreIds,
      expected_fingerprint: fingerprint,
    };
    try {
      await requestJson(
        "/api/chores/stacks",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            [IDEMPOTENCY_HEADER]: key,
          },
          body: JSON.stringify(body),
        },
        msg("networkError"),
      );
      router.refresh();
      if (onClose) onClose();
      else router.back();
    } catch (error) {
      if (error instanceof RoutineEditorRequestError && error.status === 409) {
        setSaveError(msg("conflict"));
      } else {
        setSaveError(displayError(error, msg("networkError")));
      }
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  const handleClose = () => {
    if (saving || savingRef.current) return;
    if (onClose) onClose();
    else router.back();
  };

  const accountNames = React.useMemo(
    () =>
      new Map(
        assignmentOptions.map((option) => [option.accountId, option.name]),
      ),
    [assignmentOptions],
  );
  const allCandidatesAdded =
    candidates.length > 0 &&
    candidates.every((candidate) =>
      steps.some((step) => step.choreId === candidate.id),
    );
  const title = stackId ? msg("title") : msg("newTitle");
  const content = (
    <form
      onSubmit={save}
      className="space-y-5"
      data-testid="routine-stack-editor"
    >
      {loading ? (
        <p role="status" className="py-8 text-center text-label-secondary">
          {msg("loading")}
        </p>
      ) : loadError ? (
        <div className="space-y-3" role="alert">
          <h3 className="text-title-3 text-label-primary">
            {msg("loadErrorTitle")}
          </h3>
          <p className="text-body text-label-secondary">{loadError}</p>
          <button
            type="button"
            className="btn-tinted min-h-[44px]"
            onClick={() => setReloadVersion((value) => value + 1)}
          >
            {msg("retry")}
          </button>
        </div>
      ) : (
        <>
          <div>
            <label
              htmlFor="routine-label"
              className="mb-2 block text-footnote font-medium text-label-secondary"
            >
              {msg("label")}
            </label>
            <input
              ref={labelRef}
              id="routine-label"
              value={label}
              onChange={(event) => {
                setLabel(event.target.value);
              }}
              className="input-field w-full min-h-[44px]"
              placeholder={msg("labelPlaceholder")}
              maxLength={200}
            />
          </div>

          <section
            aria-labelledby="routine-steps-heading"
            className="space-y-3"
          >
            <div className="flex items-center justify-between gap-3">
              <h3
                id="routine-steps-heading"
                className="text-title-3 text-label-primary"
              >
                {msg("steps")}
              </h3>
              <span className="text-footnote text-label-secondary">
                {steps.length}/{ROUTINE_STACK_MAX_STEPS}
              </span>
            </div>
            {steps.length === 0 && (
              <p className="rounded-xl bg-[var(--surface-fill-secondary)] p-3 text-body text-label-secondary">
                {msg("oneStepRequired")}
              </p>
            )}
            <ol className="space-y-3">
              {steps.map((step, index) => (
                <li
                  key={step.draftId}
                  className="rounded-xl border border-[var(--surface-separator)] bg-[var(--surface-fill-secondary)] p-3"
                >
                  <div className="flex items-start gap-3">
                    <span
                      aria-hidden="true"
                      className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-[var(--accent-fill)] text-body font-semibold text-white"
                    >
                      {index + 1}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="text-body font-medium text-label-primary [overflow-wrap:anywhere]">
                        {step.title}
                      </p>
                      <p className="text-footnote text-label-secondary">
                        {step.choreId && initialIdsRef.current.has(step.choreId)
                          ? msg("existing")
                          : msg("drafted")}{" "}
                        · {step.dueDate}
                      </p>
                      <label
                        htmlFor={`routine-assignee-${step.draftId}`}
                        className="sr-only"
                      >
                        {msg("assignedTo")}: {step.title}
                      </label>
                      <select
                        id={`routine-assignee-${step.draftId}`}
                        value={step.assignedTo}
                        onChange={(event) =>
                          changeAssignment(step.draftId, event.target.value)
                        }
                        className="input-field mt-2 min-h-[44px] w-full"
                      >
                        {assignmentOptions.map((option) => (
                          <option
                            key={option.accountId}
                            value={option.accountId}
                          >
                            {option.name} · {option.role}
                          </option>
                        ))}
                        {!assignmentOptions.some(
                          (option) => option.accountId === step.assignedTo,
                        ) && (
                          <option value={step.assignedTo}>
                            {accountNames.get(step.assignedTo) ??
                              step.assignedTo}
                          </option>
                        )}
                      </select>
                    </div>
                    <div className="flex shrink-0 flex-col gap-1">
                      <button
                        type="button"
                        className="min-h-[44px] min-w-[44px] rounded-lg text-label-secondary underline disabled:opacity-40"
                        disabled={index === 0 || saving}
                        onClick={() => moveStep(index, -1)}
                        aria-label={msg("moveUp", { title: step.title })}
                      >
                        ↑
                      </button>
                      <button
                        type="button"
                        className="min-h-[44px] min-w-[44px] rounded-lg text-label-secondary underline disabled:opacity-40"
                        disabled={index === steps.length - 1 || saving}
                        onClick={() => moveStep(index, 1)}
                        aria-label={msg("moveDown", { title: step.title })}
                      >
                        ↓
                      </button>
                    </div>
                  </div>
                  <button
                    type="button"
                    className="mt-2 min-h-[44px] text-footnote text-label-secondary underline disabled:opacity-40"
                    disabled={steps.length <= 1 || saving}
                    onClick={() => removeStep(step)}
                  >
                    {msg("remove", { title: step.title })}
                  </button>
                </li>
              ))}
            </ol>
          </section>

          <section
            aria-labelledby="routine-candidates-heading"
            className="space-y-3"
          >
            <h3
              id="routine-candidates-heading"
              className="text-title-3 text-label-primary"
            >
              {msg("candidates")}
            </h3>
            {candidates.length === 0 ? (
              <p className="text-body text-label-secondary">
                {msg("noCandidates")}
              </p>
            ) : (
              <ul className="divide-y divide-[var(--surface-separator)] rounded-xl bg-[var(--surface-fill-secondary)]">
                {candidates.map((candidate) => {
                  const added = steps.some(
                    (step) => step.choreId === candidate.id,
                  );
                  return (
                    <li
                      key={candidate.id}
                      className="flex items-center gap-3 p-3"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="text-body text-label-primary [overflow-wrap:anywhere]">
                          {candidate.title}
                        </p>
                        <p className="text-footnote text-label-secondary">
                          {accountNames.get(candidate.assigned_to) ??
                            candidate.assigned_to}{" "}
                          · {candidate.due_date.slice(0, 10)}
                        </p>
                      </div>
                      <button
                        type="button"
                        className="btn-tinted min-h-[44px] shrink-0"
                        disabled={added || saving}
                        onClick={() => addCandidate(candidate)}
                      >
                        {added ? msg("added") : msg("addExisting")}
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
            {allCandidatesAdded && (
              <p className="text-footnote text-label-secondary">
                {msg("allCandidatesAdded")}
              </p>
            )}
            {nextCursor && (
              <button
                type="button"
                className="min-h-[44px] text-body text-[var(--accent-text)] underline"
                disabled={loadingMore || saving}
                onClick={() => void loadMore()}
              >
                {loadingMore ? msg("loading") : msg("moreCandidates")}
              </button>
            )}
          </section>

          <section
            aria-labelledby="routine-new-step-heading"
            className="space-y-3 rounded-xl border border-[var(--surface-separator)] p-3"
          >
            <h3
              id="routine-new-step-heading"
              className="text-title-3 text-label-primary"
            >
              {msg("newStep")}
            </h3>
            <label htmlFor="routine-new-title" className="sr-only">
              {msg("stepTitle")}
            </label>
            <input
              id="routine-new-title"
              value={newTitle}
              onChange={(event) => setNewTitle(event.target.value)}
              className="input-field w-full min-h-[44px]"
              placeholder={msg("stepTitlePlaceholder")}
              maxLength={200}
            />
            <label htmlFor="routine-new-assignee" className="sr-only">
              {msg("assignedTo")}
            </label>
            <select
              id="routine-new-assignee"
              value={newAssignee}
              onChange={(event) => setNewAssignee(event.target.value)}
              className="input-field w-full min-h-[44px]"
              disabled={assignmentOptions.length === 0}
            >
              {assignmentOptions.length === 0 && (
                <option value="">{msg("noAssignments")}</option>
              )}
              {assignmentOptions.map((option) => (
                <option key={option.accountId} value={option.accountId}>
                  {option.name} · {option.role}
                </option>
              ))}
            </select>
            <button
              type="button"
              className="btn-tinted min-h-[44px]"
              disabled={
                !newTitle.trim() ||
                !newAssignee ||
                steps.length >= ROUTINE_STACK_MAX_STEPS ||
                saving
              }
              onClick={addNewStep}
            >
              {msg("addStep")}
            </button>
          </section>

          {saveError && (
            <div
              role="alert"
              className="rounded-xl bg-[var(--surface-fill-secondary)] p-3 text-body text-label-primary"
            >
              {saveError}
            </div>
          )}
          <div className="flex flex-wrap gap-3 border-t border-[var(--surface-separator)] pt-4">
            <button
              type="submit"
              className="btn-filled min-h-[44px] flex-1"
              disabled={saving || steps.length === 0 || !label.trim()}
            >
              {saving ? msg("saving") : msg("save")}
            </button>
            {mode === "page" && (
              <button
                type="button"
                className="btn-tinted min-h-[44px] flex-1"
                disabled={saving}
                onClick={handleClose}
              >
                {msg("cancel")}
              </button>
            )}
          </div>
        </>
      )}
    </form>
  );

  if (mode === "sheet") {
    return (
      <Dialog
        open
        variant="form"
        title={title}
        description={msg("description")}
        onClose={saving ? undefined : handleClose}
        closeLabel={msg("close")}
        initialFocusRef={labelRef}
        testId="routine-stack-sheet"
      >
        {content}
      </Dialog>
    );
  }

  return (
    <main className="mx-auto w-full max-w-3xl px-4 pb-24 pt-6">
      <div className="mb-6">
        <p className="text-footnote uppercase tracking-wide text-label-secondary">
          {msg("occurrence")} · {occurrenceDate}
        </p>
        <h1 className="mt-1 text-title-1 text-label-primary">{title}</h1>
        <p className="mt-2 text-body text-label-secondary">
          {msg("description")}
        </p>
      </div>
      {content}
    </main>
  );
}
