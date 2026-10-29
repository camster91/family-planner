import type { Metadata } from 'next'
import { getServerUser } from '@/lib/supabase/server'
import { prisma } from '@/lib/prisma'
import { storageBackend } from '@/lib/storage-backend'
import { withD1ReadClient } from '@/lib/cloudflare/read-client'
import { SUPPORT_EMAIL } from '@/lib/support'
import HelpContent from './HelpContent'

export const metadata: Metadata = { title: 'Help' }

/**
 * Help and support for beta families (#146). Content: ./HelpContent.tsx.
 * Parents and teens (O-37) open it. The role is read from the database (like
 * the dashboard layout) only to decide which page names are links.
 */
export default async function HelpPage() {
  const sessionUser = await getServerUser()
  let role = sessionUser?.role
  if (sessionUser) {
    if (storageBackend() === 'd1') {
      const current = await withD1ReadClient((db) => db.user.findUnique({ where: { id: sessionUser.id }, select: { role: true } }))
      role = current?.role ?? role
    } else {
      const profile = await prisma!.user.findUnique({ where: { id: sessionUser.id }, select: { role: true } })
      role = profile?.role ?? role
    }
  }
  return <HelpContent supportEmail={SUPPORT_EMAIL} role={role} userId={sessionUser?.id} />
}
