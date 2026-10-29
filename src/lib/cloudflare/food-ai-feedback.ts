/** Native D1 feedback receipt for the optional food-planning suggestion count.
 * Only a fixed decision and an aggregate metric are stored; tickets and
 * provider content never enter D1. */
import { foodAiFeedbackInput, foodAiFeedbackReply } from "@/lib/food-planning/ai-contract";
import { isAiUsageReady } from "@/lib/ai-usage-gates";
import { readFoodAiFeedback } from "@/lib/food-planning/ai-feedback";
import { prepareD1BetaMetricEffects } from "@/lib/beta-metrics";
import { executeD1PersonEffect, type NativePersonResult } from "./person-effect";
import { d1WriteCheck } from "./write-check";
import type { D1ReadClient } from "./read-client";
import type { D1Store } from "./database";

const ACTION = "food-ai.feedback.v1";
const metricFor = (decision: "used" | "kept") =>
  decision === "used" ? "food_ai_choices_used" : "food_ai_choices_kept";

export type D1FoodAiFeedbackActor = {
  userId: string;
  familyId: string;
  role: string;
  generation: number;
};

const refusal = (status: number, code: string) => ({
  status,
  body: { error: { code } },
});

/** Parent-only monthly aggregate projection; no decision or ticket content. */
export async function readD1FoodAiFeedbackCounts(
  database: D1Store,
  familyId: string,
  now = new Date(),
) {
  const from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
    .toISOString()
    .slice(0, 10);
  const through = now.toISOString().slice(0, 10);
  const row = await database
    .withSession("first-primary")
    .prepare(
      `SELECT
         COALESCE(SUM(CASE WHEN metric='food_ai_choices_used' THEN count ELSE 0 END),0) AS used,
         COALESCE(SUM(CASE WHEN metric='food_ai_choices_kept' THEN count ELSE 0 END),0) AS kept
       FROM "BetaMetricDaily"
       WHERE family_id=?1 AND day>=?2 AND day<=?3`,
    )
    .bind(familyId, from, through)
    .first<{ used: number | string; kept: number | string }>();
  return { used: String(row?.used ?? 0), kept: String(row?.kept ?? 0) };
}

async function authorize(
  db: D1ReadClient,
  actor: D1FoodAiFeedbackActor,
) {
  if (!isAiUsageReady()) throw new Error("Food feedback paused");
  const [user, family] = await Promise.all([
    db.user.findUnique({
      where: { id: actor.userId },
      select: { family_id: true, role: true, token_version: true },
    }),
    db.family.findUnique({
      where: { id: actor.familyId },
      select: { beta_metrics_enabled: true },
    }),
  ]);
  if (
    !user ||
    user.family_id !== actor.familyId ||
    user.role !== actor.role ||
    user.token_version !== actor.generation
  )
    return refusal(401, "UNAUTHORIZED");
  if (!['parent', 'teen'].includes(user.role))
    return refusal(403, "FORBIDDEN");
  // Turning counts off must not create a feedback receipt. This mirrors the
  // PostgreSQL transaction's skipped state and preserves the privacy control.
  if (!family || !family.beta_metrics_enabled)
    return {
      status: 200,
      body: foodAiFeedbackReply.parse({
        protocol: "herewoven.food-ai-feedback.v1",
        state: "skipped",
      }),
    };
  return null;
}

/** Record one signed decision, atomically deduplicated by the ticket nonce. */
export async function recordD1FoodAiFeedback(
  actor: D1FoodAiFeedbackActor,
  raw: unknown,
  database?: D1Store,
  now = new Date(),
): Promise<NativePersonResult> {
  if (!isAiUsageReady()) throw new Error("Food feedback paused");
  const input = foodAiFeedbackInput.parse(raw);
  const ticket = readFoodAiFeedback(input.ticket, actor, now.getTime());
  const key = `food_ai_feedback_${ticket.nonce}`;
  return executeD1PersonEffect({
    actor,
    action: ACTION,
    input,
    key,
    database,
    now,
    authorize: db => authorize(db, actor),
    plan: async (_db, _recordId) => {
      readFoodAiFeedback(input.ticket, actor, now.getTime());
      if (!isAiUsageReady()) throw new Error("Food feedback paused");
      const metric = metricFor(input.decision);
      return {
        status: 200,
        body: foodAiFeedbackReply.parse({
          protocol: "herewoven.food-ai-feedback.v1",
          state: "recorded",
        }),
        effects: session => prepareD1BetaMetricEffects(session, actor.familyId, metric, now),
      };
    },
    effectChecks: async _store => ({
      checks: session => [
        d1WriteCheck(
          session,
          `EXISTS(SELECT 1 FROM "Family" WHERE id=?1 AND beta_metrics_enabled=1)`,
          [actor.familyId],
        ),
      ],
    }),
  });
}
