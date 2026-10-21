/** Foreground-only I/O. No mount/focus/background mutation or recovered resend. */
import { requestOwnedJson as request } from "@/lib/owned-request-http";
import { newIdempotencyKey } from "@/lib/idempotency-key";
import {
  preparationCommand,
  planEventPreparation,
  type PreparationCommand,
  type PreparationContext,
} from "./contract";
import {
  preparationReadScope,
  type PreparationReadScope,
} from "./read-contract";
import {
  preparationReadReply,
  type PreparationReadReply,
} from "./view-contract";
import { preparationReceipt, preparationReceiptMatches } from "./http";
import {
  preparationRequestHash,
  canonicalPreparationJson,
} from "./request-hash";
import {
  PREPARATION_RECOVERY,
  PREPARATION_OWNER_HEADER,
  PREPARATION_INSPECTION_BYTES,
  preparationRecoveryContext,
  preparationRecoveryEntry,
  preparationRecoveryReview,
  preparationEntryMatchesContext,
  type PreparationRecoveryContext,
  type PreparationRecoveryEntry,
} from "./recovery";
const BASE = "/api/coordination/event-preparation";
export async function readPreparationContext() {
  const result = await request(`${BASE}/recovery`, {}, 16384);
  if (result.kind !== "reply" || !result.response.ok)
    throw new Error("Preparation recovery unavailable");
  return preparationRecoveryContext.parse(result.body);
}
function validateRead(raw: unknown, context: PreparationRecoveryContext) {
  const reply = preparationReadReply.parse(raw);
  if (
    reply.view.owner.userId !== context.userId ||
    reply.view.owner.familyId !== context.familyId ||
    context.role !== "parent"
  )
    throw new Error("Preparation owner changed");
  return reply;
}
/** Recompute the pure preview from the deliberate projection. It supplies no
 * server authority: the API renews all identities/sources/locks independently. */
