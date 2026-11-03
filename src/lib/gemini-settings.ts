/** Supported Gemini preset. Shared constants contain no credentials. */
export const GEMINI_BASE_URL =
  "https://generativelanguage.googleapis.com/v1beta/openai";
export const GEMINI_DEFAULT_MODEL = "gemini-3.8-flash";
export function isGeminiBaseUrl(value: string) {
  return [
    GEMINI_BASE_URL,
    "https://generativelanguage.googleapis.com/v1beta",
  ].includes(value.replace(/\/$/, ""));
}
