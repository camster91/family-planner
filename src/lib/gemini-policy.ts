/**
 * Release decision for Google Gemini (#144).
 *
 * On November 3, 2026 Cameron chose "Keep Gemini off pending provider
 * clarification". This is deliberately a source-level decision, not an
 * environment variable or household setting: a saved key, a deployment
 * fallback URL, pricing configuration or a missing flag must never turn Gemini
 * on. A later, separately approved activation changes this function in a
 * reviewed PR.
 *
 * Stored encrypted settings are preserved untouched; they are simply not used.
 */
export function geminiProviderApproved(): boolean {
  return false;
}

const GEMINI_HOSTS = new Set([
  "generativelanguage.googleapis.com",
  "aiplatform.googleapis.com",
]);

/** True when a provider URL points at a Google Gemini API host. */
export function isGeminiProviderUrl(value: string | null | undefined): boolean {
  if (!value) return false;
  let host: string;
  try {
    host = new URL(value.trim()).hostname.toLowerCase().replace(/\.$/, "");
  } catch {
    return false;
  }
  return (
    GEMINI_HOSTS.has(host) ||
    // Regional Vertex AI endpoints, e.g. us-central1-aiplatform.googleapis.com.
    /^[a-z0-9-]+-aiplatform\.googleapis\.com$/.test(host)
  );
}

/** True when this URL must not be contacted under the current decision. */
export function geminiBlocked(value: string | null | undefined): boolean {
  return !geminiProviderApproved() && isGeminiProviderUrl(value);
}

export const GEMINI_DISABLED_CODE = "GEMINI_DISABLED";
export const GEMINI_DISABLED_MESSAGE =
  "Google Gemini is turned off for now. Recipe links, saved recipes, quick meals and manual planning still work.";
