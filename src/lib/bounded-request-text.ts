export class RequestBodyTooLarge extends Error {}
/** Bound streamed bodies before allocation, including requests without Content-Length. */
export async function boundedRequestText(
  request: Request,
  limit: number,
): Promise<string> {
  const declared = Number(request.headers?.get("content-length"));
  if (Number.isFinite(declared) && declared > limit)
    throw new RequestBodyTooLarge();
  if (!request.body) {
    const text = await request.text();
    if (new TextEncoder().encode(text).byteLength > limit)
      throw new RequestBodyTooLarge();
    return text;
  }
  const reader = request.body.getReader(),
    decoder = new TextDecoder();
  let bytes = 0,
    text = "";
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      bytes += part.value.byteLength;
      if (bytes > limit) {
        await reader.cancel();
        throw new RequestBodyTooLarge();
      }
      text += decoder.decode(part.value, { stream: true });
    }
    return text + decoder.decode();
  } finally {
    reader.releaseLock();
  }
}
