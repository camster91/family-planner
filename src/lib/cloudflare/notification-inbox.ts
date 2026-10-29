/** Private account inbox; every native write renews the session generation in
 * its atomic batch. No household member can mark, snooze or delete another's row. */
import type { Prisma, PrismaClient } from '@prisma/client'
import { getD1Database, type D1Store, type D1Statement } from './database'
import { captureD1Reads } from './read-witness'
import type { NativeD1 } from './read-client'
import { isD1WriteConflict } from './write-check'
import type { EffectResult } from '@/lib/idempotency'
export type InboxActor = { userId: string; generation: number }
type InboxCommand =
  | { kind: 'read'; id: string }
  | { kind: 'read-all' }
  | { kind: 'delete'; id: string }
  | { kind: 'delete-all' }
  | { kind: 'snooze'; id: string; until: Date | null }

export async function readD1NotificationInbox(actor: InboxActor, where: Prisma.NotificationWhereInput, take: number, database?: D1Store): Promise<EffectResult> {
  if (!Number.isSafeInteger(take) || take < 1 || take > 101) throw new Error('Invalid inbox page size')
  const store = database ?? await getD1Database(), session = store.withSession('first-primary')
  for (let attempt = 0; attempt < 8; attempt++) {
    const capture = await captureD1Reads(async db => {
      const user = await db.user.findUnique({ where: { id: actor.userId }, select: { token_version: true } })
      if (!user || user.token_version !== actor.generation) return null
      // Delegate is narrowed to reads only; source and generated SDK Prisma
      // types differ, while the scalar inbox query shape is shared.
      const inbox = db.notification as unknown as Pick<PrismaClient['notification'], 'findMany'>
      return inbox.findMany({ where: { AND: [where, { user_id: actor.userId }] }, orderBy: [{ created_at: 'desc' }, { id: 'asc' }], take })
    }, store as unknown as NativeD1)
    try {
      await session.batch(capture.checks(session))
      return capture.value === null ? { status: 401, body: { error: 'Unauthorized' } } : { status: 200, body: capture.value }
    } catch (cause) { if (!isD1WriteConflict(cause)) throw cause }
  }
  return { status: 409, body: { error: 'Your inbox changed. Refresh and retry.' } }
}
export async function mutateD1NotificationInbox(actor: InboxActor, command: InboxCommand, database?: D1Store): Promise<EffectResult> {
  if (command.kind === 'snooze' && command.until !== null && !Number.isFinite(command.until.getTime())) throw new Error('Invalid snooze clock')
  const store = database ?? await getD1Database(), session = store.withSession('first-primary')
  for (let attempt = 0; attempt < 8; attempt++) {
    const capture = await captureD1Reads(async db => {
      const user = await db.user.findUnique({ where: { id: actor.userId }, select: { token_version: true } })
      return !!user && user.token_version === actor.generation
    }, store as unknown as NativeD1)
    const checks = capture.checks(session)
    let write: D1Statement
    switch (command.kind) {
      case 'read': write = session.prepare(`UPDATE "Notification" SET read=1 WHERE user_id=?1 AND id=?2`).bind(actor.userId, command.id); break
      case 'read-all': write = session.prepare(`UPDATE "Notification" SET read=1 WHERE user_id=?1 AND read=0`).bind(actor.userId); break
      case 'delete': write = session.prepare(`DELETE FROM "Notification" WHERE user_id=?1 AND id=?2`).bind(actor.userId, command.id); break
      case 'delete-all': write = session.prepare(`DELETE FROM "Notification" WHERE user_id=?1`).bind(actor.userId); break
      case 'snooze': write = session.prepare(`UPDATE "Notification" SET snoozed_until=?1,read=0 WHERE user_id=?2 AND id=?3`).bind(command.until?.getTime() ?? null, actor.userId, command.id); break
    }
    try {
      // D1 meta.changes includes FK/trigger effects. Measure the direct write so
      // clearing a retained decision link cannot turn a real delete into 404.
      const results = await session.batch<{ affected: number }>(capture.value ? [...checks, write, session.prepare('SELECT changes() AS affected')] : checks)
      if (!capture.value) return { status: 401, body: { error: 'Unauthorized' } }
      if (command.kind !== 'read-all' && command.kind !== 'delete-all' && results[checks.length + 1].results[0]?.affected !== 1) return { status: 404, body: { error: 'Notification not found' } }
      return { status: 200, body: { success: true, ...(command.kind === 'snooze' ? { snoozed_until: command.until } : {}) } }
    } catch (cause) { if (!isD1WriteConflict(cause)) throw cause }
  }
  return { status: 409, body: { error: 'Your inbox changed. Refresh and retry.' } }
}
