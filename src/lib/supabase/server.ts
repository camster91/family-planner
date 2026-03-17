import { cookies } from 'next/headers'
import { verifyToken } from '@/lib/auth'

// Stub: returns the authenticated user ID from the JWT cookie.
// Used by server components that previously called supabase.auth.getSession().
export async function getServerUser(): Promise<{ id: string; email: string } | null> {
  const cookieStore = await cookies()
  const token = cookieStore.get('session_token')?.value
  if (!token) return null

  const payload = verifyToken(token)
  if (!payload || !payload.userId) return null

  return { id: payload.userId, email: payload.email as string }
}

// Legacy export kept so existing imports don't break during migration.
// Callers should migrate to getServerUser() + prisma directly.
export async function createClient() {
  throw new Error('Supabase has been removed. Use getServerUser() + prisma instead.')
}
