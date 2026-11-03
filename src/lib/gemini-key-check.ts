import { boundedRequestText } from "./bounded-request-text";
import { GEMINI_DEFAULT_MODEL } from "./gemini-settings";
import { geminiProviderApproved } from "./gemini-policy";

/** Metadata-only check: no generation, search, or household content is sent. */
export async function checkGeminiKey(
  apiKey: string,
): Promise<"valid" | "invalid" | "unavailable"> {
  // #144: no request reaches Google while Gemini is off.
  if (!geminiProviderApproved()) return "unavailable";
  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_DEFAULT_MODEL}`,
      {
        headers: { "x-goog-api-key": apiKey },
        redirect: "manual",
        cache: "no-store",
        signal: AbortSignal.timeout(8000),
      },
    );
    if (!response.ok) {
      await response.body?.cancel();
      return [400, 401, 403].includes(response.status)
        ? "invalid"
        : "unavailable";
    }
    const model = JSON.parse(await boundedRequestText(response, 32 * 1024));
    return model?.name === `models/${GEMINI_DEFAULT_MODEL}`
      ? "valid"
      : "unavailable";
  } catch {
    return "unavailable";
  }
}
