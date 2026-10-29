import { randomUUID } from 'node:crypto'
import { NextResponse } from 'next/server'
import { createInviteToken, hashInviteToken, INVITE_TTL_MS } from '@/lib/family-invite'
import { auditSummary } from '@/lib/household-audit'
import { familyInviteEmail } from '@/lib/mail'
import { sendAccountMail } from '@/lib/notification-delivery'
import type { MembershipActor } from './membership'
import { getD1Database } from './database'
import { createD1Invite, discardD1UndeliveredInvite, readD1InviteContext } from './invites'

export const revokedInviteSummaries = () => ({
  parent: auditSummary.inviteRevoked('parent'), teen: auditSummary.inviteRevoked('teen'),
  child: auditSummary.inviteRevoked('child'), member: auditSummary.inviteRevoked('member'),
})
export async function createD1InviteHttp(actor: MembershipActor, email: string, role: string) {
  const db = await getD1Database()
  const context = await readD1InviteContext(db, actor, email)
  if (!context) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  if (context.already_member) return NextResponse.json({ error: 'That person is already in your family' }, { status: 400 })
  const id = randomUUID(), token = createInviteToken(), hash = hashInviteToken(token)
  const now = Date.now(), expires = now + INVITE_TTL_MS
  const created = await createD1Invite(db, actor, {
    id, auditId: randomUUID(), email, role, hash, now, expires,
    createdSummary: auditSummary.inviteCreated(role), revokedSummaries: revokedInviteSummaries(),
  })
  if (!created) return NextResponse.json({ error: 'Your household access changed. Please try again.' }, { status: 403 })
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://family.ashbi.ca'
  const mail = familyInviteEmail({ familyName: created.family_name, inviterName: created.inviter_name, role, joinUrl: `${appUrl.replace(/\/$/, '')}/join?token=${token}` })
  try {
    await sendAccountMail('family_invite', { to: email, ...mail })
  } catch (error) {
    await discardD1UndeliveredInvite(db, id, hash, actor.familyId).catch(() => undefined)
    throw error
  }
  return NextResponse.json({ success: true, invite: { email, role, expires_at: new Date(expires).toISOString() } })
}
