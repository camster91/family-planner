/**
 * One entry per app-held AI feature (#144). The registry is the only place a
 * feature's provider, model, token limit, output schema, data classes and
 * flag are chosen; routes look features up here instead of hard-coding them.
 * Adding a feature (snap a flyer, smart grocery add, dinner ideas) is a new
 * entry plus its own pure module, not a new provider client.
 */
import type { z } from "zod";
import type { AiJsonSchema, AiProviderId } from "./provider";
import {
  SMART_ADD_OUTPUT_JSON_SCHEMA,
  SMART_ADD_SYSTEM_PROMPT,
  smartAddProviderOutput,
} from "./smart-add";
import { CLAUDE_AI_READY_ENV } from "./flags";

/** What leaves our server for a feature. Anything not listed is never sent. */
export type AiDataClass =
  | "typed_text" // what the person typed, with household names aliased
  | "aliased_people" // placeholders only ("Person A"), never names/ids
  | "list_names" // grocery/shopping list names
  | "local_time"; // the viewer's local date, time and time zone

/** Classes that must never be sent by any feature. Enforced by tests. */
export const AI_FORBIDDEN_DATA_CLASSES = [
  "child_photo",
  "medical",
  "finance",
  "private_messages",
  "real_names",
  "household_ids",
] as const;

/** AiUsageRequest.job values for app-held (managed) AI. */
export type ManagedAiJob = "smart_add";
export const MANAGED_AI_JOBS: readonly ManagedAiJob[] = ["smart_add"];

export interface AiFeature<T> {
  id: ManagedAiJob;
  provider: AiProviderId;
  model: string;
  maxOutputTokens: number;
  timeoutMs: number;
  maxResponseBytes: number;
  system: string;
  jsonSchema: AiJsonSchema;
  output: z.ZodType<T>;
  dataClasses: readonly AiDataClass[];
  /** Deployment flag that must be exactly "1". */
  flag: string;
}

export const SMART_ADD_FEATURE: AiFeature<
  z.infer<typeof smartAddProviderOutput>
> = {
  id: "smart_add",
  provider: "claude",
  model: "claude-haiku-5-5",
  maxOutputTokens: 4096,
  timeoutMs: 20_000,
  maxResponseBytes: 64 * 1024,
  system: SMART_ADD_SYSTEM_PROMPT,
  jsonSchema: SMART_ADD_OUTPUT_JSON_SCHEMA as unknown as AiJsonSchema,
  output: smartAddProviderOutput,
  dataClasses: ["typed_text", "aliased_people", "list_names", "local_time"],
  flag: CLAUDE_AI_READY_ENV,
};

export const AI_FEATURES = { smart_add: SMART_ADD_FEATURE } as const;

/**
 * Public list prices, in integer micro-USD per million tokens, for models a
 * feature may use. Used for the conservative reservation and the settled
 * estimate; not an invoice. Claude Haiku 5.5: $0.10 input / $0.50 output per
 * million tokens (prompts under 100K tokens; ours are a few thousand).
 */
export const MODEL_RATES: Record<string, { input: string; output: string }> = {
  "claude-haiku-5-5": { input: "100000", output: "500000" },
};
