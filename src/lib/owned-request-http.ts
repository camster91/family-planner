/** Bounded foreground request. Timeout/parse/network uncertainty never confirms a write. */
import { readBoundedJsonResponse } from "@/lib/bounded-json-response";
/** Bound the whole foreground job, including pre-fetch decoding. Bridges may
 * ignore AbortSignal, so abort also settles the caller through a separate race.
 * Cancellation is uncertainty, never proof that a mutation did not commit.
 */
export async function runOwnedForeground<T>(
  work: (signal: AbortSignal) => Promise<T>,
  options: { signal?: AbortSignal | null; timeoutMs?: number } = {},
): Promise<T | { kind: "unknown" }> {
  const controller = new AbortController();
  let settle!: (value: { kind: "unknown" }) => void;
  const stopped = new Promise<{ kind: "unknown" }>((resolve) => {
    settle = resolve;
  });
  const stop = () => {
    controller.abort();
    settle({ kind: "unknown" });
  };
  const external = options.signal;
  if (external?.aborted) return { kind: "unknown" };
  external?.addEventListener("abort", stop, { once: true });
  const timer = setTimeout(stop, options.timeoutMs ?? 15000);
  try {
    return await Promise.race([
      // Deferral gives an abort in the current turn priority over starting work.
      Promise.resolve()
        .then(async (): Promise<T | { kind: "unknown" }> =>
          controller.signal.aborted
            ? { kind: "unknown" as const }
            : work(controller.signal),
        )
        .catch(() => ({ kind: "unknown" as const })),
      stopped,
    ]);
  } finally {
    clearTimeout(timer);
    external?.removeEventListener("abort", stop);
  }
}
export async function requestOwnedJson(
  path: string,
  init: RequestInit,
  bytes = 1024 * 1024,
) {
  return runOwnedForeground(
    async (signal) => {
      const response = await fetch(path, {
        ...init,
        cache: "no-store",
        credentials: "same-origin",
        signal,
      });
      const body = await readBoundedJsonResponse(response, signal, bytes);
      return { kind: "reply" as const, response, body };
    },
    { signal: init.signal },
  );
}
