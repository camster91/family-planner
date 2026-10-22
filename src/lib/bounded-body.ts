/**
 * Read a request body with a hard byte bound.
 *
 * Content-Length is only a hint: a chunked request has none, and
 * request.formData()/json()/text() buffer the whole body before any later
 * size check runs. These helpers stop reading as soon as the stream passes
 * the bound, so one oversized request cannot exhaust server memory.
 *
 * Fake requests in route tests have no body stream and provide
 * formData()/json()/text() directly; those are passed through.
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
  const chunks: Uint8Array[] = []
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
      chunks.push(value)
      total += value.byteLength
    }
  } finally {
    reader.releaseLock()
  }

  const bytes = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  return bytes
}

/** Body as UTF-8 text. Throws RequestBodyTooLargeError past maxBytes. */
export async function readBoundedText(request: BodyRequest, maxBytes: number): Promise<string> {
  if (declaresTooLarge(request, maxBytes)) throw new RequestBodyTooLargeError()
  if (!request.body) return request.text()
  return new TextDecoder().decode(await readBoundedBytes(request.body, maxBytes))
}

/**
 * Body parsed as JSON. Throws RequestBodyTooLargeError past maxBytes and a
 * SyntaxError for malformed JSON, matching request.json().
 */
export async function readBoundedJson(request: BodyRequest, maxBytes: number): Promise<unknown> {
  if (declaresTooLarge(request, maxBytes)) throw new RequestBodyTooLargeError()
  if (!request.body) return request.json()
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
