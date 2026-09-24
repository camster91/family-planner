/**
 * Identify an image by its magic bytes instead of trusting the client-declared
 * MIME type. A multipart `Content-Type` is attacker-controlled; the leading
 * bytes of the file are what a browser or image decoder actually acts on.
 */

export type SniffedImage = {
  mime: 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp' | 'image/heic'
  ext: 'jpg' | 'png' | 'gif' | 'webp' | 'heic'
}

const HEIC_BRANDS = new Set(['heic', 'heix', 'hevc', 'hevx', 'heim', 'heis', 'mif1', 'msf1'])

function ascii(buf: Uint8Array, start: number, end: number): string {
  return String.fromCharCode(...buf.subarray(start, end))
}

export function sniffImageType(buf: Uint8Array): SniffedImage | null {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
    return { mime: 'image/jpeg', ext: 'jpg' }
  }
  if (
    buf.length >= 8 &&
    buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47 &&
    buf[4] === 0x0d && buf[5] === 0x0a && buf[6] === 0x1a && buf[7] === 0x0a
  ) {
    return { mime: 'image/png', ext: 'png' }
  }
  if (buf.length >= 6) {
    const sig = ascii(buf, 0, 6)
    if (sig === 'GIF87a' || sig === 'GIF89a') return { mime: 'image/gif', ext: 'gif' }
  }
  if (buf.length >= 12 && ascii(buf, 0, 4) === 'RIFF' && ascii(buf, 8, 12) === 'WEBP') {
    return { mime: 'image/webp', ext: 'webp' }
  }
  // ISO-BMFF: [size:4]['ftyp'][major brand:4]
  if (buf.length >= 12 && ascii(buf, 4, 8) === 'ftyp' && HEIC_BRANDS.has(ascii(buf, 8, 12))) {
    return { mime: 'image/heic', ext: 'heic' }
  }
  return null
}
