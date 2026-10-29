import { testAccountDeletion } from './account-deletion'
import { testFamilyImport } from './family-import'
import { testCalendarImport } from './calendar-import'
import { testFoodAiFeedback } from './food-ai-feedback'
import { testInventoryCookingReview } from './inventory-cooking-review'
import { testR2Storage } from './r2-storage'
import { testMorningSummary } from './morning-summary'
import { testResponsibility } from './responsibility'
import { testWeeklyReset } from './weekly-reset'
import { testFinanceArchiveExport } from './finance-archive-export'
import { testHandoffs } from './handoffs'
import { testReviewInbox } from './review-inbox'
import { testSearch } from './search'
import { testAnniversaries } from './anniversaries'
import { testActivityLocationsPickups } from './activity-locations-pickups'
import { testRewards } from './rewards'
import { testHealth } from './health'
import { testFoodPlanning } from './food-planning'
import { testBudget } from './budget'
import { testFoodSourceVersions } from './food-source-versions'
import { testAiUsage } from './ai-usage'
import { testWishlist } from './wishlist'
import {testFoodSourceGuards} from './food-source'
import { testNotesProjects } from './notes-projects'
import {testAssistantActions} from './assistant-actions'
import {testBoardSettings} from './board-settings'
import {testReadWitnessNumbers} from './read-witness-numeric'
import {testRecipeLibrary} from './recipe-library'
import {testRecipeGrocery} from './recipe-grocery'
import {testInventory} from './inventory'
import {testMeals} from './meals'
import {testRoutines} from './routines'
import {testDeviceWrites} from './device-writes'
import {testBoardReads} from './board'
import { testDeviceParent } from './device-parent'
import { testDevicePairing } from './device-pairing'
import { testDeviceSessions } from './device-sessions'
import { testChoreUpdate } from './chore-update'
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
import { testStorage } from './storage'
import { testMessages } from './messages'
import { testAccountRecovery } from './account-recovery'
import { testInventoryRecovery } from './inventory-recovery'
import { testAllowance } from './allowance'
import { testAnalyticsFeedback } from './analytics-feedback'
import type { D1Store } from '../../../src/lib/cloudflare/database'
import { withD1ReadClient } from '../../../src/lib/cloudflare/read-client'
import passwordComputeWorker, { LocalPasswordCompute } from '../../../src/cloudflare/password-compute-worker'
import type { LocalPasswordComputeBinding } from '../../../src/lib/cloudflare/local-password-compute'

