/** Canonical read-only recipe requests; reuse the shared foreground/body bounds. */
import { runOwnedForeground } from "@/lib/owned-request-http";
import { readBoundedJsonResponse } from "@/lib/bounded-json-response";

export async function readRecipeJson(
  path: string,
  signal: AbortSignal,
  options: { fetchImpl?: typeof fetch; timeoutMs?: number; headers?: HeadersInit; inspectResponse?: (response: Response) => void } = {},
): Promise<unknown> {
  const result = await runOwnedForeground(async (ownedSignal) => {
    const response = await (options.fetchImpl ?? fetch)(path, {
      cache: "no-store", signal: ownedSignal, ...(options.headers ? { headers: options.headers } : {}),
    });
    if (ownedSignal.aborted) throw new Error("Recipe read unavailable");
    options.inspectResponse?.(response);
    if (!response.ok) throw new Error("Recipe read unavailable");
    const body = await readBoundedJsonResponse(response, ownedSignal, 1024 * 1024);
    return { kind: "reply" as const, body };
  }, { signal, timeoutMs: options.timeoutMs ?? 15_000 });
  if (result.kind !== "reply") throw new Error("Recipe read unavailable");
  return result.body;
}