function projectedEffects(
  reply: PreparationReadReply,
  command: PreparationCommand,
) {
  const view = reply.view;
  const context: PreparationContext = {
    actor: {
      kind: "person",
      userId: view.owner.userId,
      familyId: view.owner.familyId,
      role: "parent",
      memberProtocol: view.memberProtocol,
    },
    event: {
      id: view.event.id,
      familyId: view.owner.familyId,
      sourceToken: view.event.sourceToken,
      start: view.event.start,
      end: view.event.end,
      active: view.event.active,
    },
    timeZone: view.timeZone,
    viewToken: view.expectedToken,
    writesEnabled: view.writesEnabled,
    pointsEnabled: view.pointsEnabled,
    profileWritesEnabled: view.profileWritesEnabled,
    complete: view.complete,
    current: view.plan,
    eligibleSubjects: view.subjects.map((row) => row.subject),
    tasks: view.tasks.flatMap((task) =>
      task.available
        ? [
            {
              id: task.id,
              sourceToken: task.sourceToken,
              dueDay: task.dueDay,
              subject: task.subject,
              status: task.status,
              attachedEventId: task.attachedEventId,
              linkable: true,
              dateEditable: task.dateEditable,
            },
          ]
        : [],
    ),
    routine: view.routine
      ? {
          id: view.routine.id,
          sourceToken: view.routine.sourceToken,
          occurrenceDay: view.routine.occurrenceDay,
          complete: view.routine.complete,
          steps: view.routine.steps.flatMap((step) =>
            step.available
              ? [
                  {
                    id: step.id,
                    sourceToken: step.sourceToken,
                    copyable: true,
                    content: step.content,
                  },
                ]
              : [],
          ),
        }
      : null,
  };
  return planEventPreparation(command, context, new Date(view.evaluatedAt));
}
async function validatePreview(
  raw: unknown,
  rawCommand: PreparationCommand,
  context: PreparationRecoveryContext,
) {
  const command = preparationCommand.parse(rawCommand);
  const reply = validateRead(raw, context);
  const digest = await preparationRequestHash(command);
  if (
    command.owner.userId !== context.userId ||
    command.owner.familyId !== context.familyId ||
    !reply.effects ||
    reply.requestHash !== digest ||
    canonicalPreparationJson(projectedEffects(reply, command)) !==
      canonicalPreparationJson(reply.effects)
  )
    throw new Error("Preparation preview changed");
  return reply;
}
export async function readPreparationSelection(
  rawScope: PreparationReadScope,
  context: PreparationRecoveryContext,
) {
  const scope = preparationReadScope.parse(rawScope);
  const result = await request(
    `${BASE}/preview`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind: "read", scope }),
    },
    8 * 1024 * 1024,
  );
  if (result.kind !== "reply" || !result.response.ok)
    throw new Error("Preparation unavailable");
  const reply = validateRead(result.body, context);
  if (
    reply.effects !== null ||
    reply.requestHash !== null ||
    reply.view.event.id !== scope.eventId ||
    reply.view.memberProtocol !== scope.memberProtocol ||
    reply.view.timeZone !== scope.timeZone ||
    (scope.routine &&
      (!reply.view.routine ||
        reply.view.routine.id !== scope.routine.stackId ||
        reply.view.routine.occurrenceDay !== scope.routine.occurrenceDay)) ||
    (!scope.routine && reply.view.routine !== null)
  )
    throw new Error("Preparation selection changed");
  return reply;
}
export async function previewPreparation(
  command: PreparationCommand,
  context: PreparationRecoveryContext,
) {
  preparationCommand.parse(command);
  if (
    command.owner.userId !== context.userId ||
    command.owner.familyId !== context.familyId
  )
    throw new Error("Preparation owner changed");
  const result = await request(
    `${BASE}/preview`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind: "preview", command }),
    },
    8 * 1024 * 1024,
  );
  if (result.kind !== "reply" || !result.response.ok)
    throw new Error("Preparation preview unavailable");
  return validatePreview(result.body, command, context);
}
export async function makePreparationIntent(
  reply: PreparationReadReply,
  rawCommand: PreparationCommand,
  context: PreparationRecoveryContext,
  key = newIdempotencyKey(),
): Promise<PreparationRecoveryEntry> {
  if (!context.enabled || !context.owner)
    throw new Error("Preparation changes paused");
  const command = preparationCommand.parse(rawCommand);
  const checked = await validatePreview(reply, command, context);
  return preparationRecoveryEntry.parse({
    kind: "event-preparation",
    key,
    body: JSON.stringify(command),
    requestHash: checked.requestHash,
  });
}
async function checkedEntry(
  raw: PreparationRecoveryEntry,
  context?: PreparationRecoveryContext,
) {
  const entry = preparationRecoveryEntry.parse(raw);
  if (
    entry.requestHash !==
      (await preparationRequestHash(JSON.parse(entry.body))) ||
    (context && !preparationEntryMatchesContext(entry, context))
  )
    throw new Error("Preparation request changed");
  return entry;
}
export async function inspectPreparation(
  raw: PreparationRecoveryEntry,
  context: PreparationRecoveryContext,
) {
  const entry = await checkedEntry(raw, context);
  if (!context.owner) throw new Error("Preparation owner changed");
  const result = await request(
    `${BASE}/recovery`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        [PREPARATION_OWNER_HEADER]: context.owner.scope,
      },
      body: JSON.stringify({ contract: PREPARATION_RECOVERY, entry }),
    },
    PREPARATION_INSPECTION_BYTES,
  );
  if (result.kind !== "reply" || !result.response.ok)
    throw new Error("Preparation recovery unavailable");
  const review = preparationRecoveryReview.parse(result.body);
  if (
    review.ownerScope !== context.owner.scope ||
    review.entry.key !== entry.key ||
    review.entry.body !== entry.body ||
    review.entry.requestHash !== entry.requestHash
  )
    throw new Error("Preparation owner changed");
  return review;
}
export async function sendPreparation(
  raw: PreparationRecoveryEntry,
  ownerScope: string,
) {
  const entry = await checkedEntry(raw);
  if (!/^[a-f0-9]{64}$/.test(ownerScope))
    throw new Error("Preparation owner changed");
  const command = preparationCommand.parse(JSON.parse(entry.body));
  const result = await request(
    BASE,
    {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key": entry.key,
        [PREPARATION_OWNER_HEADER]: ownerScope,
      },
      body: entry.body,
    },
    16384,
  );
  if (result.kind !== "reply") return { kind: "unknown" as const };
  if (!result.response.ok)
    return {
      kind:
        result.response.status >= 500 || result.response.status === 409
          ? ("unknown" as const)
          : ("refused" as const),
    };
  return preparationReceiptMatches(
    result.body,
    command,
    entry.key,
    entry.requestHash,
  )
    ? {
        kind: "confirmed" as const,
        receipt: preparationReceipt.parse(result.body),
      }
    : { kind: "unknown" as const };
}
