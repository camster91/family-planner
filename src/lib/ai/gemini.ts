/**
 * Placeholder for a future Gemini provider behind the same interface.
 *
 * Gemini stays blocked (owner decisions 2026-11-03 and 2026-11-19): Google's
 * Gemini API terms restrict clients likely to be used by under-18s, and this
 * app has teen accounts. `geminiProviderApproved()` is a source-level `false`;
 * no env var, key or household setting can change that. When a reviewed PR
 * approves Gemini, implement `generateStructured` here and add it to the
 * registry; features and routes do not change.
 */
import { geminiProviderApproved } from "@/lib/gemini-policy";
import { AiProviderError, type AiProvider } from "./provider";

export function createGeminiProvider(): AiProvider {
  return {
    id: "gemini",
    async generateStructured() {
      // Even if approved later, this adapter is not implemented yet.
      void geminiProviderApproved();
      throw new AiProviderError("AI_PROVIDER_BLOCKED");
    },
  };
}
