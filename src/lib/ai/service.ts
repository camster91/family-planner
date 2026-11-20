/**
 * Server-only entry point for app-held AI features (#144). One place enforces
 * the order every feature follows:
 *   gates -> minimize/alias -> reserve budget -> one provider call ->
 *   zod validation -> settle usage -> map placeholders back.
 * The provider answer is only ever a proposal; nothing here writes household
 * records. Logs carry status codes only, never content.
 */
import { createClaudeProvider } from "./claude";
import { createGeminiProvider } from "./gemini";
import { claudeAiDeploymentReady, claudeApiKey } from "./flags";
import {
  AiProviderError,
  type AiProvider,
  type AiUsageReport,
} from "./provider";
import type { AiFeature } from "./registry";
import {
  reserveManagedAi,
  settleManagedAi,
  type ManagedAiActor,
} from "./meter";
import type { AiSettingDb } from "./household-setting";

/** The provider for a feature, or null when it may not run on this deployment. */
export function providerFor(feature: AiFeature<unknown>): AiProvider | null {
  if (feature.provider === "gemini") return createGeminiProvider();
  if (!claudeAiDeploymentReady()) return null;
  const apiKey = claudeApiKey();
  return apiKey ? createClaudeProvider({ apiKey }) : null;
}

export type FeatureRunResult<T> =
  { kind: "ok"; value: T } | { kind: "refused" };

export interface ManagedRun<T> {
  result: FeatureRunResult<T>;
  settle: (status: number) => Promise<void>;
}

/**
 * Reserve, call once, validate, settle. Throws AiUsageError (budget/pause/
 * authority) before any provider call, or AiProviderError after one.
 * `settleStatus` lets the caller record the HTTP status it finally returns.
 */
export async function runManagedFeature<T>(input: {
  db: AiSettingDb;
  actor: ManagedAiActor;
  feature: AiFeature<T>;
  provider: AiProvider;
  user: string;
  signal?: AbortSignal;
}): Promise<ManagedRun<T>> {
  const { db, actor, feature, provider } = input;
  const inputBytes =
    new TextEncoder().encode(feature.system).byteLength +
    new TextEncoder().encode(input.user).byteLength;
  const reservation = await reserveManagedAi(
    db,
    actor,
    feature.id,
    feature.model,
    {
      inputBytes,
      maxOutputTokens: feature.maxOutputTokens,
    },
  );
  let usage: AiUsageReport | null = null;
  let providerStatus: "response" | "timeout" | "error" = "error";
  let settled = false;
  const settle = async (status: number) => {
    if (settled) return;
    settled = true;
    await settleManagedAi(db, actor, feature.model, reservation, {
      status,
      providerStatus,
      usage,
    });
  };
  try {
    const answer = await provider.generateStructured({
      model: feature.model,
      system: feature.system,
      user: input.user,
      maxOutputTokens: feature.maxOutputTokens,
      schema: feature.jsonSchema,
      timeoutMs: feature.timeoutMs,
      maxResponseBytes: feature.maxResponseBytes,
      signal: input.signal,
    });
    providerStatus = "response";
    usage = answer.usage;
    if (answer.kind === "refused")
      return { result: { kind: "refused" }, settle };
    const parsed = feature.output.safeParse(answer.value);
    if (!parsed.success) {
      await settle(502);
      throw new AiProviderError("AI_PROVIDER_BAD_OUTPUT", 200, "error", usage);
    }
    return { result: { kind: "ok", value: parsed.data }, settle };
  } catch (error) {
    if (error instanceof AiProviderError) {
      providerStatus =
        error.reason === "timeout"
          ? "timeout"
          : error.upstreamStatus === 200
            ? "response"
            : "error";
      usage = usage ?? error.usage;
      await settle(error.code === "AI_PROVIDER_BAD_OUTPUT" ? 502 : 503);
      throw error;
    }
    await settle(500);
    throw error;
  }
}
