/** Server-only integrity/lease binding. A seal is neither human approval nor
 * authority; the apply adapter independently renews identity and domain rules. */
import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { getJwtSecret } from "../auth";
import { canonicalRequestJson } from "../idempotency-request-json";
import type { FoodPlanActor } from "./server";
import type { ReviewedFoodWrite } from "./apply-contract";
const digest = z.string().regex(/^[a-f0-9]{64}$/);
const payloadSchema = z
  .object({
    v: z.literal(1),
    owner: digest,
    command: digest,
    source: digest,
    auxiliary: digest,
    issuedAt: z.string().datetime(),
    expiresAt: z.string().datetime(),
  })
  .strict();
export type FoodReviewSeal = z.infer<typeof payloadSchema>;
export class FoodReviewRefused extends Error {
  readonly code = "FOOD_REVIEW_CHANGED";
  constructor() {
    super("Review this food plan again before saving.");
  }
}
export function foodReviewDigest(
  domain: string,
  value: unknown,
  key = getJwtSecret(),
) {
  // Normalize Date instances and omitted optional fields before canonical order.
  return createHmac("sha256", key)
    .update(canonicalRequestJson([domain, JSON.parse(JSON.stringify(value))]))
    .digest("hex");
}
const commandDigest = (input: ReviewedFoodWrite, key: string) =>
  foodReviewDigest(
    "food-review.command.v1",
    { ...input, reviewProof: undefined },
    key,
  );
export function issueFoodReviewSeal(
  actor: FoodPlanActor,
  input: ReviewedFoodWrite,
  source: string,
  auxiliary: unknown,
  observed: Date,
  key = getJwtSecret(),
) {
  const payload = payloadSchema.parse({
    v: 1,
    owner: foodReviewDigest("food-review.owner.v1", actor, key),
    command: commandDigest(input, key),
    source,
    auxiliary: foodReviewDigest("food-review.auxiliary.v1", auxiliary, key),
    issuedAt: observed.toISOString(),
    expiresAt: new Date(+observed + 60000).toISOString(),
  });
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `fpr1.${encoded}.${foodReviewDigest("food-review.seal.v1", encoded, key)}`;
}
/** No expiry check here: completed receipt replay must not depend on sources. */
export function readFoodReviewSeal(
  actor: FoodPlanActor,
  input: ReviewedFoodWrite,
  key = getJwtSecret(),
): FoodReviewSeal {
  try {
    if (input.reviewProof.length > 4096) throw new Error();
    const parts = /^fpr1\.([A-Za-z0-9_-]+)\.([a-f0-9]{64})$/.exec(
      input.reviewProof,
    );
    if (
      !parts ||
      !timingSafeEqual(
        Buffer.from(parts[2], "hex"),
        Buffer.from(
          foodReviewDigest("food-review.seal.v1", parts[1], key),
          "hex",
        ),
      )
    )
      throw new Error();
    const bytes = Buffer.from(parts[1], "base64url");
    if (bytes.toString("base64url") !== parts[1]) throw new Error();
    const payload = payloadSchema.parse(JSON.parse(bytes.toString("utf8")));
    if (
      payload.owner !== foodReviewDigest("food-review.owner.v1", actor, key) ||
      payload.command !== commandDigest(input, key)
    )
      throw new Error();
    if (Date.parse(payload.expiresAt) - Date.parse(payload.issuedAt) !== 60000)
      throw new Error();
    return payload;
  } catch {
    throw new FoodReviewRefused();
  }
}
export function assertFoodReviewLease(
  payload: FoodReviewSeal,
  now = Date.now(),
) {
  if (
    !Number.isFinite(now) ||
    now < Date.parse(payload.issuedAt) - 1000 ||
    now >= Date.parse(payload.expiresAt)
  )
    throw new FoodReviewRefused();
}
