/** Explicit personal-parent projection. Internal Chore/proof/root rows and
 * unavailable task details never pass through JSON by object spreading. */
import type { prepareEventPreparationInTx } from "./runtime";
import { EVENT_PREPARATION_PROTOCOL, preparationProgress } from "./contract";
export function preparationView(
  prepared: Awaited<ReturnType<typeof prepareEventPreparationInTx>>,
  now = new Date(),
) {
  const { context } = prepared;
  const linked = new Set(
    context.current?.links.map((link) => link.choreId) ?? [],
  );
  const linkedTasks = prepared.tasks.filter((detail) =>
    linked.has(detail.task.id),
  );
  const unavailable =
    linked.size - linkedTasks.filter((detail) => detail.task.linkable).length;
  return {
    protocol: EVENT_PREPARATION_PROTOCOL,
    owner: {
      userId: context.actor.kind === "person" ? context.actor.userId : null,
      familyId: context.event.familyId,
    },
    memberProtocol: prepared.scope.memberProtocol,
    timeZone: context.timeZone,
    evaluatedAt: now.toISOString(),
    event: {
      id: context.event.id,
      title: prepared.eventTitle,
      start: context.event.start,
      end: context.event.end,
      sourceToken: context.event.sourceToken,
      active: context.event.active,
    },
    expectedToken: context.viewToken,
    writesEnabled: context.writesEnabled,
    pointsEnabled: context.pointsEnabled,
    profileWritesEnabled: context.profileWritesEnabled,
    complete: context.complete,
    plan: context.current
      ? {
          reviewedEventSourceToken: context.current.reviewedEventSourceToken,
          links: context.current.links.map((link) => ({
            choreId: link.choreId,
            cue: link.cue,
          })),
        }
      : null,
    progress: preparationProgress({
      statuses: linkedTasks
        .filter((detail) => detail.task.linkable)
        .map((detail) => detail.task.status),
      unavailable,
      restricted: unavailable > 0,
      capped: !context.complete,
      eventChanged:
        !!context.current &&
        context.current.reviewedEventSourceToken !== context.event.sourceToken,
    }),
    tasks: prepared.tasks.map((detail) =>
      detail.task.linkable
        ? {
            id: detail.task.id,
            available: true as const,
            title: detail.title,
            description: detail.description,
            subjectName: detail.subjectName,
            sourceToken: detail.task.sourceToken,
            dueDay: detail.task.dueDay,
            subject: detail.task.subject,
            status: detail.task.status,
            attachedEventId: detail.task.attachedEventId,
            dateEditable: detail.task.dateEditable,
          }
        : { id: detail.task.id, available: false as const },
    ),
    subjects: prepared.subjects,
    routine: context.routine
      ? {
          id: context.routine.id,
          label: prepared.routineLabel,
          sourceToken: context.routine.sourceToken,
          occurrenceDay: context.routine.occurrenceDay,
          complete: context.routine.complete,
          steps: context.routine.steps.map((step) =>
            step.copyable && step.content
              ? {
                  id: step.id,
                  available: true as const,
                  sourceToken: step.sourceToken,
                  content: {
                    title: step.content.title,
                    description: step.content.description,
                    subject: step.content.subject,
                    // A disabled points feature does not reveal source points to inputs.
                    points: context.pointsEnabled ? step.content.points : 0,
                    difficulty: step.content.difficulty,
                    icon: step.content.icon,
                    durationMinutes: step.content.durationMinutes,
                  },
                }
              : { id: step.id, available: false as const },
          ),
        }
      : null,
  };
}
