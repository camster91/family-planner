import { randomUUID } from 'node:crypto'
import { NextResponse } from 'next/server'
import type { TokenPayload } from '@/lib/auth'
import { attachSessionCookie } from '@/lib/api-auth'
import { defaultFeatures } from '@/lib/features'
import { createFamilyInviteCode, INVITE_CODE_ATTEMPTS } from '@/lib/family-invite'
import { getD1Database } from './database'
import { createD1Family } from './family-create'

export async function createD1FamilyHttp(payload: TokenPayload, name: string): Promise<NextResponse> {
  const db = await getD1Database()
  for (let attempt = 1; attempt <= INVITE_CODE_ATTEMPTS; attempt++) {
    try {
      const family = await createD1Family(db, {
        userId: payload.userId, tokenVersion: payload.tv ?? 0,
        familyId: randomUUID(), name, inviteCode: createFamilyInviteCode(),
        features: JSON.stringify(defaultFeatures()), now: Date.now(),
      })
      if (family === 'gone') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
      if (family === 'already') {
        return NextResponse.json({ error: 'You already belong to a family' }, { status: 400 })
      }
      const response = NextResponse.json({ family: {
        ...family,
        features: JSON.parse(family.features),
        travel_mode_active: Boolean(family.travel_mode_active),
        weather_enabled: Boolean(family.weather_enabled),
        device_writes_enabled: Boolean(family.device_writes_enabled),
        beta_metrics_enabled: Boolean(family.beta_metrics_enabled),
        ambient_photo_ids: JSON.parse(family.ambient_photo_ids),
        created_at: new Date(family.created_at),
      } })
      await attachSessionCookie(response, { ...payload, role: 'parent', family_id: family.id })
      return response
    } catch (error) {
      // Retry only this unique index; unrelated D1/constraint failures propagate.
      if (!(error instanceof Error) || !error.message.includes('UNIQUE constraint failed: Family.invite_code')) throw error
    }
  }
  return NextResponse.json({ error: 'Could not make a family code. Please try again.' }, {
    status: 503, headers: { 'Retry-After': '1' },
  })
}
