"use client";

import * as React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { z } from "zod";
import { Dialog } from "@/components/ui/dialog";
import { toDateOnlyLocal } from "@/lib/dates";
import { IDEMPOTENCY_HEADER, newIdempotencyKey } from "@/lib/idempotency-key";
import { ROUTINE_NAME_MAX } from "@/lib/routine-icons";
import {
  routineStackMessages,
  type RoutineStackMessage,
} from "@/i18n/routine-stack";
import { useTranslation } from "@/i18n";

type Candidate = ParsedCandidates["candidates"][number];
type AssignmentOption = ParsedCandidates["assignmentOptions"][number];

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
  expectedFingerprint: string | null;
};

type RoutineEditorMode = "page" | "sheet";
const ROUTINE_STACK_MAX_STEPS = 99;

type RoutineStackEditorProps = {
  familyId: string;
  mode?: RoutineEditorMode;
  onClose?: () => void;
};

const ROUTINE_EDITOR_RETURN_PATH = "/dashboard/chores";
const ROUTINE_HISTORY_MARKER = "__familyPlannerRoutineStackEditor";

type RoutineHistoryEntry = {
  token: string;
  url: string;
  baseState: unknown;
  baseStateKey: string;
  sentinelState: Record<string, unknown>;
};

function stateRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : {};
}

function historyStateKey(value: unknown): string {
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}

function ownsCurrentHistoryEntry(entry: RoutineHistoryEntry): boolean {
  if (typeof window === "undefined") return false;
  return (
    window.location.href === entry.url &&
    historyStateKey(window.history.state) === historyStateKey(entry.sentinelState)
  );
}

class RoutineEditorRequestError extends Error {
  readonly status: number;
  readonly code: string | undefined;

  constructor(status: number, message: string, code?: string) {
    super(message);
    this.name = "RoutineEditorRequestError";
    this.status = status;
    this.code = code;
  }
}

function errorCodeFromBody(body: unknown): string | undefined {
  if (!body || typeof body !== "object") return undefined;
  const error = (body as { error?: unknown }).error;
  if (!error || typeof error !== "object") return undefined;
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" && code.trim() ? code : undefined;
}

const candidateSchema = z
  .object({
    id: z.string().min(1),
    title: z.string(),
    description: z.string().nullable(),
    assigned_to: z.string().min(1),
    assigned_member_id: z.string().nullable(),
    due_date: z.string().min(1),
    recurrence_id: z.string().nullable(),
    is_template: z.literal(false),
    routine: z.string().nullable(),
    routine_order: z.number().int().nullable(),
    status: z.string(),
    frequency: z.string(),
    weekly_days: z.array(z.number().int()),
    difficulty: z.string().nullable(),
    icon: z.string().nullable(),
    expected_fingerprint: z.string().min(1),
  })
  .strict();

const assignmentOptionSchema = z
  .object({
    accountId: z.string().min(1),
    name: z.string(),
    role: z.string(),
  })
  .strict();

const candidatesResponseSchema = z
  .object({
    occurrence_date: z.string().min(1),
    candidates: z.array(candidateSchema),
    assignmentOptions: z.array(assignmentOptionSchema),
    hasMore: z.boolean(),
    nextCursor: z.string().nullable(),
  })
  .strict();

const readStepSchema = z
  .object({
    id: z.string().min(1),
    title: z.string(),
    description: z.string().nullable(),
    assigned_to: z.string().min(1),
    assigned_member_id: z.string().nullable(),
    member_subject_erased: z.boolean(),
    due_date: z.string().min(1),
    recurrence_id: z.string().nullable(),
    is_template: z.boolean(),
    routine: z.string().nullable(),
    routine_order: z.number().int().nullable(),
    status: z.string(),
    frequency: z.string(),
    weekly_days: z.array(z.number().int()),
    difficulty: z.string().nullable(),
    icon: z.string().nullable(),
    points: z.number(),
    photo_url: z.string().nullable(),
    photo_verified: z.boolean(),
    verified_at: z.string().nullable(),
    verified_notes: z.string().nullable(),
    completed_at: z.string().nullable(),
  })
  .strict();

