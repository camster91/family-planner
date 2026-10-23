/** Stream-bounded JSON decoding, including abort-ignoring native bridge fallback. */
/** Even implementations that ignore AbortSignal must settle the owner promptly. */
export function abortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const abort = () => reject(new Error("Response read aborted"));
    if (signal.aborted) {
      void promise.catch(() => undefined);
      abort();
      return;
    }
    signal.addEventListener("abort", abort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener("abort", abort);
        resolve(value);
      },
      (error) => {
        signal.removeEventListener("abort", abort);
        reject(error);
      },
    );
  });
}
export async function readBoundedJsonResponse(
  response: Response,
  signal: AbortSignal,
  limit = 2 * 1024 * 1024,
): Promise<unknown> {
  if (signal.aborted) {
    void response.body?.cancel().catch(() => undefined);
    throw new Error("Response read aborted");
  }
  const declared = Number(response.headers?.get("content-length"));
  if (declared > limit) {
    void response.body?.cancel().catch(() => undefined);
    throw new Error("Response too large");
  }
  const reader = response.body?.getReader();
  if (!reader) {
    // Older fetch bridges/test doubles expose JSON only: post-parse bound,
    // not a claim of pre-allocation streaming protection on those platforms.
    const data: unknown = await abortable(response.json(), signal);
    const serialized = JSON.stringify(data);
    if (typeof serialized !== "string" || new Blob([serialized]).size > limit)
      throw new Error("Response too large");
    return data;
  }
  const abort = () => {
    void reader.cancel().catch(() => undefined);
  };
  signal.addEventListener("abort", abort, { once: true });
  const decoder = new TextDecoder();
  let size = 0,
    text = "";
  try {
    while (true) {
      const part = await abortable(reader.read(), signal);
      if (part.done) break;
      size += part.value.byteLength;
      if (size > limit) {
        void reader.cancel().catch(() => undefined);
        throw new Error("Response too large");
      }
      text += decoder.decode(part.value, { stream: true });
    }
    if (signal.aborted) throw new Error("Response read aborted");
    return JSON.parse(text + decoder.decode());
  } finally {
    signal.removeEventListener("abort", abort);
    reader.releaseLock();
  }
}
