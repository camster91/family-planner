import { timingSafeEqual } from 'crypto'

/**
 * Constant-time string comparison for secrets.
 *
 * `a !== b` short-circuits on the first differing byte, which leaks length and
 * prefix through timing. `timingSafeEqual` requires equal-length buffers, so
 * unequal lengths are handled explicitly — and that check must not itself leak
 * more than the fact that the lengths differ, which is unavoidable.
 */
export function timingSafeEqualStr(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf8')
  const bufB = Buffer.from(b, 'utf8')
  if (bufA.length !== bufB.length) return false
  return timingSafeEqual(bufA, bufB)
}