const compactResponseSchema = z
  .object({
    stack_id: z.string().min(1),
    version: z.number().int(),
    steps: z.array(
      z.tuple([z.string().min(1), z.number().int(), z.number().int()]),
    ),
    assignments: z.array(z.tuple([z.string().min(1), z.string().nullable()])),
    members: z.array(z.tuple([z.string().min(1), z.string()])),
    fingerprint: z.string(),
  })
  .strict();

const readResponseSchema = z
  .object({
    stack: z
      .object({
        id: z.string().min(1),
        family_id: z.string().min(1),
        label: z.string(),
        version: z.number().int(),
      })
      .strict(),
    occurrence_date: z.string().min(1),
    fingerprint: z.string(),
    steps: z.array(readStepSchema),
    members: z.array(
      z
        .object({
          id: z.string().min(1),
          displayName: z.string(),
          role: z.string(),
          subjectState: z.enum(["eligible", "archived", "erased", "dormant"]),
        })
        .strict(),
    ),
    compact: compactResponseSchema,
  })
  .strict();

type ParsedCandidates = z.infer<typeof candidatesResponseSchema>;
type ParsedRead = z.infer<typeof readResponseSchema>;
type SaveBody = {
  scope: "occurrence";
  family_id: string;
  stack_id: string | null;
  occurrence_date: string;
  label: string;
  steps: Array<Record<string, unknown>>;
  remove_chore_ids: string[];
  expected_fingerprint: string;
};
type SavePacket = Readonly<{ key: string; bytes: string }>;
type Submission = Readonly<{
  phase: "pending" | "unknown" | "conflict";
  packet: SavePacket;
}>;

function localizedRequestError(
  error: unknown,
  msg: (key: RoutineStackMessage) => string,
  fallback: RoutineStackMessage,
): string {
  if (!(error instanceof RoutineEditorRequestError)) return msg(fallback);
  switch (error.code) {
    case "ROUTINE_STACK_CONFLICT":
    case "IDEMPOTENCY_KEY_REUSED":
    case "IDEMPOTENCY_IN_PROGRESS":
    case "IDENTITY_CONFLICT":
      return msg("conflict");
    case "FORBIDDEN":
      return msg("forbidden");
    case "ROUTINE_STACK_NOT_FOUND":
      return msg("notFound");
    case "ROUTINE_STACK_INVALID_DRAFT":
    case "INVALID_JSON":
    case "ROUTINE_STACK_INVALID_LABEL":
    case "ROUTINE_STACK_STEP_TITLE_REQUIRED":
    case "ROUTINE_STACK_INVALID_STEP_DATE":
    case "ROUTINE_STACK_INVALID_DATE":
    case "ROUTINE_STACK_FUTURE_UNSUPPORTED":
    case "ROUTINE_STACK_RECURRENCE_UNSUPPORTED":
    case "ROUTINE_STACK_DUPLICATE_STEP":
    case "ROUTINE_STACK_STEP_DATE_SCOPE":
    case "ROUTINE_STACK_DUPLICATE_WEEKDAY":
    case "ROUTINE_STACK_WEEKDAY_REQUIRED":
    case "ROUTINE_STACK_WEEKDAY_FREQUENCY":
    case "ROUTINE_STACK_DUPLICATE_REMOVE":
    case "ROUTINE_STACK_RESPONSE_TOO_LARGE":
      return msg("invalidDraft");
    default:
      return msg(fallback);
  }
}

async function requestJson<T>(
  url: string,
  init: RequestInit | undefined,
  fallback: string,
  parse: (body: unknown) => T,
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
      fallback,
      errorCodeFromBody(body),
    );
  }
  try {
    return parse(body);
  } catch {
    throw new RoutineEditorRequestError(
      response.status,
      fallback,
      "INVALID_RESPONSE",
    );
  }
}

