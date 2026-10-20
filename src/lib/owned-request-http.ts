/** Bounded foreground request. Timeout/parse/network uncertainty never confirms a write. */
import { readBoundedJsonResponse } from "@/lib/bounded-json-response";
export async function requestOwnedJson(
  path: string,
  init: RequestInit,
  bytes = 1024 * 1024,
) {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      (async () => {
        const response = await fetch(path, {
          ...init,
          cache: "no-store",
          credentials: "same-origin",
          signal: controller.signal,
        });
        const body = await readBoundedJsonResponse(
          response,
          controller.signal,
          bytes,
        );
        return { kind: "reply" as const, response, body };
      })().catch(() => ({ kind: "unknown" as const })),
      new Promise<{ kind: "unknown" }>((resolve) => {
        timer = setTimeout(() => {
          controller.abort();
          resolve({ kind: "unknown" });
        }, 15000);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
