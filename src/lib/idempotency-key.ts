/**
 * Idempotency keys (#162; contract in docs/architecture/API_CONTRACTS.md
 * "Idempotency" and OFFLINE_SYNC.md).
 *
 * Shared by the browser (queue) and the server (validation). No Node or DOM
 * imports: the generator takes whatever Web Crypto the runtime has.
 */

export const IDEMPOTENCY_HEADER = 'Idempotency-Key'
/** Set on a response that was replayed from a stored idempotency record. */
export const IDEMPOTENCY_REPLAYED_HEADER = 'Idempotency-Replayed'

/**
 * Accepted key shape: 16–128 characters of `[A-Za-z0-9_-]`. A UUID (36 chars
 * with hyphens) is what this app's clients send; the looser rule keeps other
 * well-formed opaque keys valid without accepting whitespace, separators or
 * anything that could smuggle structure into logs.
 */
const KEY_PATTERN = /^[A-Za-z0-9_-]{16,128}$/

export function isValidIdempotencyKey(value: unknown): value is string {
  return typeof value === 'string' && KEY_PATTERN.test(value)
}

type CryptoLike = {
  randomUUID?: () => string
  getRandomValues?: <T extends ArrayBufferView | null>(array: T) => T
}

/**
 * A fresh random (v4) UUID. `crypto.randomUUID` needs a secure context
 * (https or localhost); fall back to `getRandomValues`, which does not.
 */
export function newIdempotencyKey(cryptoImpl: CryptoLike | undefined = globalThis.crypto): string {
  if (cryptoImpl?.randomUUID) return cryptoImpl.randomUUID()
  if (!cryptoImpl?.getRandomValues) throw new Error('No secure random source for an idempotency key')
  const bytes = cryptoImpl.getRandomValues(new Uint8Array(16))
  bytes[6] = (bytes[6] & 0x0f) | 0x40
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}
