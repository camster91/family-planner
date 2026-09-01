import { cookies } from 'next/headers'
import { verifyToken } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

// Returns the authenticated user for server components and legacy route handlers.
// Identity comes from the signed token, while mutable authorization attributes
// come from the database. This keeps role and family membership current after a
// user creates, joins, leaves, or is removed from a family.
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

  const user = await prisma!.user.findUnique({
    where: { id: payload.userId },
    select: { id: true, email: true, role: true, family_id: true },
  })

  return user ?? null
}

// Legacy export kept so existing imports don't break during migration.
// Callers should migrate to getServerUser() + prisma directly.
export async function createClient() {
  throw new Error('Supabase has been removed. Use getServerUser() + prisma instead.')
}
