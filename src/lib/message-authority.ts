import { isFeatureEnabled, normalizeFeatures } from '@/lib/features'
import { lockHousehold, lockUser } from '@/lib/household-lock'
import type { EffectResult } from '@/lib/idempotency'

export type MessageActor = { id: string; familyId: string; generation?: number }

export function messageError(status: number, error: string): EffectResult {
  return { status, body: { error } }
}

/**
 * Re-check the live actor and feature while holding the same locks used by
 * member/account deletion. Messages are all-member writes, so this helper
 * deliberately does not add a role check.
 */
export async function authorizeMessageActorInTx(
  tx: any,
  actor: MessageActor,
): Promise<EffectResult | null> {
  await lockUser(tx, actor.id)
  await lockHousehold(tx, actor.familyId)

  const current = await tx.user.findUnique({
    where: { id: actor.id },
    select: { family_id: true, token_version: true },
  })
  if (current?.family_id !== actor.familyId)
    return messageError(404, 'Message sender is no longer in this family')
  if (actor.generation !== undefined && current.token_version !== actor.generation)
    return messageError(401, 'Message session is no longer current')

  const family = await tx.family.findUnique({
    where: { id: actor.familyId },
    select: { features: true },
  })
  if (!isFeatureEnabled(normalizeFeatures(family?.features), 'messages')) {
    return messageError(403, 'This feature is turned off for your family')
  }
  return null
}


/** Upload compensation keeps the canonical refusal without logging media/owner details. */
export class MessageAuthorityRefusal extends Error {
  constructor(public readonly result: EffectResult) { super('Message authority changed'); this.name = 'MessageAuthorityRefusal' }
}
