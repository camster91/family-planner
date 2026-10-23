/** Content-free usage contracts; safe for client and transport type imports. */
import { z } from "zod";
export const AI_USAGE_FEEDBACK_HEADER = "X-AI-Feedback-Report";
export const AI_USAGE_FEEDBACK_PROTOCOL = "herewoven.food-ai-feedback.v1";
import { memberIdentityIdSchema as id } from "./member-subject-contract";
export const aiUsageOwner = z
  .object({
    userId: id,
    familyId: id,
    generation: z.number().int().nonnegative(),
  })
  .strict();
const micros = z
  .string()
  .regex(/^(0|[1-9][0-9]{0,12})$/)
  .refine((v) => BigInt(v) <= BigInt("1000000000000"));
const rate = micros.refine((v) => BigInt(v) <= BigInt("1000000000"));
export const aiUsagePolicy = z
  .object({
    enabled: z.boolean(),
    dailyLimit: z.number().int().min(1).max(10000),
    userDailyLimit: z.number().int().min(1).max(1000),
    monthlyBudgetMicrousd: micros.nullable(),
    inputRateMicrousdPerMillion: rate.nullable(),
    outputRateMicrousdPerMillion: rate.nullable(),
  })
  .strict()
  .refine(
    (v) =>
      (v.inputRateMicrousdPerMillion === null) ===
      (v.outputRateMicrousdPerMillion === null),
    "Supply both rates or neither",
  )
  .refine(
    (v) =>
      v.monthlyBudgetMicrousd === null ||
      v.inputRateMicrousdPerMillion !== null,
    "A cost limit needs both token rates",
  );
export type AiUsagePolicy = z.infer<typeof aiUsagePolicy>;
export const defaultAiUsagePolicy: AiUsagePolicy = {
  enabled: true,
  dailyLimit: 120,
  userDailyLimit: 40,
  monthlyBudgetMicrousd: null,
  inputRateMicrousdPerMillion: null,
  outputRateMicrousdPerMillion: null,
};
export const aiUsagePolicyCommand = z
  .object({
    owner: aiUsageOwner,
    expectedRevision: z.number().int().nonnegative(),
    configVersion: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .nullable(),
    policy: aiUsagePolicy,
  })
  .strict();
export const aiUsageDay = z
  .object({
    day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    attempts: z.number().int().nonnegative(),
    accepted: z.number().int().nonnegative(),
    refused: z.number().int().nonnegative(),
    failed: z.number().int().nonnegative(),
    unfinished: z.number().int().nonnegative(),
    timeouts: z.number().int().nonnegative(),
    inputTokens: z.string().regex(/^\d+$/),
    outputTokens: z.string().regex(/^\d+$/),
    unknownTokenCalls: z.number().int().nonnegative(),
    estimatedMicrousd: z.string().regex(/^\d+$/),
    reservedMicrousd: z.string().regex(/^\d+$/),
    unknownCostCalls: z.number().int().nonnegative(),
    latencyTotalMs: z.string().regex(/^\d+$/),
    measuredCalls: z.number().int().nonnegative(),
  })
  .strict();
export const aiUsageReport = z
  .object({
    owner: aiUsageOwner,
    ready: z.boolean(),
    providerPaused: z.boolean(),
    providerLabel: z.string().max(520).nullable(),
    revision: z.number().int().nonnegative(),
    policy: aiUsagePolicy,
    pricingCurrent: z.boolean(),
    configVersion: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .nullable(),
    suggestionFeedback: z
      .object({
        used: z.string().regex(/^(0|[1-9][0-9]*)$/),
        kept: z.string().regex(/^(0|[1-9][0-9]*)$/),
      })
      .strict()
      .nullable()
      .default(null),
    days: z.array(aiUsageDay).max(31),
    month: z.string().regex(/^\d{4}-\d{2}$/),
    today: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  })
  .strict();
export type AiUsageReport = z.infer<typeof aiUsageReport>;
export type ProviderUsageObserver = {
  start: (input: {
    inputBytes: number;
    maxOutputTokens: number;
  }) => Promise<void>;
  reported: (usage: {
    inputTokens: number | null;
    outputTokens: number | null;
  }) => void;
  failed: (reason: "timeout" | "error") => void;
};
export function reportedTokenCount(value: unknown): number | null {
  return typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= 0 &&
    value <= 100_000_000
    ? value
    : null;
}
export function estimateAiMicrousd(
  input: number,
  output: number,
  policy: AiUsagePolicy,
): string | null {
  if (
    policy.inputRateMicrousdPerMillion === null ||
    policy.outputRateMicrousdPerMillion === null
  )
    return null;
  if (
    !Number.isSafeInteger(input) ||
    !Number.isSafeInteger(output) ||
    input < 0 ||
    output < 0
  )
    throw new Error("Invalid token count");
  return (
    (BigInt(input) * BigInt(policy.inputRateMicrousdPerMillion) +
      BigInt(output) * BigInt(policy.outputRateMicrousdPerMillion) +
      BigInt("999999")) /
    BigInt("1000000")
  ).toString();
}
/** USD decimal input to integer micro-USD, without floating-point money math. */
export function usdToMicrousd(value: string): string | null {
  const match = /^(0|[1-9]\d{0,6})(?:\.(\d{1,6}))?$/.exec(value.trim());
  return match
    ? (
        BigInt(match[1]) * BigInt("1000000") +
        BigInt((match[2] ?? "").padEnd(6, "0"))
      ).toString()
    : null;
}
export function microusdToUsd(value: string | null): string {
  if (value === null) return "";
  const n = BigInt(value);
  return (
    `${n / BigInt("1000000")}.${(n % BigInt("1000000")).toString().padStart(6, "0")}`.replace(
      /\.?0+$/,
      "",
    ) || "0"
  );
}
