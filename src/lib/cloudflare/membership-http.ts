import { randomUUID } from 'node:crypto'
import { NextResponse } from 'next/server'
import type { TokenPayload } from '@/lib/auth'
import { attachSessionCookie } from '@/lib/api-auth'
import { normalizeInviteCode, normalizeInviteToken, hashInviteToken, normalizeEmail } from '@/lib/family-invite'
import { auditSummary } from '@/lib/household-audit'
import { recordBetaMetric } from '@/lib/beta-metrics'
import { prisma } from '@/lib/prisma'
import { getD1Database } from './database'
import { findD1RegistrationInvite } from './accounts'
import { findD1FamilyByCode, joinD1Family, readD1MembershipUser } from './membership'

const already = () => NextResponse.json({ error: 'You already belong to a family. Leave your current family first.' }, { status: 400 })
export async function joinD1FamilyHttp(payload: TokenPayload, input: { token?: string; inviteCode?: string }) {
  const db = await getD1Database()
  const generation = payload.tv ?? 0
  const user = await readD1MembershipUser(db, payload.userId, generation)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (user.family_id) return already()
  const token = normalizeInviteToken(input.token)
  const code = token ? null : normalizeInviteCode(input.inviteCode)
  if (token) {
    const invite = await findD1RegistrationInvite(db, hashInviteToken(token))
    if (!invite || invite.accepted_at || invite.expires_at.getTime() <= Date.now()) {
      return NextResponse.json({ error: 'Invite not found or expired' }, { status: 404 })
    }
    if (normalizeEmail(user.email) !== invite.email) return NextResponse.json({ error: 'This invite was sent to a different email address' }, { status: 403 })
  } else {
    if (!code) return NextResponse.json({ error: 'Valid invite code is required' }, { status: 400 })
    if (!(await findD1FamilyByCode(db, code))) return NextResponse.json({ error: 'Family not found' }, { status: 404 })
  }
  const joined = await joinD1Family(db, {
    userId: user.id, generation, expectedName: user.name, now: Date.now(), auditId: randomUUID(),
    tokenHash: token ? hashInviteToken(token) : undefined, code: code ?? undefined,
    summaries: { parent: auditSummary.memberJoined(user.name, 'parent'), teen: auditSummary.memberJoined(user.name, 'teen'), child: auditSummary.memberJoined(user.name, 'child') },
  })
  if (!joined) {
    const current = await readD1MembershipUser(db, user.id, generation)
    if (!current) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    if (current.family_id) return already()
    if (current.name !== user.name) return NextResponse.json({ error: 'Your account changed. Please try again.' }, { status: 409 })
    return NextResponse.json({ error: token ? 'Invite not found or expired' : 'Family not found' }, { status: 404 })
  }
  await recordBetaMetric(prisma!, joined.family_id!, 'member_joined')
  const response = NextResponse.json({ success: true, familyName: joined.family_name })
  await attachSessionCookie(response, { userId: joined.id, email: joined.email, role: joined.role, family_id: joined.family_id })
  return response
}
