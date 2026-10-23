import { requestOwnedJson as request } from "@/lib/owned-request-http";
import {
  weeklyResetView,
  weeklyResetReceipt,
  weeklyResetCommand,
  type WeeklyResetScope,
} from "@/lib/weekly-reset";
import { weeklyResetSummary } from "@/lib/weekly-reset-summary-contract";
import {
  weeklyResetRecoveryContext,
  weeklyResetRecoveryReview,
  WEEKLY_RESET_RECOVERY,
  WEEKLY_RESET_OWNER_HEADER,
  type WeeklyResetRecoveryContext,
  type WeeklyResetRecoveryEntry,
} from "@/lib/weekly-reset-recovery";
export async function readWeeklyResetContext() {
  const result = await request(
    "/api/coordination/weekly-reset/recovery",
    {},
    16384,
  );
  if (result.kind !== "reply" || !result.response.ok)
    throw new Error("Review unavailable");
  return weeklyResetRecoveryContext.parse(result.body);
}
export async function readWeeklyResetView(
  context: Pick<WeeklyResetRecoveryContext, "userId" | "familyId">,
  scope: WeeklyResetScope,
) {
  const result = await request(
    `/api/coordination/weekly-reset?${new URLSearchParams(scope)}`,
    {},
    16384,
  );
  if (result.kind !== "reply" || !result.response.ok)
    throw new Error("Review unavailable");
  const value = weeklyResetView.parse(
    (result.body as { review?: unknown })?.review,
  );
  if (
    value.owner.userId !== context.userId ||
    value.owner.familyId !== context.familyId ||
    value.scope.weekStart !== scope.weekStart ||
    value.scope.timeZone !== scope.timeZone
  )
    throw new Error("Review owner changed");
  return value;
}
export async function readWeeklyResetStep(
  context: Pick<WeeklyResetRecoveryContext, "userId" | "familyId">,
  scope: WeeklyResetScope,
  step: ReturnType<typeof weeklyResetView.parse>["steps"][number]["id"],
) {
  const result = await request(
    `/api/coordination/weekly-reset/summary?${new URLSearchParams({ ...scope, step })}`,
    {},
    65536,
  );
  if (result.kind !== "reply" || !result.response.ok)
    throw new Error("Step unavailable");
  const value = weeklyResetSummary.parse(
    (result.body as { summary?: unknown })?.summary,
  );
  if (
    value.owner.userId !== context.userId ||
    value.owner.familyId !== context.familyId ||
    value.scope.weekStart !== scope.weekStart ||
    value.scope.timeZone !== scope.timeZone ||
    value.step !== step
  )
    throw new Error("Review owner changed");
  return value;
}
export async function inspectWeeklyReset(
  entry: WeeklyResetRecoveryEntry,
  context: WeeklyResetRecoveryContext,
) {
  if (!context.owner) throw new Error("Review owner changed");
  const result = await request(
    "/api/coordination/weekly-reset/recovery",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        [WEEKLY_RESET_OWNER_HEADER]: context.owner.scope,
      },
      body: JSON.stringify({ contract: WEEKLY_RESET_RECOVERY, entry }),
    },
    16384,
  );
  if (result.kind !== "reply" || !result.response.ok)
    throw new Error("Recovery unavailable");
  const value = weeklyResetRecoveryReview.parse(result.body);
  if (
    value.ownerScope !== context.owner.scope ||
    value.entry.key !== entry.key ||
    value.entry.body !== entry.body
  )
    throw new Error("Recovery owner changed");
  return value;
}
export async function sendWeeklyReset(
  entry: WeeklyResetRecoveryEntry,
  ownerScope: string,
) {
  const command = weeklyResetCommand.parse(JSON.parse(entry.body));
  const result = await request(
    "/api/coordination/weekly-reset",
    {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key": entry.key,
        [WEEKLY_RESET_OWNER_HEADER]: ownerScope,
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
  const parsed = weeklyResetReceipt.safeParse(result.body);
  const receipt = parsed.success ? parsed.data.receipt : null;
  return receipt &&
    receipt.userId === command.userId &&
    receipt.familyId === command.familyId &&
    receipt.weekStart === command.weekStart &&
    receipt.timeZone === command.timeZone &&
    receipt.action === command.action
    ? { kind: "confirmed" as const, receipt }
    : { kind: "unknown" as const };
}
