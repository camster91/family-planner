/** Read-only recipe grocery review. No write, idempotency key or automatic retry. */
export async function readGroceryReview(
  params: URLSearchParams,
  signal: AbortSignal,
  fetchImpl: typeof fetch = fetch,
): Promise<unknown> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let cancel: (() => void) | undefined;
  const unavailable = () => new Error("Grocery review unavailable");
  const cancelled = new Promise<never>((_resolve, reject) => {
    cancel = () => {
      reject(unavailable());
      controller.abort();
    };
    signal.addEventListener("abort", cancel, { once: true });
    timer = setTimeout(cancel, 15_000);
    if (signal.aborted) cancel();
  });
  try {
    return await Promise.race([
      (async () => {
        if (controller.signal.aborted) throw unavailable();
        const response = await fetchImpl(
          `/api/lists/items/from-recipe/review?${params}`,
          { cache: "no-store", signal: controller.signal },
        );
        if (controller.signal.aborted || !response.ok) throw unavailable();
        return await response.json();
      })(),
      cancelled,
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    if (cancel) signal.removeEventListener("abort", cancel);
  }
}
