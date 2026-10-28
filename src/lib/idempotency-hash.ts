/** Server fingerprint leaf; safe for repositories without a Next HTTP import. */
import { createHash } from 'node:crypto'
import { canonicalRequestJson } from './idempotency-request-json'
export function hashIdempotentRequest(action: string, body: unknown): string {
  return createHash('sha256').update(`${action}\n${canonicalRequestJson(body)}`).digest('hex')
}
