import { cookies } from 'next/headers'
import { verifySessionToken } from '@/lib/session'

// Returns the authenticated user from the session cookie. Used by server
// components and route handlers. `role` and `family_id` are the member's
// CURRENT values from the database (D6, #102): `verifySessionToken` resolves
// them in the same query as the session-generation check, so a role or
// household change takes effect on the next request instead of when the
// cookie expires. The JWT's own role/family_id claims are never trusted.
//
// This is the server-component counterpart to `authenticateRequest`, and it
// goes through the SAME `verifySessionToken` check. Using bare `verifyToken`
// here meant a revoked cookie (password reset/change bumps `token_version`)
// still authenticated every page and route that reads the session this way.
export async function getServerUser(): Promise<{
  id: string
  email: string
  role?: string
  family_id?: string | null
} | null> {
  const cookieStore = await cookies()
  const token = cookieStore.get('session_token')?.value
  if (!token) return null

  const payload = await verifySessionToken(token)
  if (!payload || !payload.userId) return null

  return {
    id: payload.userId,
    email: payload.email as string,
    role: payload.role,
    family_id: payload.family_id ?? null,
  }
}

// Legacy export kept so existing imports don't break during migration.
// Callers should migrate to getServerUser() + prisma directly.
export async function createClient() {
  throw new Error('Supabase has been removed. Use getServerUser() + prisma instead.')
}
