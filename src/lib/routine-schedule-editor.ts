import { isRoutineIconKey } from "@/lib/routine-icons";
import { routineScheduleCommand } from "@/lib/routine-schedule";
/** Parent form state. Stable client/root IDs, never label-based adoption. */
import { newIdempotencyKey } from "@/lib/idempotency-key";
import type {
  RoutineScheduleCommand,
  RoutineSharedSchedule,
} from "@/lib/routine-schedule";
import type {
  RoutineAssignmentOption,
  RoutineScheduleState,
} from "@/lib/routine-schedule-view";
import type { RoutineScheduleDraft } from "@/lib/routine-schedule-client";
type Create = Extract<RoutineScheduleCommand, { action: "create" }>;
export type RoutineEditorStep = Omit<Create["steps"][number], "subject" | "icon"> & {
  subject: Create["steps"][number]["subject"] | null;
  icon: string | null;
};
export type RoutineEditorDraft = {
  stackId: string | null;
  version: number | null;
  state: "active" | "paused" | "stopped";
  label: string;
  anchor: string;
  schedule: RoutineSharedSchedule;
  steps: RoutineEditorStep[];
  removed: Array<
    Extract<
      RoutineScheduleCommand,
      { action: "replace-future" }
    >["removed_steps"][number] & {
      step: RoutineEditorStep;
      position: number;
      before: string | null;
      after: string | null;
    }
  >;
};
export function newRoutineStep(
  subject: RoutineEditorStep["subject"],
  pointsEnabled: boolean,
): RoutineEditorStep {
  return {
    client_step_id: newIdempotencyKey(),
    template_id: null,
    title: "",
    description: null,
    subject,
    points: pointsEnabled ? 0 : null,
    difficulty: "easy",
    icon: null,
    duration_minutes: null,
  };
}
export function newRoutineDraft(
  parentId: string,
  assignments: RoutineAssignmentOption[],
  pointsEnabled: boolean,
): RoutineEditorDraft {
  const subject =
    assignments.find(
      (option) =>
        option.subject.kind === "account" &&
        option.subject.user_id === parentId,
    )?.subject ?? null;
  return {
    stackId: null,
    version: null,
    state: "active",
    label: "",
    anchor: "",
    schedule: {
      frequency: "daily",
      starts_on: null,
      weekly_days: [],
      monthly_day: null,
    },
    steps: [newRoutineStep(subject, pointsEnabled)],
    removed: [],
  };
}
export function routineDraftFromState(
  state: RoutineScheduleState,
): RoutineEditorDraft {
  return {
    stackId: state.stackId,
    version: state.version,
    state: state.config.state,
    label: state.label,
    anchor: state.config.anchor ?? "",
    schedule: state.config.schedule,
    steps: state.steps.map((step) => ({
      ...step,
      points: step.points ?? null,
      client_step_id: newIdempotencyKey(),
    })),
    removed: [],
  };
}
export function routineEditorCommand(
  draft: RoutineEditorDraft,
): RoutineScheduleDraft {
  if (draft.steps.some((step) => step.subject === null))
    throw new Error("Choose a family member");
  const steps = draft.steps.map((step) => {
    const icon = step.icon;
    if (icon !== null && !isRoutineIconKey(icon)) throw new Error("Choose a supported routine picture");
    return { ...step, subject: step.subject!, icon };
  });
  const content = {
    label: draft.label,
    anchor: draft.anchor.trim() || null,
    schedule: draft.schedule,
    steps,
  };
  return draft.stackId && draft.version
    ? {
        ...content,
        action: "replace-future",
        stack_id: draft.stackId,
        expected_version: draft.version,
        removed_steps: draft.removed.map(({ template_id, disposition }) => ({
          template_id,
          disposition,
        })),
      }
    : { ...content, action: "create" };
}
export function removeRoutineEditorStep(
  draft: RoutineEditorDraft,
  index: number,
  disposition?: "unstack-future" | "stop-future",
): RoutineEditorDraft {
  const step = draft.steps[index];
  if (!step || draft.steps.length <= 1 || (step.template_id && !disposition))
    throw new Error("Review removed step scope");
  return {
    ...draft,
    steps: draft.steps.filter((_, position) => position !== index),
    removed: step.template_id
      ? [
          ...draft.removed,
          {
            template_id: step.template_id,
            disposition: disposition!,
            step,
            position: index,
            before: draft.steps[index - 1]?.client_step_id ?? null,
            after: draft.steps[index + 1]?.client_step_id ?? null,
          },
        ]
      : draft.removed,
  };
}

export function restoreRoutineEditorStep(
  draft: RoutineEditorDraft,
  templateId: string,
): RoutineEditorDraft {
  const removed = draft.removed.find((row) => row.template_id === templateId);
  if (!removed || draft.steps.length >= 99) return draft;
  const steps = [...draft.steps];
  const after = steps.findIndex(
    (step) => step.client_step_id === removed.after,
  );
  const before = steps.findIndex(
    (step) => step.client_step_id === removed.before,
  );
  steps.splice(
    after >= 0
      ? after
      : before >= 0
        ? before + 1
        : Math.min(removed.position, steps.length),
    0,
    removed.step,
  );
  return {
    ...draft,
    steps,
    removed: draft.removed.filter((row) => row !== removed),
  };
}

/** A confirmed earlier request cannot erase a different unsent local document. */
export function routineDraftMatchesCommand(
  draft: RoutineEditorDraft,
  raw: unknown,
): boolean {
  try {
    const command = routineScheduleCommand.parse(raw);
    if (command.action !== "create" && command.action !== "replace-future")
      return false;
    const rebuilt = routineScheduleCommand.parse({
      ...routineEditorCommand(draft),
      protocol: command.protocol,
      expected_user_id: command.expected_user_id,
      expected_family_id: command.expected_family_id,
      issued_at: command.issued_at,
      view_day: command.view_day,
      view_zone: command.view_zone,
    });
    return JSON.stringify(rebuilt) === JSON.stringify(command);
  } catch {
    return false;
  }
}