type NativeD1 = NonNullable<Parameters<typeof withD1ReadClient>[1]>
type ReadWorkerEnv = {
  DB: NativeD1
  PASSWORD_COMPUTE_DO: LocalPasswordComputeBinding
}
function check(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

/** Disposable local Worker only; never included in the application entrypoint. */
const worker = {
  async fetch(request: Request, env: ReadWorkerEnv) {
    // The native read harness is deliberately a disposable Worker rather than
    // OpenNext. Seed the same context symbol OpenNext uses so auth's D1 path
    // reaches the real private password-compute Worker entrypoint and its
    // Durable Object binding, instead of falling back to local bcrypt.
    const passwordCompute = {
      fetch: (computeRequest: Request) =>
        passwordComputeWorker.fetch(computeRequest, {
          PASSWORD_COMPUTE: env.PASSWORD_COMPUTE_DO,
        }),
    }
    Reflect.set(globalThis, Symbol.for('__cloudflare-context__'), {
      env: { ...env, PASSWORD_COMPUTE: passwordCompute },
    })
    try {
      if (new URL(request.url).pathname === '/account-deletion') return Response.json(await testAccountDeletion(env.DB as unknown as D1Store))
      if (new URL(request.url).pathname === '/family-import') return Response.json(await testFamilyImport(env.DB as unknown as D1Store))
      if (new URL(request.url).pathname === '/calendar-import') return Response.json(await testCalendarImport(env.DB as unknown as D1Store))
      if (new URL(request.url).pathname === '/food-ai-feedback') return Response.json(await testFoodAiFeedback(env.DB as unknown as D1Store))
      if (new URL(request.url).pathname === '/inventory-cooking-review') return Response.json(await testInventoryCookingReview(env.DB as unknown as D1Store))
      if (new URL(request.url).pathname === '/r2-storage') return Response.json(await testR2Storage(env.DB as unknown as D1Store))
      if (new URL(request.url).pathname === '/morning-summary') return Response.json(await testMorningSummary(env.DB as unknown as D1Store))
      if (new URL(request.url).pathname === '/responsibility') return Response.json(await testResponsibility(env.DB as unknown as D1Store))
      if (new URL(request.url).pathname === '/weekly-reset') return Response.json(await testWeeklyReset(env.DB as unknown as D1Store))
      if (new URL(request.url).pathname === '/finance-archive-export') return Response.json(await testFinanceArchiveExport(env.DB as unknown as D1Store))
      if (new URL(request.url).pathname === '/handoffs') return Response.json(await testHandoffs(env.DB as unknown as D1Store))
      if (new URL(request.url).pathname === '/review-inbox') return Response.json(await testReviewInbox(env.DB as unknown as D1Store))
      if (new URL(request.url).pathname === '/search') return Response.json(await testSearch(env.DB as unknown as D1Store))
      if (new URL(request.url).pathname === '/anniversaries') return Response.json(await testAnniversaries(env.DB as unknown as D1Store))
      if (new URL(request.url).pathname === '/activity-locations-pickups') return Response.json(await testActivityLocationsPickups(env.DB as unknown as D1Store))
      if (new URL(request.url).pathname === '/rewards') return Response.json(await testRewards(env.DB as unknown as D1Store))
      if (new URL(request.url).pathname === '/health') return Response.json(await testHealth(env.DB as unknown as D1Store))
      if (new URL(request.url).pathname === '/food-planning') return Response.json(await testFoodPlanning(env.DB as unknown as D1Store))

      if (new URL(request.url).pathname === '/budget') return Response.json(await testBudget(env.DB as unknown as D1Store))

      if (new URL(request.url).pathname === '/food-source-versions') return Response.json(await testFoodSourceVersions(env.DB as unknown as D1Store))

      if (new URL(request.url).pathname === '/ai-usage') return Response.json(await testAiUsage(env.DB as unknown as D1Store))

      if (new URL(request.url).pathname === '/wishlist') return Response.json(await testWishlist(env.DB as unknown as D1Store))

      if (new URL(request.url).pathname === '/device-parent') return Response.json(await testDeviceParent(env.DB as unknown as D1Store))
      if (new URL(request.url).pathname === '/device-pairing') return Response.json(await testDevicePairing(env.DB as unknown as D1Store))
      if (new URL(request.url).pathname === '/device-sessions') return Response.json(await testDeviceSessions(env.DB as unknown as D1Store))
      if (new URL(request.url).pathname === '/chore-update') return Response.json(await testChoreUpdate(env.DB as unknown as D1Store))
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
      if(new URL(request.url).pathname==='/routines')return Response.json(await testRoutines(env.DB as unknown as D1Store))
      if(new URL(request.url).pathname==='/meals')return Response.json(await testMeals(env.DB as unknown as D1Store))
      if(new URL(request.url).pathname==='/inventory')return Response.json(await testInventory(env.DB as unknown as D1Store))
      if(new URL(request.url).pathname==='/recipe-grocery')return Response.json(await testRecipeGrocery(env.DB as unknown as D1Store))
      if(new URL(request.url).pathname==='/recipe-library')return Response.json(await testRecipeLibrary(env.DB as unknown as D1Store))
      if(new URL(request.url).pathname==='/read-witness-numeric')return Response.json(await testReadWitnessNumbers(env.DB as unknown as D1Store))
      if(new URL(request.url).pathname==='/board-settings')return Response.json(await testBoardSettings(env.DB as unknown as D1Store))
      if(new URL(request.url).pathname==='/assistant-actions')return Response.json(await testAssistantActions(env.DB as unknown as D1Store))
      if(new URL(request.url).pathname==='/food-source')return Response.json(await testFoodSourceGuards(env.DB as unknown as D1Store))
      if(new URL(request.url).pathname==='/notes-projects')return Response.json(await testNotesProjects(env.DB as unknown as D1Store))
      if(new URL(request.url).pathname==='/device-writes')return Response.json(await testDeviceWrites(env.DB as unknown as D1Store))
      if(new URL(request.url).pathname==='/board')return Response.json(await testBoardReads(env.DB as unknown as D1Store))
      if (new URL(request.url).pathname === '/storage') return Response.json(await testStorage(env.DB as unknown as D1Store))
      if (new URL(request.url).pathname === '/messages') return Response.json(await testMessages(env.DB as unknown as D1Store))
      if (new URL(request.url).pathname === '/account-recovery') return Response.json(await testAccountRecovery(env.DB as unknown as D1Store))
      if (new URL(request.url).pathname === '/inventory-recovery') return Response.json(await testInventoryRecovery(env.DB as unknown as D1Store))
      if (new URL(request.url).pathname === '/allowance') return Response.json(await testAllowance(env.DB as unknown as D1Store))
      if (new URL(request.url).pathname === '/analytics-feedback') return Response.json(await testAnalyticsFeedback(env.DB as unknown as D1Store))
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
export { LocalPasswordCompute }
