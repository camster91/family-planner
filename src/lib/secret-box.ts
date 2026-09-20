import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'crypto'

// Small encryption helper for secrets that families store in the app
// (currently the AI capture key).
//
// Design notes:
// - AES-256-GCM, so ciphertext is both confidential and tamper-evident.
// - The key is derived from JWT_SECRET, which is already required in every
//   deployment. That means no extra env var to configure, and no secret sitting
//   next to the secret.
// - Stored format is "v1:<iv-b64>:<tag-b64>:<ciphertext-b64>" so the scheme can
//   change later without guessing at old rows.
//
// This is deliberately simple: the threat we care about is a database dump or a
// stray SELECT leaking the raw key. It is not a defence against an attacker who
// already has the app's environment.

const VERSION = 'v1'

function derivedKey(): Buffer {
  const source = process.env.JWT_SECRET || ''
  if (!source) {
    throw new Error('Cannot store secrets: JWT_SECRET is not set')
  }
  // Derive a stable 32-byte key. The domain string keeps this separate from
  // any other use of JWT_SECRET.
  return createHash('sha256').update(`family-planner:secret-box:${source}`).digest()
}

export function encryptSecret(plain: string): string {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', derivedKey(), iv)
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return [VERSION, iv.toString('base64'), tag.toString('base64'), enc.toString('base64')].join(':')
}

// Returns null when the value is missing, malformed, or fails its auth check.
// Callers treat null as "no key configured" rather than throwing, so a corrupt
// row cannot take down the whole capture feature.
export function decryptSecret(stored: string | null | undefined): string | null {
  if (!stored) return null
  const parts = stored.split(':')
  if (parts.length !== 4 || parts[0] !== VERSION) return null
  try {
    const iv = Buffer.from(parts[1], 'base64')
    const tag = Buffer.from(parts[2], 'base64')
    const data = Buffer.from(parts[3], 'base64')
    const decipher = createDecipheriv('aes-256-gcm', derivedKey(), iv)
    decipher.setAuthTag(tag)
    const out = Buffer.concat([decipher.update(data), decipher.final()])
    return out.toString('utf8')
  } catch {
    return null
  }
}

// Show a secret back to its owner without revealing it: enough to recognise
// which key is stored, not enough to use it.
export function maskSecret(plain: string): string {
  if (plain.length <= 8) return '••••••••'
  return `${plain.slice(0, 4)}••••${plain.slice(-4)}`
}