function todayDate(): string {
  return toDateOnlyLocal(new Date());
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
    expectedFingerprint: candidate.expected_fingerprint,
  };
}

function fromReadStep(
  step: ParsedRead["steps"][number],
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
    expectedFingerprint: null,
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
  const [dirty, setDirty] = React.useState(false);
  const [submission, setSubmission] = React.useState<Submission | null>(null);
  const [discardAction, setDiscardAction] = React.useState<
    "close" | "reload" | null
  >(null);
  const labelRef = React.useRef<HTMLInputElement>(null);
  const discardCancelRef = React.useRef<HTMLButtonElement>(null);
  const idempotencyKeyRef = React.useRef<string | null>(null);
  const submissionRef = React.useRef<Submission | null>(null);
  const dirtyRef = React.useRef(false);
  const savingRef = React.useRef(false);
  const draftIdRef = React.useRef(0);
  const initialIdsRef = React.useRef<Set<string>>(new Set());
  const historyEntryRef = React.useRef<RoutineHistoryEntry | null>(null);
  const releasingHistoryRef = React.useRef<RoutineHistoryEntry | null>(null);
  const afterHistoryReleaseRef = React.useRef<(() => void) | null>(null);

  const newDraftId = React.useCallback(() => {
    draftIdRef.current += 1;
    return `draft-${draftIdRef.current}`;
  }, []);

  const setSubmissionState = React.useCallback((value: Submission | null) => {
    submissionRef.current = value;
    setSubmission(value);
  }, []);

  const armHistorySentinel = React.useCallback(() => {
    if (typeof window === "undefined" || historyEntryRef.current) return;
    const token = `routine-stack:${
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random()}`
    }`;
    const url = window.location.href;
    const baseState = window.history.state;
    const sentinelState = {
      ...stateRecord(baseState),
      [ROUTINE_HISTORY_MARKER]: token,
    };
    window.history.pushState(sentinelState, "", url);
    historyEntryRef.current = {
      token,
      url,
      baseState,
      baseStateKey: historyStateKey(baseState),
      sentinelState,
    };
  }, []);

  const markDirty = React.useCallback(() => {
    dirtyRef.current = true;
    armHistorySentinel();
    setDirty(true);
  }, [armHistorySentinel]);

  const clearDirty = React.useCallback(() => {
    dirtyRef.current = false;
    setDirty(false);
  }, []);

  const retireHistoryEntry = React.useCallback(
    (entry: RoutineHistoryEntry) => {
      if (typeof window !== "undefined") {
        if (ownsCurrentHistoryEntry(entry)) {
          // Retire only our duplicate entry. The exact state captured from
          // Next is restored in place, so an unrelated SPA destination is
          // never consumed by a cleanup path.
          window.history.replaceState(entry.baseState, "", entry.url);
        }
      }
      if (historyEntryRef.current?.token === entry.token) {
        historyEntryRef.current = null;
      }
      if (releasingHistoryRef.current?.token === entry.token) {
        releasingHistoryRef.current = null;
        afterHistoryReleaseRef.current = null;
      }
    },
    [],
  );

  const removeHistorySentinel = React.useCallback(() => {
    const entry = historyEntryRef.current;
    if (!entry) return false;
    retireHistoryEntry(entry);
    return true;
  }, [retireHistoryEntry]);

  const resetHistoryOwnership = React.useCallback(() => {
    const pendingRelease = releasingHistoryRef.current;
    const activeEntry = historyEntryRef.current;
    if (pendingRelease) retireHistoryEntry(pendingRelease);
    if (activeEntry) retireHistoryEntry(activeEntry);
    // Resetting a preserved editor instance must also cancel a callback that
    // belonged to the previous query, even when its history pop has not fired.
    releasingHistoryRef.current = null;
    afterHistoryReleaseRef.current = null;
  }, [retireHistoryEntry]);

  const leaveWithHistorySentinel = React.useCallback(
    (afterRelease: () => void) => {
      const entry = historyEntryRef.current;
      if (!entry || typeof window === "undefined") return false;
      if (!ownsCurrentHistoryEntry(entry)) {
        // The form may still be mounted briefly while another SPA transition
        // has already changed the destination. Do not call history.back() and
        // take the user away from that destination.
        historyEntryRef.current = null;
        afterHistoryReleaseRef.current = null;
        return true;
      }
      releasingHistoryRef.current = entry;
      afterHistoryReleaseRef.current = afterRelease;
      historyEntryRef.current = null;
      window.history.back();
      return true;
    },
    [],
  );

  const navigateAway = React.useCallback(() => {
    const finish = () => {
      if (onClose) onClose();
      else router.push(ROUTINE_EDITOR_RETURN_PATH);
    };
    if (leaveWithHistorySentinel(finish)) return;
    finish();
  }, [leaveWithHistorySentinel, onClose, router]);

  React.useEffect(() => {
    if (typeof document === "undefined") return;
    const onPopState = (event: Event) => {
      const popState = event as PopStateEvent;
      const releasingEntry = releasingHistoryRef.current;
      if (releasingEntry) {
        const currentState = stateRecord(window.history.state);
        const expectedRelease =
          window.location.href === releasingEntry.url &&
          currentState[ROUTINE_HISTORY_MARKER] !== releasingEntry.token &&
          historyStateKey(window.history.state) === releasingEntry.baseStateKey;
        // A release pop is allowed to reach the original same-URL entry only
        // when its state is still the exact Next state we captured. Anything
        // else belongs to an unrelated navigation and cancels the callback.
        if (!expectedRelease) {
          releasingHistoryRef.current = null;
          afterHistoryReleaseRef.current = null;
          return;
        }
        popState.preventDefault();
        popState.stopImmediatePropagation();
        releasingHistoryRef.current = null;
        const afterRelease = afterHistoryReleaseRef.current;
        afterHistoryReleaseRef.current = null;
        afterRelease?.();
        return;
      }
      const entry = historyEntryRef.current;
      if (!entry || !dirtyRef.current) return;
      // Document capture runs before Next's window listener. Restore our
      // owned same-URL entry so a dirty page/sheet cannot be unmounted by
      // browser or Android Back before the discard choice is shown.
      popState.preventDefault();
      popState.stopImmediatePropagation();
      window.history.pushState(entry.sentinelState, "", entry.url);
      if (
        !savingRef.current &&
        submissionRef.current?.phase !== "pending" &&
        submissionRef.current?.phase !== "unknown"
      ) {
        setDiscardAction("close");
      }
    };
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (
        !dirtyRef.current &&
        !savingRef.current &&
        !submissionRef.current
      )
        return;
      event.preventDefault();
      event.returnValue = "";
    };
    document.addEventListener("popstate", onPopState, true);
    // PopStateEvent is dispatched at Window in browser/WebView implementations;
    // keep this capture listener as the native-history fallback while the
    // document listener gets first refusal ahead of Next's window listener.
    window.addEventListener("popstate", onPopState, true);
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => {
      document.removeEventListener("popstate", onPopState, true);
      window.removeEventListener("popstate", onPopState, true);
      window.removeEventListener("beforeunload", onBeforeUnload);
      const pendingRelease = releasingHistoryRef.current;
      const activeEntry = historyEntryRef.current;
      if (pendingRelease) retireHistoryEntry(pendingRelease);
      if (activeEntry) retireHistoryEntry(activeEntry);
      // A pending release callback must never fire after this form has been
      // replaced by another route. The owned entry, when still current, was
      // retired above without traversing history.
      releasingHistoryRef.current = null;
      afterHistoryReleaseRef.current = null;
    };
  }, [retireHistoryEntry]);

  React.useEffect(() => {
    const controller = new AbortController();
    let active = true;
    setLoading(true);
    setLoadError(null);
    setSaveError(null);
    setSubmissionState(null);
    idempotencyKeyRef.current = null;
    resetHistoryOwnership();
    clearDirty();
    setNextCursor(null);
    setCandidates([]);
    setAssignmentOptions([]);
    setSteps([]);
    setRemoveChoreIds([]);
    setFingerprint("");
    setNewTitle("");
    setNewAssignee("");
    setStackId(requestedStackId);

    const load = async () => {
      try {
        const candidateUrl = new URL(
          "/api/chores/stacks/candidates",
          window.location.origin,
        );
        candidateUrl.searchParams.set("occurrence_date", occurrenceDate);
        const requests: [
          Promise<ParsedCandidates>,
          Promise<ParsedRead> | null,
        ] = [
          requestJson<ParsedCandidates>(
            candidateUrl.toString(),
            { signal: controller.signal },
            msgRef.current("loadError"),
            (body) => candidatesResponseSchema.parse(body),
          ),
          requestedStackId
            ? requestJson<ParsedRead>(
                `/api/chores/stacks?stack_id=${encodeURIComponent(requestedStackId)}&occurrence_date=${encodeURIComponent(occurrenceDate)}`,
                { signal: controller.signal },
                msgRef.current("loadError"),
                (body) => readResponseSchema.parse(body),
              )
            : null,
        ];
        const [candidateResult, stackResult] = await Promise.all(requests);
        if (!active) return;
        const stack = stackResult;
        if (
          candidateResult.occurrence_date !== occurrenceDate ||
          candidateResult.candidates.some(
            (candidate) => dateOnly(candidate.due_date) !== occurrenceDate,
          ) ||
          (stack &&
            (stack.occurrence_date !== occurrenceDate ||
              stack.stack.family_id !== familyId ||
              stack.steps.some(
                (step) => dateOnly(step.due_date) !== occurrenceDate,
              )))
        ) {
          throw new RoutineEditorRequestError(
            200,
            msgRef.current("loadError"),
            "INVALID_RESPONSE",
          );
        }
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
        clearDirty();
      } catch (error) {
        if (
          !active ||
          (error instanceof DOMException && error.name === "AbortError")
        )
          return;
        setLoadError(
          localizedRequestError(
            error,
            (key) => msgRef.current(key),
            "loadError",
          ),
        );
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
  }, [
    clearDirty,
    occurrenceDate,
    reloadVersion,
    requestedStackId,
    resetHistoryOwnership,
    setSubmissionState,
  ]);

  React.useEffect(() => {
    if (!newAssignee && assignmentOptions[0])
      setNewAssignee(assignmentOptions[0].accountId);
  }, [assignmentOptions, newAssignee]);

  const editingLocked = saving || submission !== null;

  const loadMore = async () => {
    if (
      !nextCursor ||
      loadingMore ||
      savingRef.current ||
      submissionRef.current
    )
      return;
    setLoadingMore(true);
    setLoadError(null);
    try {
      const url = new URL(
        "/api/chores/stacks/candidates",
        window.location.origin,
      );
      url.searchParams.set("occurrence_date", occurrenceDate);
      url.searchParams.set("cursor", nextCursor);
      const result = await requestJson<ParsedCandidates>(
        url.toString(),
        undefined,
        msg("loadError"),
        (body) => candidatesResponseSchema.parse(body),
      );
      setCandidates((current) => [...current, ...result.candidates]);
      setNextCursor(result.nextCursor);
      if (result.assignmentOptions.length)
        setAssignmentOptions(result.assignmentOptions);
    } catch (error) {
      setLoadError(localizedRequestError(error, msg, "loadError"));
    } finally {
      setLoadingMore(false);
    }
  };

  const addCandidate = (candidate: Candidate) => {
    if (savingRef.current || submissionRef.current) return;
    if (steps.some((step) => step.choreId === candidate.id)) return;
    setSteps((current) => [...current, fromCandidate(candidate, newDraftId())]);
    setRemoveChoreIds((current) => current.filter((id) => id !== candidate.id));
    markDirty();
  };

  const addNewStep = () => {
    if (savingRef.current || submissionRef.current) return;
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
        expectedFingerprint: null,
      },
    ]);
    setNewTitle("");
    setSaveError(null);
    markDirty();
  };

  const removeStep = (step: DraftStep) => {
    if (savingRef.current || submissionRef.current) return;
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
    markDirty();
  };

  const moveStep = (index: number, direction: -1 | 1) => {
    if (savingRef.current || submissionRef.current) return;
    const target = index + direction;
    if (target < 0 || target >= steps.length) return;
    setSteps((current) => {
      const copy = [...current];
      const [item] = copy.splice(index, 1);
      copy.splice(target, 0, item);
      return copy;
    });
    markDirty();
  };

  const changeAssignment = (draftId: string, assignedTo: string) => {
    if (savingRef.current || submissionRef.current) return;
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
    markDirty();
  };

  const submitPacket = React.useCallback(
    async (packet: SavePacket) => {
      if (savingRef.current) return;
      savingRef.current = true;
      setSaving(true);
      setSaveError(null);
      setSubmissionState({ phase: "pending", packet });
      try {
        await requestJson(
          "/api/chores/stacks",
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              [IDEMPOTENCY_HEADER]: packet.key,
            },
            body: packet.bytes,
          },
          msg("networkError"),
          (body) => compactResponseSchema.parse(body),
        );
        setSubmissionState(null);
        idempotencyKeyRef.current = null;
        clearDirty();
        router.refresh();
        navigateAway();
      } catch (error) {
        const requestError =
          error instanceof RoutineEditorRequestError ? error : null;
        if (
          requestError?.code === "ROUTINE_STACK_CONFLICT" ||
          requestError?.code === "IDENTITY_CONFLICT"
        ) {
          setSubmissionState({ phase: "conflict", packet });
          setSaveError(localizedRequestError(error, msg, "conflict"));
        } else if (
          !requestError ||
          requestError.status >= 500 ||
          requestError.status === 409 ||
          requestError.code === "INVALID_RESPONSE" ||
          requestError.code === "IDEMPOTENCY_IN_PROGRESS"
        ) {
          // A network failure, 5xx, malformed 2xx, or an in-flight idempotency
          // response may have committed. Keep the exact packet and key so
          // Retry can safely reconcile it. A generic 409 is treated this way
          // too: only the explicit snapshot-conflict code is definitive.
          setSubmissionState({ phase: "unknown", packet });
          setSaveError(msg("unknownSave"));
        } else {
          // A definitive client/authorization rejection (including a reused
          // key whose bytes do not match) leaves the draft editable, but a new
          // attempt receives a fresh key and bytes.
          setSubmissionState(null);
          idempotencyKeyRef.current = null;
          setSaveError(localizedRequestError(error, msg, "saveError"));
        }
      } finally {
        savingRef.current = false;
        setSaving(false);
      }
    },
    [clearDirty, msg, navigateAway, router, setSubmissionState],
  );

  const save = (event: React.FormEvent) => {
    event.preventDefault();
    if (savingRef.current || submissionRef.current) return;
    if (!label.trim() || steps.length === 0) {
      setSaveError(
        steps.length === 0 ? msg("oneStepRequired") : msg("labelRequired"),
      );
      return;
    }
    const key = newIdempotencyKey();
    idempotencyKeyRef.current = key;
    const body: SaveBody = {
      scope: "occurrence",
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
        ...(step.expectedFingerprint
          ? { expected_fingerprint: step.expectedFingerprint }
          : {}),
      })),
      remove_chore_ids: removeChoreIds,
      expected_fingerprint: fingerprint,
    };
    const packet: SavePacket = Object.freeze({
      key,
      bytes: JSON.stringify(body),
    });
    setSubmissionState({ phase: "pending", packet });
    void submitPacket(packet);
  };

  const openDiscard = (action: "close" | "reload") => {
    if (
      saving ||
      savingRef.current ||
      submission?.phase === "pending" ||
      submission?.phase === "unknown"
    )
      return;
    setDiscardAction(action);
  };

  const handleClose = () => {
    if (saving || savingRef.current || submission) return;
    if (dirtyRef.current) {
      openDiscard("close");
      return;
    }
    navigateAway();
  };

  const confirmDiscard = () => {
    const action = discardAction;
    if (
      !action ||
      saving ||
      savingRef.current ||
      submission?.phase === "pending" ||
      submission?.phase === "unknown"
    )
      return;
    setDiscardAction(null);
    setSubmissionState(null);
    idempotencyKeyRef.current = null;
    clearDirty();
    setSaveError(null);
    if (action === "reload") {
      removeHistorySentinel();
      setReloadVersion((value) => value + 1);
      return;
    }
    navigateAway();
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
      className="min-w-0 max-w-full space-y-5"
      data-testid="routine-stack-editor"
      data-dirty={dirty ? "true" : "false"}
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
                markDirty();
              }}
              disabled={editingLocked}
              className="input-field w-full min-w-0 max-w-full min-h-[44px]"
              placeholder={msg("labelPlaceholder")}
              maxLength={ROUTINE_NAME_MAX}
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
            <ol className="min-w-0 max-w-full space-y-3">
              {steps.map((step, index) => (
                <li
                  key={step.draftId}
                  className="min-w-0 max-w-full rounded-xl border border-[var(--surface-separator)] bg-[var(--surface-fill-secondary)] p-3"
                >
                  <div className="flex min-w-0 max-w-full items-start gap-3">
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
                        disabled={editingLocked}
                        className="input-field mt-2 min-h-[44px] w-full min-w-0 max-w-full"
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
                        disabled={index === 0 || editingLocked}
                        onClick={() => moveStep(index, -1)}
                        aria-label={msg("moveUp", { title: step.title })}
                      >
                        ↑
                      </button>
                      <button
                        type="button"
                        className="min-h-[44px] min-w-[44px] rounded-lg text-label-secondary underline disabled:opacity-40"
                        disabled={index === steps.length - 1 || editingLocked}
                        onClick={() => moveStep(index, 1)}
                        aria-label={msg("moveDown", { title: step.title })}
                      >
                        ↓
                      </button>
                    </div>
                  </div>
                  <button
                    type="button"
                    className="mt-2 block min-h-[44px] w-full min-w-0 max-w-full text-left text-footnote text-label-secondary underline whitespace-normal break-words [overflow-wrap:anywhere] disabled:opacity-40"
                    disabled={steps.length <= 1 || editingLocked}
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
              <ul className="min-w-0 max-w-full divide-y divide-[var(--surface-separator)] rounded-xl bg-[var(--surface-fill-secondary)]">
                {candidates.map((candidate) => {
                  const added = steps.some(
                    (step) => step.choreId === candidate.id,
                  );
                  return (
                    <li
                      key={candidate.id}
                      className="flex min-w-0 max-w-full items-center gap-3 p-3"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="text-body text-label-primary [overflow-wrap:anywhere]">
                          {candidate.title}
                        </p>
                        <p className="text-footnote text-label-secondary [overflow-wrap:anywhere]">
                          {accountNames.get(candidate.assigned_to) ??
                            candidate.assigned_to}{" "}
                          · {candidate.due_date.slice(0, 10)}
                        </p>
                      </div>
                      <button
                        type="button"
                        className="btn-tinted min-h-[44px] shrink-0"
                        disabled={added || editingLocked}
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
                disabled={loadingMore || editingLocked}
                onClick={() => void loadMore()}
              >
                {loadingMore ? msg("loading") : msg("moreCandidates")}
              </button>
            )}
          </section>

          <section
            aria-labelledby="routine-new-step-heading"
            className="min-w-0 max-w-full space-y-3 rounded-xl border border-[var(--surface-separator)] p-3"
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
              onChange={(event) => {
                setNewTitle(event.target.value);
                markDirty();
              }}
              className="input-field w-full min-w-0 max-w-full min-h-[44px]"
              placeholder={msg("stepTitlePlaceholder")}
              maxLength={200}
              disabled={editingLocked}
            />
            <label htmlFor="routine-new-assignee" className="sr-only">
              {msg("assignedTo")}
            </label>
            <select
              id="routine-new-assignee"
              value={newAssignee}
              onChange={(event) => {
                setNewAssignee(event.target.value);
                markDirty();
              }}
              className="input-field w-full min-w-0 max-w-full min-h-[44px]"
              disabled={assignmentOptions.length === 0 || editingLocked}
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
                editingLocked
              }
              onClick={addNewStep}
            >
              {msg("addStep")}
            </button>
          </section>

          {saveError && !discardAction && (
            <div
              role="alert"
              className="rounded-xl bg-[var(--surface-fill-secondary)] p-3 text-body text-label-primary"
            >
              <p>{saveError}</p>
              {submission?.phase === "unknown" && (
                <button
                  type="button"
                  className="btn-tinted mt-3 min-h-[44px]"
                  disabled={saving}
                  onClick={() => void submitPacket(submission.packet)}
                >
                  {msg("retrySave")}
                </button>
              )}
              {submission?.phase === "conflict" && (
                <button
                  type="button"
                  className="btn-tinted mt-3 min-h-[44px]"
                  onClick={() => openDiscard("reload")}
                >
                  {msg("reload")}
                </button>
              )}
            </div>
          )}
          <div className="flex flex-wrap gap-3 border-t border-[var(--surface-separator)] pt-4">
            <button
              type="submit"
              className="btn-filled min-h-[44px] flex-1"
              disabled={editingLocked || steps.length === 0 || !label.trim()}
            >
              {saving ? msg("saving") : msg("save")}
            </button>
            {mode === "page" && (
              <button
                type="button"
                className="btn-tinted min-h-[44px] flex-1"
                disabled={editingLocked}
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

  const discardDialog = discardAction ? (
    <Dialog
      open
      role="alertdialog"
      title={msg("discardTitle")}
      description={msg("discardDescription")}
      onClose={() => setDiscardAction(null)}
      closeLabel={msg("close")}
      initialFocusRef={discardCancelRef}
      testId="routine-stack-discard-dialog"
    >
      <div className="pointer-events-none relative isolate flex min-w-0 flex-col gap-3 p-5 sm:flex-row sm:flex-wrap sm:justify-end">
        <button
          ref={discardCancelRef}
          type="button"
          className="btn-tinted relative z-10 min-h-[44px] min-w-0 w-full pointer-events-auto whitespace-normal break-words sm:w-auto"
          onClick={() => setDiscardAction(null)}
        >
          {msg("keepEditing")}
        </button>
        <button
          type="button"
          className="btn-destructive relative z-10 min-h-[44px] min-w-0 w-full pointer-events-auto whitespace-normal break-words sm:w-auto"
          onClick={confirmDiscard}
        >
          {discardAction === "reload" ? msg("reload") : msg("discard")}
        </button>
      </div>
    </Dialog>
  ) : null;

  if (mode === "sheet") {
    return (
      <>
        <Dialog
          open
          variant="form"
          title={title}
          description={msg("description")}
          onClose={editingLocked ? undefined : handleClose}
          closeLabel={msg("close")}
          initialFocusRef={labelRef}
          testId="routine-stack-sheet"
        >
          {content}
        </Dialog>
        {discardDialog}
      </>
    );
  }

  return (
    <>
      <main className="mx-auto min-w-0 w-full max-w-3xl px-4 pb-24 pt-6">
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
      {discardDialog}
    </>
  );
}
