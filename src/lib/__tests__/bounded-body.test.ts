/** @jest-environment node */
import {
  RequestBodyTooLargeError,
  readBoundedFormData,
  readBoundedJson,
  readBoundedText,
} from '@/lib/bounded-body'

/** A chunked body: a stream with no Content-Length header. */
function chunkedRequest(chunks: Uint8Array[], headers: Record<string, string> = {}): Request {
  let i = 0
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (i < chunks.length) controller.enqueue(chunks[i++])
      else controller.close()
    },
  })
  return new Request('http://localhost/api/test', {
    method: 'POST',
    headers,
    body,
    // Node's fetch requires this for a streamed request body.
    duplex: 'half',
  } as RequestInit)
}

const bytes = (text: string) => new TextEncoder().encode(text)

describe('bounded request body', () => {
  it('stops reading a chunked body without Content-Length once it passes the bound', async () => {
    let pulled = 0
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulled++
        controller.enqueue(new Uint8Array(1024))
      },
    })
    const request = new Request('http://localhost/api/test', { method: 'POST', body, duplex: 'half' } as RequestInit)
    expect(request.headers.get('content-length')).toBeNull()

    await expect(readBoundedText(request, 10 * 1024)).rejects.toBeInstanceOf(RequestBodyTooLargeError)
    // The endless stream was abandoned just past the bound, not buffered.
    expect(pulled).toBeLessThan(20)
  })

  it('refuses a declared Content-Length over the bound before reading', async () => {
    const text = jest.fn()
    const request = { headers: new Headers({ 'content-length': '999999' }), body: null, text, json: text, formData: text }
    await expect(readBoundedText(request as never, 1000)).rejects.toBeInstanceOf(RequestBodyTooLargeError)
    expect(text).not.toHaveBeenCalled()
  })

  it('reads JSON within the bound, across chunks', async () => {
    const request = chunkedRequest([bytes('{"text":"pick up '), bytes('milk"}')])
    await expect(readBoundedJson(request, 1024)).resolves.toEqual({ text: 'pick up milk' })
  })

  it('throws a SyntaxError for malformed JSON within the bound', async () => {
    await expect(readBoundedJson(chunkedRequest([bytes('{nope')]), 1024)).rejects.toBeInstanceOf(SyntaxError)
  })

  it('accepts a body exactly at the bound', async () => {
    await expect(readBoundedText(chunkedRequest([bytes('abcd')]), 4)).resolves.toBe('abcd')
    await expect(readBoundedText(chunkedRequest([bytes('abcde')]), 4)).rejects.toBeInstanceOf(RequestBodyTooLargeError)
  })

  it('reassembles many tiny chunks in order across buffer growth', async () => {
    const text = 'x'.repeat(70 * 1024) + 'end'
    const chunks = Array.from(bytes(text), (b) => new Uint8Array([b]))
    await expect(readBoundedText(chunkedRequest(chunks), 100 * 1024)).resolves.toBe(text)
  })

  it('parses multipart form data with its boundary within the bound', async () => {
    const form = new FormData()
    form.append('file', new File([new Uint8Array([1, 2, 3])], 'photo.jpg', { type: 'image/jpeg' }))
    const encoded = new Request('http://localhost/x', { method: 'POST', body: form })
    const raw = new Uint8Array(await encoded.arrayBuffer())
    const request = chunkedRequest([raw.slice(0, 10), raw.slice(10)], {
      'content-type': encoded.headers.get('content-type')!,
    })

    const parsed = await readBoundedFormData(request, 64 * 1024)
    const file = parsed.get('file') as File
    expect(file.name).toBe('photo.jpg')
    expect(new Uint8Array(await file.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3]))
  })

  it('passes through test fakes that have no body stream', async () => {
    const fake = { headers: new Headers(), body: null, json: async () => ({ ok: true }) }
    await expect(readBoundedJson(fake as never, 10)).resolves.toEqual({ ok: true })
  })
})
