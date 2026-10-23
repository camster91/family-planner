/** Optional fixed-vocabulary counts, never prompts/recipes or save outcomes.
 * One signed suggestion permits one decision. Receipt + opt-in aggregate share
 * a transaction; a lost reply/retry cannot count twice or change the decision. */
import {
  createHmac,
  createHash,
  timingSafeEqual,
  randomUUID,
} from "node:crypto";
import type { Prisma, PrismaClient } from "@prisma/client";
import { getJwtSecret } from "../auth";
import { lockUser, lockHousehold } from "../household-lock";
import { recordBetaMetricInTransaction } from "../beta-metrics";
import { isAiUsageReady } from "../ai-usage-gates";
import { canonicalRequestJson } from "../idempotency-request-json";
import {
  foodAiFeedbackTicket,
  foodAiFeedbackInput,
  foodAiFeedbackReply,
} from "./ai-contract";
import type { FoodPlanActor } from "./server";
const ACTION = "food-ai.feedback.v1";
const TTL = 10 * 60000;
const mac = (owner: FoodPlanActor, payload: string, key: string) =>
  createHmac("sha256", key)
    .update(
      canonicalRequestJson([
        ACTION,
        owner.userId,
        owner.familyId,
        owner.role,
        owner.generation,
        payload,
      ]),
    )
    .digest("hex");
export function issueFoodAiFeedback(
  owner: FoodPlanActor,
  now = Date.now(),
  key = getJwtSecret(),
) {
  const payload = `faf1.${now}.${randomUUID()}`;
  return foodAiFeedbackTicket.parse(`${payload}.${mac(owner, payload, key)}`);
}
export function readFoodAiFeedback(
  ticket: string,
  owner: FoodPlanActor,
  now = Date.now(),
  key = getJwtSecret(),
) {
  const parsed = foodAiFeedbackTicket.parse(ticket),
    parts = parsed.split(".");
  const payload = parts.slice(0, 3).join("."),
    issued = Number(parts[1]);
  const actual = Buffer.from(parts[3], "hex"),
    expected = Buffer.from(mac(owner, payload, key), "hex");
  if (
    !Number.isFinite(now) ||
    now < issued ||
    now >= issued + TTL ||
    actual.length !== expected.length ||
    !timingSafeEqual(actual, expected)
  )
    throw new Error("Food feedback unavailable");
  return { nonce: parts[2], issued };
}
export async function recordFoodAiFeedback(
  db: Pick<PrismaClient, "$transaction">,
  owner: FoodPlanActor,
  raw: unknown,
) {
  const input = foodAiFeedbackInput.parse(raw);
  if (!isAiUsageReady()) throw new Error("Food feedback paused");
  const ticket = readFoodAiFeedback(input.ticket, owner);
  const hash = createHash("sha256")
    .update(`${ACTION}\n${canonicalRequestJson(input)}`)
    .digest("hex");
  return db.$transaction(
    async (tx) => {
      await lockUser(tx, owner.userId);
      await lockHousehold(tx, owner.familyId);
      await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id"=${owner.userId} FOR SHARE`;
      const person = await tx.user.findUnique({
        where: { id: owner.userId },
        select: { family_id: true, role: true, token_version: true },
      });
      if (
        !person ||
        person.family_id !== owner.familyId ||
        person.role !== owner.role ||
        !["parent", "teen"].includes(person.role) ||
        person.token_version !== owner.generation
      )
        throw new Error("Food feedback owner changed");
      const families = await tx.$queryRaw<
        Array<{ beta_metrics_enabled: boolean }>
      >`
      SELECT "beta_metrics_enabled" FROM "Family" WHERE "id"=${owner.familyId} FOR SHARE`;
      // Turning counts off removes aggregates through the existing privacy control.
      // Do not create even a feedback receipt while counts are off.
      if (!families[0]?.beta_metrics_enabled)
        return foodAiFeedbackReply.parse({
          protocol: "herewoven.food-ai-feedback.v1",
          state: "skipped",
        });
      const scope = `user:${owner.userId}`,
        key = `food_ai_feedback_${ticket.nonce}`;
      const prior = await tx.idempotencyRecord.findFirst({
        where: { scope, key },
      });
      if (prior) {
        if (
          prior.family_id !== owner.familyId ||
          prior.user_id !== owner.userId ||
          prior.action !== ACTION ||
          prior.request_hash !== hash ||
          prior.response_status !== 200
        )
          throw new Error("Food feedback unavailable");
        readFoodAiFeedback(input.ticket, owner);
        if (!isAiUsageReady()) throw new Error("Food feedback paused");
        return foodAiFeedbackReply.parse(prior.response_body);
      }
      readFoodAiFeedback(input.ticket, owner);
      if (!isAiUsageReady()) throw new Error("Food feedback paused");
      await recordBetaMetricInTransaction(
        tx,
        owner.familyId,
        input.decision === "used"
          ? "food_ai_choices_used"
          : "food_ai_choices_kept",
      );
      const reply = foodAiFeedbackReply.parse({
        protocol: "herewoven.food-ai-feedback.v1",
        state: "recorded",
      });
      await tx.idempotencyRecord.create({
        data: {
          scope,
          key,
          family_id: owner.familyId,
          user_id: owner.userId,
          action: ACTION,
          request_hash: hash,
          response_status: 200,
          response_body: reply,
          expires_at: new Date(ticket.issued + 7 * 86400000),
        },
      });
      // Refuse and roll back aggregate + receipt together if the lease/gate changed.
      readFoodAiFeedback(input.ticket, owner);
      if (!isAiUsageReady()) throw new Error("Food feedback paused");
      return reply;
    },
    { timeout: 10000 },
  );
}

/** Parent usage panel only. Counts are household aggregates for the UTC month,
 * not accepted HTTP responses, preference accuracy or successful domain saves. */
export async function readFoodAiFeedbackCounts(
  tx: Pick<Prisma.TransactionClient, "$queryRaw">,
  familyId: string,
  now = new Date(),
) {
  const from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
    .toISOString()
    .slice(0, 10);
  const through = now.toISOString().slice(0, 10);
  const rows = await tx.$queryRaw<Array<{ used: string; kept: string }>>`
    SELECT COALESCE(SUM("count") FILTER(WHERE "metric"='food_ai_choices_used'),0)::text AS used,
      COALESCE(SUM("count") FILTER(WHERE "metric"='food_ai_choices_kept'),0)::text AS kept
    FROM "BetaMetricDaily" WHERE "family_id"=${familyId} AND "day">=${from}::date AND "day"<=${through}::date`;
  return rows[0] ?? { used: "0", kept: "0" };
}
