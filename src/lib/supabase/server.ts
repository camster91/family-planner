import { cookies } from 'next/headers'
import { verifyToken } from '@/lib/auth'

// Stub: returns the authenticated user from the JWT cookie.
// Used by server components that previously called supabase.auth.getSession().
// The JWT payload now includes role + family_id (added 2026-06-06); we surface
// them here so route handlers can do role checks without an extra DB lookup.
// For legacy tokens issued before the JWT change, role will be undefined and
// callers should treat as 'parent' (the safe default) or do a DB lookup.
export async function getServerUser(): Promise<{
  id: string
  email: string
  role?: string
  family_id?: string | null
} | null> {
  const cookieStore = await cookies()
  const token = cookieStore.get('session_token')?.value
  if (!token) return null

  const payload = verifyToken(token)
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
