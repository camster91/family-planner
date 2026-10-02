import type { Metadata } from 'next'
import { getServerUser } from '@/lib/supabase/server'
import { prisma } from '@/lib/prisma'
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
  const profile = sessionUser
    ? await prisma!.user.findUnique({ where: { id: sessionUser.id }, select: { role: true } })
    : null
  return <HelpContent supportEmail={SUPPORT_EMAIL} role={profile?.role ?? sessionUser?.role} />
}
