/**
 * Read a request body with a hard byte bound.
 *
 * Content-Length is only a hint: a chunked request has none, and
 * request.formData()/json()/text() buffer the whole body before any later
 * size check runs. These helpers stop reading as soon as the stream passes
 * the bound, so one oversized request cannot exhaust server memory.
 *
 * Legacy decoders without a body stream cannot enforce a preallocation bound.
 * JSON/text fallbacks enforce a post-decode byte bound; formData passes through.
 */

export class RequestBodyTooLargeError extends Error {
  constructor() {
    super('REQUEST_BODY_TOO_LARGE')
    this.name = 'RequestBodyTooLargeError'
  }
}

type BodyRequest = Pick<Request, 'body' | 'headers' | 'formData' | 'json' | 'text'>

/** True when the declared Content-Length is present and over the bound. */
export function declaresTooLarge(request: Pick<Request, 'headers'>, maxBytes: number): boolean {
  const declared = Number(request.headers.get('content-length'))
  return Number.isFinite(declared) && declared > maxBytes
}

async function readBoundedBytes(body: ReadableStream<Uint8Array>, maxBytes: number): Promise<Uint8Array<ArrayBuffer>> {
  const reader = body.getReader()
  // Copy each chunk into one growing buffer instead of keeping the chunks:
  // a body sent as millions of tiny chunks would otherwise hold one object
  // per chunk, far more memory than its byte count.
  let buffer = new Uint8Array(Math.min(maxBytes, 64 * 1024))
  let total = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      if (!value) continue
      if (value.byteLength > maxBytes - total) {
        await reader.cancel().catch(() => {})
        throw new RequestBodyTooLargeError()
      }
      if (total + value.byteLength > buffer.byteLength) {
        const grown = new Uint8Array(Math.min(maxBytes, Math.max(buffer.byteLength * 2, total + value.byteLength)))
        grown.set(buffer.subarray(0, total))
        buffer = grown
      }
      buffer.set(value, total)
      total += value.byteLength
    }
  } finally {
    reader.releaseLock()
  }

  return buffer.slice(0, total)
}

/** Body as UTF-8 text. Throws RequestBodyTooLargeError past maxBytes. */
export async function readBoundedText(request: BodyRequest, maxBytes: number): Promise<string> {
  if (declaresTooLarge(request, maxBytes)) throw new RequestBodyTooLargeError()
  if (!request.body) {
    const text = await request.text()
    if (new TextEncoder().encode(text).byteLength > maxBytes) throw new RequestBodyTooLargeError()
    return text
  }
  return new TextDecoder().decode(await readBoundedBytes(request.body, maxBytes))
}

/**
 * Body parsed as JSON. Throws RequestBodyTooLargeError past maxBytes and a
 * SyntaxError for malformed JSON, matching request.json().
 */
export async function readBoundedJson(request: BodyRequest, maxBytes: number): Promise<unknown> {
  if (declaresTooLarge(request, maxBytes)) throw new RequestBodyTooLargeError()
  if (!request.body) {
    // Legacy bridge/test requests may expose only one decoder. This is a
    // post-parse bound when no stream is available, not streaming protection.
    if (typeof request.json !== 'function') return JSON.parse(await readBoundedText(request, maxBytes))
    const value: unknown = await request.json()
    const encoded = JSON.stringify(value)
    if (typeof encoded !== 'string') throw new SyntaxError('Invalid JSON')
    if (new TextEncoder().encode(encoded).byteLength > maxBytes) throw new RequestBodyTooLargeError()
    return value
  }
  return JSON.parse(await readBoundedText(request, maxBytes))
}

/** Body parsed as multipart or urlencoded form data. Throws RequestBodyTooLargeError past maxBytes. */
export async function readBoundedFormData(request: BodyRequest, maxBytes: number): Promise<FormData> {
  if (declaresTooLarge(request, maxBytes)) throw new RequestBodyTooLargeError()
  if (!request.body) return request.formData()
  const bytes = await readBoundedBytes(request.body, maxBytes)
  // Parse the buffered bytes with the original Content-Type (and boundary).
  return new Response(bytes, { headers: request.headers }).formData()
}
