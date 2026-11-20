/**
 * Claude (Anthropic Messages API) behind the provider-neutral interface.
 * Server-only. Uses the official `@anthropic-ai/sdk`, which is fetch-based and
 * runs on Cloudflare Workers; the fetch it uses is wrapped so that:
 * - the host is fixed (`https://api.anthropic.com`, never env/request-selected);
 * - redirects are never followed;
 * - a provider error body is dropped unread (it can echo the request);
 * - a success body larger than the feature's bound is refused;
 * - nothing about the request or reply is logged (status codes only, by callers).
 * The SDK's own retries are off: every call is a single, pre-reserved spend.
 */
import Anthropic from "@anthropic-ai/sdk";
import {
  AiProviderError,
  type AiProvider,
  type AiStructuredRequest,
  type AiStructuredResult,
  type AiUsageReport,
} from "./provider";

export const CLAUDE_BASE_URL = "https://api.anthropic.com";

type FetchLike = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

class ResponseTooLarge extends Error {}

/** Read at most `max` bytes of a body; throws ResponseTooLarge beyond that. */
async function readBounded(
  response: Response,
  max: number,
): Promise<Uint8Array> {
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > max) {
    await response.body?.cancel().catch(() => undefined);
    throw new ResponseTooLarge();
  }
  if (!response.body) {
    const buffer = new Uint8Array(await response.arrayBuffer());
    if (buffer.byteLength > max) throw new ResponseTooLarge();
    return buffer;
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > max) {
      await reader.cancel().catch(() => undefined);
      throw new ResponseTooLarge();
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

/** The fetch handed to the SDK. Exported for tests. */
export function boundedProviderFetch(
  base: FetchLike,
  maxResponseBytes: number,
  state: { oversized: boolean },
): FetchLike {
  return async (input, init) => {
    const response = await base(input, { ...init, redirect: "manual" });
    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined);
      return new Response(null, {
        status: response.status,
        headers: { "content-type": "application/json" },
      });
    }
    let bytes: Uint8Array;
    try {
      bytes = await readBounded(response, maxResponseBytes);
    } catch (error) {
      if (error instanceof ResponseTooLarge) state.oversized = true;
      throw error;
    }
    return new Response(bytes as BodyInit, {
      status: response.status,
      headers: { "content-type": "application/json" },
    });
  };
}

function usageOf(
  message: { usage?: unknown } | null | undefined,
): AiUsageReport {
  const usage = (message?.usage ?? null) as {
    input_tokens?: unknown;
    output_tokens?: unknown;
    cache_creation_input_tokens?: unknown;
    cache_read_input_tokens?: unknown;
  } | null;
  const count = (v: unknown) =>
    typeof v === "number" && Number.isSafeInteger(v) && v >= 0 ? v : null;
  const input = count(usage?.input_tokens);
  const cacheWrite = count(usage?.cache_creation_input_tokens) ?? 0;
  const cacheRead = count(usage?.cache_read_input_tokens) ?? 0;
  return {
    inputTokens: input === null ? null : input + cacheWrite + cacheRead,
    outputTokens: count(usage?.output_tokens),
  };
}

export interface ClaudeProviderOptions {
  apiKey: string;
  /** Injected in tests; defaults to the platform fetch. */
  fetch?: FetchLike;
}

export function createClaudeProvider(
  options: ClaudeProviderOptions,
): AiProvider {
  return {
    id: "claude",
    async generateStructured(
      request: AiStructuredRequest,
    ): Promise<AiStructuredResult> {
      const state = { oversized: false };
      const client = new Anthropic({
        apiKey: options.apiKey,
        authToken: null,
        baseURL: CLAUDE_BASE_URL,
        maxRetries: 0,
        timeout: request.timeoutMs,
        logLevel: "off",
        fetch: boundedProviderFetch(
          options.fetch ?? ((input, init) => fetch(input, init)),
          request.maxResponseBytes,
          state,
        ),
      });
      let message: Anthropic.Message;
      try {
        message = await client.messages.create(
          {
            model: request.model,
            max_tokens: request.maxOutputTokens,
            system: request.system,
            output_config: {
              effort: "low",
              format: { type: "json_schema", schema: request.schema },
            },
            messages: [{ role: "user", content: request.user }],
          },
          { signal: request.signal },
        );
      } catch (error) {
        if (state.oversized)
          throw new AiProviderError("AI_PROVIDER_BAD_OUTPUT");
        if (error instanceof Anthropic.APIConnectionTimeoutError)
          throw new AiProviderError("AI_PROVIDER_UNAVAILABLE", null, "timeout");
        if (error instanceof Anthropic.APIUserAbortError)
          throw new AiProviderError("AI_PROVIDER_UNAVAILABLE", null, "timeout");
        if (error instanceof Anthropic.APIError)
          throw new AiProviderError(
            "AI_PROVIDER_UNAVAILABLE",
            typeof error.status === "number" ? error.status : null,
          );
        // JSON parse failure of a 2xx body or anything unexpected: content-free.
        throw new AiProviderError("AI_PROVIDER_BAD_OUTPUT");
      }
      const usage = usageOf(message);
      if (message.stop_reason === "refusal") return { kind: "refused", usage };
      if (message.stop_reason === "max_tokens")
        throw new AiProviderError(
          "AI_PROVIDER_BAD_OUTPUT",
          200,
          "error",
          usage,
        );
      const text = message.content
        .map((block) => (block.type === "text" ? block.text : ""))
        .join("")
        .trim();
      if (!text)
        throw new AiProviderError(
          "AI_PROVIDER_BAD_OUTPUT",
          200,
          "error",
          usage,
        );
      try {
        return { kind: "json", value: JSON.parse(text), usage };
      } catch {
        throw new AiProviderError(
          "AI_PROVIDER_BAD_OUTPUT",
          200,
          "error",
          usage,
        );
      }
    },
  };
}
