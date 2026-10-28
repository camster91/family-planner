import { testChoreCreate } from './chore-create'
import { testChoreDelete } from './chore-delete'
import { testChoreCheck } from './chore-check'
import { testNotificationInbox } from './notification-inbox'
import { testChoreState } from './chore-state'
import { testChoreReads } from './chore-reads'
import { testRecurringChores } from './recurring-chores'
import { testAssistantDeleteTarget } from './assistant-delete-target'
import { testAssistantSource } from './assistant-source'
import { testAssistantContext } from './assistant-context'
import { testEventMutations } from './event-mutations'
import { testEventUpdate } from './event-update'
import { testCalendarEvents } from './calendar-events'
import { testCalendarSync } from './calendar-sync'
import { testCalendarSubscriptions } from './calendar-subscriptions'
import { testNotificationPreferences } from './notification-preferences'
import { testFamilyPreferences } from './family-preferences'
import { testHouseholdProfiles } from './household-profiles'
import { testFamilySettings } from './family-settings'
import { testDisplayPreferences } from './display-preferences'
import type { D1Store } from '../../../src/lib/cloudflare/database'
import { withD1ReadClient } from '../../../src/lib/cloudflare/read-client'

type NativeD1 = NonNullable<Parameters<typeof withD1ReadClient>[1]>
function check(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

/** Disposable local Worker only; never included in the application entrypoint. */
const worker = {
  async fetch(request: Request, env: { DB: NativeD1 }) {
    try {
      if (new URL(request.url).pathname === '/chore-create') return Response.json(await testChoreCreate(env.DB as unknown as D1Store))
      if (new URL(request.url).pathname === '/chore-delete') return Response.json(await testChoreDelete(env.DB as unknown as D1Store))
      if (new URL(request.url).pathname === '/chore-check') return Response.json(await testChoreCheck(env.DB as unknown as D1Store))
      if (new URL(request.url).pathname === '/notification-inbox') return Response.json(await testNotificationInbox(env.DB as unknown as D1Store))
      if (new URL(request.url).pathname === '/chore-state') return Response.json(await testChoreState(env.DB as unknown as D1Store))
      if (new URL(request.url).pathname === '/chore-reads') return Response.json(await testChoreReads(env.DB as unknown as D1Store))
      if (new URL(request.url).pathname === '/recurring-chores') return Response.json(await testRecurringChores(env.DB as unknown as D1Store))
      if (new URL(request.url).pathname === '/assistant-delete-target') return Response.json(await testAssistantDeleteTarget(env.DB as unknown as D1Store))
      if (new URL(request.url).pathname === '/assistant-source') return Response.json(await testAssistantSource(env.DB as unknown as D1Store))
      if (new URL(request.url).pathname === '/assistant-context') return Response.json(await testAssistantContext(env.DB as unknown as D1Store))
      if (new URL(request.url).pathname === '/event-mutations') return Response.json(await testEventMutations(env.DB as unknown as D1Store))
      if (new URL(request.url).pathname === '/event-update') return Response.json(await testEventUpdate(env.DB as unknown as D1Store))
      if (new URL(request.url).pathname === '/calendar-events') return Response.json(await testCalendarEvents(env.DB as unknown as D1Store))
      if (new URL(request.url).pathname === '/calendar-sync') return Response.json(await testCalendarSync(env.DB as unknown as D1Store))
      if (new URL(request.url).pathname === '/calendar-subscriptions') return Response.json(await testCalendarSubscriptions(env.DB as unknown as D1Store))
      if (new URL(request.url).pathname === '/notification-preferences') return Response.json(await testNotificationPreferences(env.DB as unknown as D1Store))
      if (new URL(request.url).pathname === '/family-preferences') return Response.json(await testFamilyPreferences(env.DB as unknown as D1Store))
      if (new URL(request.url).pathname === '/profiles') return Response.json(await testHouseholdProfiles(env.DB as unknown as D1Store))
      if (new URL(request.url).pathname === '/family-settings') return Response.json(await testFamilySettings(env.DB as unknown as D1Store))
      if (new URL(request.url).pathname === '/preferences') return Response.json(await testDisplayPreferences(env.DB as unknown as D1Store))
      const result = await withD1ReadClient(async db => {
        const member = await db.user.findUnique({
          where: { id: 'read-a' },
          select: {
            name: true, email_verified: true, created_at: true, last_chore_date: true,
            family: { select: { features: true, ambient_photo_ids: true, _count: { select: { members: true } } } },
          },
        })
        check(member?.name === 'Fabricated A', 'own record')
        check(member.created_at.toISOString() === '2025-10-09T08:53:20.000Z', 'integer date decoding')
        check(member.last_chore_date === null && member.email_verified === true, 'nullable date and boolean')
        check(Array.isArray(member.family?.ambient_photo_ids) && member.family.ambient_photo_ids[0] === 'fixture-photo', 'JSON array')
        check(member.family?._count.members === 2, 'relation count')
        const family = await db.family.findFirst({
          where: { id: 'read-family-a', members: { some: { id: 'read-a' } } },
          select: { members: { select: { id: true }, orderBy: { id: 'asc' } } },
        })
        check(family?.members.length === 2 && family.members.every(m => m.id !== 'read-c'), 'nested household scope')
        check(await db.family.findFirst({ where: { id: 'read-family-b', members: { some: { id: 'read-a' } } } }) === null, 'foreign household scope')
        check(await db.user.count({ where: { created_at: { gte: new Date('2025-01-01Z'), lt: new Date('2026-01-01Z') } } }) === 3, 'integer date filters')
        check((await db.user.groupBy({ by: ['family_id'], _count: { id: true } })).length === 2, 'grouping')
        const refused: string[] = []
        let callbackRan = false
        const operations: Array<[string, () => unknown]> = [
          ...['create', 'createMany', 'update', 'updateMany', 'upsert', 'delete', 'deleteMany'].map(name => [
            name,
            () => Reflect.apply(Reflect.get(db.user, name), db.user, [{ where: { id: 'read-a' }, data: { name: 'MUST NOT CHANGE' } }]),
          ] as [string, () => unknown]),
          ['$executeRawUnsafe', () => Reflect.apply(Reflect.get(db, '$executeRawUnsafe'), db, ['DELETE FROM "User"'])],
          ['$queryRawUnsafe', () => Reflect.apply(Reflect.get(db, '$queryRawUnsafe'), db, ['DELETE FROM "User" RETURNING id'])],
          ['callback transaction', () => Reflect.apply(Reflect.get(db, '$transaction'), db, [async () => { callbackRan = true }])],
          ['batch transaction', () => Reflect.apply(Reflect.get(db, '$transaction'), db, [[]])],
        ]
        for (const [label, operation] of operations) {
          try { await operation() } catch { refused.push(label) }
        }
        check(refused.length === operations.length && !callbackRan, 'mutation and transaction boundary')
        check((await db.user.findUnique({ where: { id: 'read-a' }, select: { name: true } }))?.name === 'Fabricated A', 'unchanged row')
        check(await db.user.count() === 3, 'unchanged count')
        return { dates: true, dateFilters: true, relations: true, householdScope: true, json: true, booleans: true, refused }
      }, env.DB)
      return Response.json(result)
    } catch (error) {
      return Response.json({ error: error instanceof Error ? error.message : 'Read smoke failed' }, { status: 500 })
    }
  },
}

export default worker
