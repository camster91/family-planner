import { sniffImageType } from '@/lib/image-sniff'

const bytes = (...parts: (number[] | string)[]) =>
  Uint8Array.from(
    parts.flatMap((p) => (typeof p === 'string' ? [...p].map((c) => c.charCodeAt(0)) : p))
  )

describe('sniffImageType', () => {
  it('detects JPEG', () => {
    expect(sniffImageType(bytes([0xff, 0xd8, 0xff, 0xe0, 0, 0]))).toEqual({ mime: 'image/jpeg', ext: 'jpg' })
  })

  it('detects PNG', () => {
    expect(sniffImageType(bytes([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]))).toEqual({
      mime: 'image/png',
      ext: 'png',
    })
  })

  it('detects GIF87a and GIF89a', () => {
    expect(sniffImageType(bytes('GIF89a', [1, 0]))?.mime).toBe('image/gif')
    expect(sniffImageType(bytes('GIF87a', [1, 0]))?.mime).toBe('image/gif')
  })

  it('detects WEBP', () => {
    expect(sniffImageType(bytes('RIFF', [0x24, 0, 0, 0], 'WEBPVP8 '))).toEqual({ mime: 'image/webp', ext: 'webp' })
  })

  it('detects HEIC via ftyp brand', () => {
    expect(sniffImageType(bytes([0, 0, 0, 0x18], 'ftypheic', [0, 0, 0, 0]))).toEqual({
      mime: 'image/heic',
      ext: 'heic',
    })
  })

  it('rejects a RIFF container that is not WEBP', () => {
    expect(sniffImageType(bytes('RIFF', [0x24, 0, 0, 0], 'WAVEfmt '))).toBeNull()
  })

  it('rejects HTML/SVG declared as an image', () => {
    expect(sniffImageType(bytes('<svg xmlns="http://www.w3.org/2000/svg">'))).toBeNull()
    expect(sniffImageType(bytes('<html><script>alert(1)</script>'))).toBeNull()
  })

  it('rejects empty and truncated input', () => {
    expect(sniffImageType(new Uint8Array())).toBeNull()
    expect(sniffImageType(bytes([0xff, 0xd8]))).toBeNull()
    expect(sniffImageType(bytes([0x89, 0x50, 0x4e, 0x47]))).toBeNull()
  })
})
