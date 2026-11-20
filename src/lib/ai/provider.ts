/**
 * Provider-neutral interface for app-held AI (#144). A feature never talks to
 * a vendor SDK directly: it asks a provider for one structured JSON answer.
 * Claude is the only active provider (owner decision 2026-11-19). Another
 * provider (for example Gemini, once its terms allow this audience) can be
 * added behind the same interface without touching features or routes.
 */

export type AiProviderId = "claude" | "gemini";

/** A JSON schema for the provider's constrained output (no length/number bounds: zod enforces those). */
export type AiJsonSchema = Record<string, unknown>;

export interface AiStructuredRequest {
  model: string;
  system: string;
  /** The one user turn. Already minimized and aliased by the caller. */
  user: string;
  maxOutputTokens: number;
  schema: AiJsonSchema;
  /** Total wall-clock budget for the provider call. */
  timeoutMs: number;
  /** Largest provider response body we will read, in bytes. */
  maxResponseBytes: number;
  signal?: AbortSignal;
}

export interface AiUsageReport {
  inputTokens: number | null;
  outputTokens: number | null;
}

export type AiStructuredResult =
  | { kind: "json"; value: unknown; usage: AiUsageReport }
  /** The provider declined (safety refusal). Content-free. */
  | { kind: "refused"; usage: AiUsageReport };

export type AiProviderErrorCode =
  | "AI_PROVIDER_UNAVAILABLE" // network, 5xx, 429, timeout, auth
  | "AI_PROVIDER_BAD_OUTPUT" // unreadable, truncated, oversized, off-schema
  | "AI_PROVIDER_BLOCKED"; // provider not approved for this app

/** Content-free provider failure. `upstreamStatus` is the only detail that may be logged. */
export class AiProviderError extends Error {
  constructor(
    readonly code: AiProviderErrorCode,
    readonly upstreamStatus: number | null = null,
    readonly reason: "timeout" | "error" = "error",
    readonly usage: AiUsageReport | null = null,
  ) {
    super(code);
    this.name = "AiProviderError";
  }
}

export interface AiProvider {
  readonly id: AiProviderId;
  generateStructured(request: AiStructuredRequest): Promise<AiStructuredResult>;
}
