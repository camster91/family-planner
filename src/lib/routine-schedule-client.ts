/** Exact original intents and explicit recovery only; no background mutation. */
import {
  routineScheduleCommand,
  routineScheduleReceipt,
  routineViewerDay,
  type RoutineScheduleCommand,
} from "@/lib/routine-schedule";
import {
  routineRecoveryContext,
  routineRecoveryEntry,
  routineRecoveryReview,
  ROUTINE_RECOVERY_CONTRACT,
  ROUTINE_RECOVERY_OWNER_HEADER,
  type RoutineRecoveryContext,
  type RoutineRecoveryEntry,
} from "@/lib/routine-schedule-recovery-contract";
import { newIdempotencyKey } from "@/lib/idempotency-key";
import { requestOwnedJson as request } from "@/lib/owned-request-http";
import {
  routineDraftContext,
  type RoutineDraftContext,
} from "@/lib/routine-draft-contract";
import {
  routineScheduleCatalog,
  routineScheduleState,
} from "@/lib/routine-schedule-view";
type Draft<T> = T extends unknown
  ? Omit<
      T,
      | "protocol"
      | "expected_user_id"
      | "expected_family_id"
      | "issued_at"
      | "view_day"
      | "view_zone"
    >
  : never;
export type RoutineScheduleDraft = Draft<RoutineScheduleCommand>;
export function makeRoutineScheduleIntent(
  draft: RoutineScheduleDraft,
  context: Pick<RoutineRecoveryContext, "userId" | "familyId">,
  zone: string,
  now = new Date(),
  key = newIdempotencyKey(),
): RoutineRecoveryEntry {
  const command = routineScheduleCommand.parse({
    ...draft,
    protocol: "herewoven.routine-schedule.v1",
    expected_user_id: context.userId,
    expected_family_id: context.familyId,
    issued_at: now.toISOString(),
    view_zone: zone,
    view_day: routineViewerDay(zone, now),
  });
  return routineRecoveryEntry.parse({
    kind: "schedule",
    key,
    body: JSON.stringify(command),
  });
}
export async function readRoutineCatalog(
  context: RoutineRecoveryContext,
  cursor: string | null = null,
) {
  if (!context.owner) throw new Error("Routine owner changed");
  const result = await request(
    `/api/chores/routines${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""}`,
    {
      headers: {
        "X-Member-Protocol": "2",
        [ROUTINE_RECOVERY_OWNER_HEADER]: context.owner.scope,
      },
    },
  );
  if (result.kind !== "reply" || !result.response.ok)
    throw new Error("Routine catalog unavailable");
  const catalog = routineScheduleCatalog.parse(result.body);
  if (
    catalog.userId !== context.userId ||
    catalog.familyId !== context.familyId
  )
    throw new Error("Routine owner changed");
  return catalog;
}
export async function readRoutineState(
  stackId: string,
  context: RoutineRecoveryContext,
) {
  if (!context.owner) throw new Error("Routine owner changed");
  const result = await request(
    `/api/chores/routines?stack_id=${encodeURIComponent(stackId)}`,
    {
      headers: {
        "X-Member-Protocol": "2",
        [ROUTINE_RECOVERY_OWNER_HEADER]: context.owner.scope,
      },
    },
  );
  if (result.kind !== "reply" || !result.response.ok)
    throw new Error("Routine unavailable");
  const state = routineScheduleState.parse(result.body);
  if (
    state.userId !== context.userId ||
    state.familyId !== context.familyId ||
    state.stackId !== stackId
  )
    throw new Error("Routine owner changed");
  return state;
}
export async function readRoutineRecoveryContext(): Promise<RoutineRecoveryContext> {
  const result = await request(
    "/api/chores/routines/recovery",
    { headers: { "X-Member-Protocol": "2" } },
    16384,
  );
  if (result.kind !== "reply" || !result.response.ok)
    throw new Error("Routine recovery unavailable");
  return routineRecoveryContext.parse(result.body);
}
export async function readRoutineDraftContext(): Promise<RoutineDraftContext> {
  const result = await request(
    "/api/chores/routines/recovery?draft=1",
    { headers: { "X-Member-Protocol": "2" } },
    16384,
  );
  if (result.kind !== "reply" || !result.response.ok)
    throw new Error("Routine draft context unavailable");
  return routineDraftContext.parse(result.body);
}
export async function readRoutineRecoveryReview(
  entry: RoutineRecoveryEntry,
  context: RoutineRecoveryContext,
) {
  if (!context.owner) throw new Error("Routine recovery owner changed");
  const result = await request("/api/chores/routines/recovery", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Member-Protocol": "2",
      [ROUTINE_RECOVERY_OWNER_HEADER]: context.owner.scope,
    },
    body: JSON.stringify({ contract: ROUTINE_RECOVERY_CONTRACT, entry }),
  });
  if (result.kind !== "reply" || !result.response.ok)
    throw new Error("Routine recovery review unavailable");
  const review = routineRecoveryReview.parse(result.body);
  if (
    review.ownerScope !== context.owner.scope ||
    review.entry.key !== entry.key ||
    review.entry.kind !== entry.kind ||
    review.entry.body !== entry.body
  )
    throw new Error("Routine recovery context changed");
  return review;
}
export type RoutineScheduleOutcome =
  | {
      kind: "confirmed";
      receipt: ReturnType<typeof routineScheduleReceipt.parse>;
    }
  | { kind: "unknown" }
  | { kind: "removed" }
  | { kind: "refused"; code: string };
export async function postRoutineSchedule(
  entry: RoutineRecoveryEntry,
  ownerScope: string,
): Promise<RoutineScheduleOutcome> {
  routineRecoveryEntry.parse(entry);
  const result = await request("/api/chores/routines", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Member-Protocol": "2",
      "Idempotency-Key": entry.key,
      [ROUTINE_RECOVERY_OWNER_HEADER]: ownerScope,
    },
    body: entry.body,
  });
  if (result.kind !== "reply") return { kind: "unknown" };
  if (result.response.ok) {
    const proof = routineScheduleReceipt.safeParse(result.body),
      command = routineScheduleCommand.parse(JSON.parse(entry.body));
    return proof.success &&
      proof.data.action === command.action &&
      (command.action === "create" || proof.data.stackId === command.stack_id)
      ? { kind: "confirmed", receipt: proof.data }
      : { kind: "unknown" };
  }
  const body = result.body as { error?: { code?: unknown } };
  const code =
    typeof body?.error?.code === "string"
      ? body.error.code
      : "ROUTINE_SAVE_REFUSED";
  if (
    result.response.status >= 500 ||
    ["IDEMPOTENCY_IN_PROGRESS", "ROUTINE_CONFIRMATION_UNAVAILABLE"].includes(
      code,
    )
  )
    return { kind: "unknown" };
  return code === "ROUTINE_ORIGINAL_REMOVED"
    ? { kind: "removed" }
    : { kind: "refused", code };
}
