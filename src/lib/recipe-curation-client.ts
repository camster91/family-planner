/** Shared bounded curation transport; owner admission belongs to the mounted draft. */
import { runOwnedForeground } from "@/lib/owned-request-http";
import { readBoundedJsonResponse } from "@/lib/bounded-json-response";
export async function requestRecipeCurationJson(path: string, init: RequestInit, limit: number) {
  return runOwnedForeground(async signal => {
    const response = await fetch(path, { ...init, signal, credentials: "same-origin", cache: "no-store" });
    const body = response.status === 401 || response.status === 403
      ? null : await readBoundedJsonResponse(response, signal, limit);
    return { kind: "reply" as const, response, body };
  }, { signal: init.signal });
}
