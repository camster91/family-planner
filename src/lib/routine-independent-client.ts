import { independentDraftContext } from "@/lib/routine-independent-draft-contract";
/** Explicit foreground requests only. Original bytes/key survive every unknown result. */
import {
  routineIndependentCommand,
  routineIndependentReceipt,
  routineIndependentState,
  routineIndependentCatalog,
  ROUTINE_INDEPENDENT_PROTOCOL,
  type RoutineIndependentCommand,
} from "@/lib/routine-independent";
import {
  independentRecoveryContext,
  independentRecoveryEntry,
  independentRecoveryReview,
  INDEPENDENT_RECOVERY_CONTRACT,
  type IndependentRecoveryContext,
  type IndependentRecoveryEntry,
} from "@/lib/routine-independent-recovery";
import { ROUTINE_RECOVERY_OWNER_HEADER } from "@/lib/routine-schedule-recovery-contract";
import { requestOwnedJson } from "@/lib/owned-request-http";
import { routineViewerDay } from "@/lib/routine-schedule";
import { newIdempotencyKey } from "@/lib/idempotency-key";
type WithoutContext<T> = T extends unknown
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
export type IndependentRoutineDraft = WithoutContext<RoutineIndependentCommand>;
export function makeIndependentRoutineIntent(
  draft: IndependentRoutineDraft,
  context: Pick<IndependentRecoveryContext, "userId" | "familyId">,
  zone: string,
  now = new Date(),
  key = newIdempotencyKey(),
): IndependentRecoveryEntry {
  return independentRecoveryEntry.parse({
    kind: "independent",
    key,
    body: JSON.stringify(
      routineIndependentCommand.parse({
        ...draft,
        protocol: ROUTINE_INDEPENDENT_PROTOCOL,
        expected_user_id: context.userId,
        expected_family_id: context.familyId,
        issued_at: now.toISOString(),
        view_day: routineViewerDay(zone, now),
        view_zone: zone,
      }),
    ),
  });
}
function headers(context: IndependentRecoveryContext) {
  if (!context.owner) throw new Error("Independent owner changed");
  return {
    "X-Member-Protocol": "2",
    [ROUTINE_RECOVERY_OWNER_HEADER]: context.owner.scope,
  };
}
export async function readIndependentRecoveryContext() {
  const result = await requestOwnedJson(
    "/api/chores/routines/independent/recovery",
    { headers: { "X-Member-Protocol": "2" } },
    16384,
  );
  if (result.kind !== "reply" || !result.response.ok)
    throw new Error("Independent recovery unavailable");
  return independentRecoveryContext.parse(result.body);
}
export async function readIndependentCatalog(
  context: IndependentRecoveryContext,
  cursor: string | null = null,
) {
  const result = await requestOwnedJson(
    `/api/chores/routines/independent${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""}`,
    { headers: headers(context) },
  );
  if (result.kind !== "reply" || !result.response.ok)
    throw new Error("Independent catalog unavailable");
  const data = routineIndependentCatalog.parse(result.body);
  if (data.userId !== context.userId || data.familyId !== context.familyId)
    throw new Error("Independent owner changed");
  return data;
}
export async function readIndependentState(
  rootId: string,
  context: IndependentRecoveryContext,
) {
  const result = await requestOwnedJson(
    `/api/chores/routines/independent?root_id=${encodeURIComponent(rootId)}`,
    { headers: headers(context) },
  );
  if (result.kind !== "reply" || !result.response.ok)
    throw new Error("Independent step unavailable");
  const data = routineIndependentState.parse(result.body);
  if (
    data.userId !== context.userId ||
    data.familyId !== context.familyId ||
    data.rootId !== rootId
  )
    throw new Error("Independent owner changed");
  return data;
}
export async function readIndependentRecoveryReview(
  entry: IndependentRecoveryEntry,
  context: IndependentRecoveryContext,
) {
  const result = await requestOwnedJson(
    "/api/chores/routines/independent/recovery",
    {
      method: "POST",
      headers: { ...headers(context), "Content-Type": "application/json" },
      body: JSON.stringify({ contract: INDEPENDENT_RECOVERY_CONTRACT, entry }),
    },
  );
  if (result.kind !== "reply" || !result.response.ok)
    throw new Error("Independent review unavailable");
  const data = independentRecoveryReview.parse(result.body);
  if (
    data.ownerScope !== context.owner!.scope ||
    data.entry.key !== entry.key ||
    data.entry.kind !== entry.kind ||
    data.entry.body !== entry.body
  )
    throw new Error("Independent recovery changed");
  return data;
}
export type IndependentRoutineOutcome =
  | {
      kind: "confirmed";
      receipt: ReturnType<typeof routineIndependentReceipt.parse>;
    }
  | { kind: "unknown" }
  | { kind: "removed" }
  | { kind: "refused"; code: string };
export async function postIndependentRoutineStep(
  entry: IndependentRecoveryEntry,
  ownerScope: string,
): Promise<IndependentRoutineOutcome> {
  independentRecoveryEntry.parse(entry);
  const result = await requestOwnedJson("/api/chores/routines/independent", {
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
    const proof = routineIndependentReceipt.safeParse(result.body),
      command = routineIndependentCommand.parse(JSON.parse(entry.body));
    return proof.success &&
      proof.data.rootId === command.root_id &&
      proof.data.action === command.action &&
      proof.data.revision === command.expected_revision + 1
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

export async function readIndependentDraftContext() {
  const result = await requestOwnedJson(
    "/api/chores/routines/independent/recovery?draft=1",
    { headers: { "X-Member-Protocol": "2" } },
    16384,
  );
  if (result.kind !== "reply" || !result.response.ok)
    throw new Error("Independent draft context unavailable");
  return independentDraftContext.parse(result.body);
}
