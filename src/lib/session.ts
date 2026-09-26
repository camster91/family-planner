import { verifyToken, TokenPayload } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

/**
 * Read a user's current session generation. Returns null when the user does
 * not exist, so callers can distinguish "no such user" from "generation 0".
 */
export async function getTokenVersion(userId: string): Promise<number | null> {
  if (!prisma) return null
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { token_version: true },
  })
  return user ? user.token_version : null
}

/**
 * Session-generation check.
 *
 * A JWT stays cryptographically valid for its full 7 days, so signature and
 * expiry alone cannot express "this session was revoked". `User.token_version`
 * is the generation counter: it is bumped on password reset and password
 * change, and a token is only live while its `tv` claim still matches it.
 *
 * Tokens issued before this generation existed carry no `tv`; they are treated
 * as generation 0, matching the column's default.
 *
 * Returns false when the user no longer exists — a deleted account's tokens
 * must not authenticate.
 *
 * NOTE: every authentication path must go through this. Checking it only in
 * `authenticateRequest` left `getServerUser()` and the middleware accepting
 * revoked cookies, which defeated revocation for dashboard access and for
 * every route that reads the session via `getServerUser()`.
 */
export async function isSessionCurrent(payload: TokenPayload): Promise<boolean> {
  const current = await getTokenVersion(payload.userId)
  return current !== null && current === (payload.tv ?? 0)
}

/**
 * Resolve a verified JWT payload against the database (D6, #102).
 *
 * One query reads the session generation AND the member's current `role` and
 * `family_id`. The session is rejected when the account is gone or the
 * generation moved on; otherwise the returned payload carries the database
 * role and family, never the values baked into the JWT at sign-in. A role or
 * household change therefore takes effect on the member's next request rather
 * than when the 7-day cookie expires (AUTHORIZATION.md step 2: resolve current
 * state from authoritative server data).
 */
export async function resolveSession(payload: TokenPayload): Promise<TokenPayload | null> {
  if (!prisma) return null
  const user = await prisma.user.findUnique({
    where: { id: payload.userId },
    select: { token_version: true, role: true, family_id: true },
  })
  if (!user || user.token_version !== (payload.tv ?? 0)) return null
  return { ...payload, role: user.role, family_id: user.family_id ?? null }
}

/**
 * Verify a session cookie end-to-end: signature, expiry AND generation.
 * Returns the payload only when all three hold, else null. `role` and
 * `family_id` on the returned payload come from the database (see
 * `resolveSession`), so every caller — `authenticateRequest`,
 * `getServerUser()` and the pages built on them — sees the current values.
 */
export async function verifySessionToken(token: string): Promise<TokenPayload | null> {
  const payload = verifyToken(token)
  if (!payload) return null
  return resolveSession(payload)
}
