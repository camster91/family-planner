import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { authenticateRequest } from '@/lib/api-auth'
import { BACKFILL_SOURCE_APP } from '@/lib/backfill/meals-groceries'
import {
  MORNING_SUMMARY_SELECT,
  NOTIFICATION_PREFERENCE_SELECT,
  morningSummaryFromRow,
  preferencesFromRow,
} from '@/lib/notification-policy'
import { QUIET_HOURS_SELECT, quietHoursFromRow } from '@/lib/quiet-hours'
import { AUDIT_RETENTION_MS } from '@/lib/household-audit'
import { logRouteError } from '@/lib/api-error'
import { getRequestId } from '@/lib/request-id'
import { isParentRole, shapeHandoffForRole } from '@/lib/role-capabilities'

export const dynamic = 'force-dynamic'

// GET - Export all data for the current user (GDPR Article 20 — data portability)
// Returns a JSON document containing:
// - User profile (no password)
// - Family info
// - All chores they created or are assigned to
// - All lists they created
// - All messages they sent
// - All events they created
// - All rewards they created or claimed
// - All notifications addressed to them, and their notification preferences
//   (#286: `notificationPreferences`, also the notify_* columns on `user`)
//   and quiet hours (#141: `quietHours`, also the quiet_hours_* columns)
// - All activities they performed
// - The household's meal plan (FamilyMeal, ADR-0007) and recipes
// - The household's food inventory (InventoryItem, #263), including used-up
//   and thrown-away items, and its consume/discard history
//   (InventoryAdjustment, #158/#121)
// - The household's grocery store-section choices and shopping trips (#273)
// - Household audit history (#285) from the last 12 months: every row for a
//   parent (the audience of Settings -> Recent changes); for a teen or child
//   only the rows where they are the actor (e.g. joining the household)
// - The household's beta usage counts (#287): the on/off switch
//   (`family.beta_metrics_enabled`) and every stored count (`betaMetrics`,
//   day, metric name and count only; nothing about a person)
// - The frozen legacy MealPlan/ShoppingList tables while they exist, plus the
//   ADR-0007 backfill job summaries that archive legacy rows the backfill
//   skipped (MEALS_AND_GROCERIES.md §6), so no archived row is lost when the
//   legacy tables are later dropped
// - The caller's own rows in per-person domains, current household only (no
//   family_id, never another household's rows), with the role rules of the
//   matching GET route and never a secret:
//   `allowances` (paid to them; for a parent also those they gave),
//   `wishlistItems` (they asked for), `sickDays` and `medications` (about them),
//   `emergencyContacts` (their own card), `anniversaries` (about them or added
//   by them), `pickups` (assigned to or added by them), `pinnedNotes` (they
//   wrote), `choreAssignments` (assigned to, completed or approved by them; no
//   idempotency key), `uploads` (metadata of photos they uploaded, no bytes),
//   `handoffs` (they created; never the share token), `pushSubscriptions`
//   (registration dates only: no endpoint, no keys). Parent-only:
//   `familyLocations` (their own saved places), `budgetCategories` (they
//   created), `calendarConnections` (their own; no tokens or sync cursor).
//   Parent or teen: `calendarSubscriptions` (they added; no feed URL, no
//   caching headers).
export async function GET(request: NextRequest) {
  try {
    const [payload, error] = await authenticateRequest(request)
    if (error) return error

    const userId = payload.userId

    // Household and role for the per-person domains below: each of them is
    // filtered on the caller's current household as well as their own
    // columns, so rows left behind in a previous household never leak.
    const me = await prisma!.user.findUnique({ where: { id: userId }, select: { family_id: true, role: true } })
    const familyId = me?.family_id ?? null
    const isParent = isParentRole(me?.role)
    const mayReadSubscriptions = isParent || me?.role === 'teen'
    const own = familyId != null
    const none = Promise.resolve([] as never[])

    // Fetch all data in parallel
    const [
      user, family, chores, lists, messages, events, rewards, notifications, activities,
      transactions, projects, recipes, mealPlans, shoppingLists, habits, habitLogs,
      earnedBadges, rewardRedemptions, familyGoals, importJobs, financeArchive,
      meals, mealBackfillJobs, inventory, inventoryAdjustments, grocerySectionPreferences, groceryShoppingSessions,
      auditLog, betaMetrics,
      allowances, wishlistItems, sickDays, medications, emergencyContacts, anniversaries, pickups, pinnedNotes,
      familyLocations, handoffs, uploads, choreAssignments, calendarSubscriptions, calendarConnections,
      pushSubscriptions, budgetCategories,
    ] = await Promise.all([
      prisma!.user.findUnique({
        where: { id: userId },
        select: {
          id: true, email: true, name: true, role: true, age: true,
          xp: true, level: true, streak: true, best_streak: true,
          avatar_url: true, last_chore_date: true,
          created_at: true, email_verified: true,
          // Notification preferences (#286); exported as `notificationPreferences`.
          ...NOTIFICATION_PREFERENCE_SELECT,
          // Quiet hours (#141, O-32); exported as `quietHours`.
          ...QUIET_HOURS_SELECT,
          // Morning summary switch and zone (O-38); exported as `morningSummary`.
          ...MORNING_SUMMARY_SELECT,
          // Explicitly EXCLUDE password
        },
      }),
      // Explicit select: never export secrets (feed_token, invite_code,
      // capture_ai_key_enc, capture_ai_base_url) — children can export too.
      // Travel plans are parent-only (#102), so only a parent's export has them.
      familyId
        ? prisma!.family.findUnique({
            where: { id: familyId },
            select: {
              id: true, name: true, subscription_tier: true, features: true,
              created_at: true, beta_metrics_enabled: true,
              ...(isParent
                ? {
                    travel_mode_active: true, travel_start_date: true,
                    travel_end_date: true, travel_destination: true,
                  }
                : {}),
            },
          })
        : null,
      // Only the caller's current household: a removed member's done chores
      // stay assigned to them in the old household (O-34) and must not leak.
      prisma!.chore.findMany({
        where: familyId
          ? { family_id: familyId, OR: [{ created_by: userId }, { assigned_to: userId }, { family_id: familyId }] }
          : { id: { in: [] } },
        include: {
          assignee: { select: { id: true, name: true } },
          creator: { select: { id: true, name: true } },
        },
      }),
      prisma!.list.findMany({
        where: {
          OR: [
            { created_by: userId },
            { family: { members: { some: { id: userId } } } },
          ],
        },
        include: { items: true },
      }),
      prisma!.message.findMany({
        where: { sender_id: userId },
      }),
      prisma!.event.findMany({
        where: { created_by: userId },
      }),
      prisma!.reward.findMany({
        where: {
          OR: [
            { created_by: userId },
            { claimed_by: userId },
            { family: { members: { some: { id: userId } } } },
          ],
        },
      }),
      prisma!.notification.findMany({
        where: { user_id: userId },
      }),
      prisma!.activity.findMany({
        where: { user_id: userId },
      }),
      prisma!.transaction.findMany({
        where: { user_id: userId },
      }),
      prisma!.project.findMany({
        where: {
          OR: [
            { created_by: userId },
            { family: { members: { some: { id: userId } } } },
          ],
        },
        include: { tasks: true },
      }),
      prisma!.recipe.findMany({
        where: { family: { members: { some: { id: userId } } } },
        include: { ingredients: { include: { ingredient: true } } },
      }),
      prisma!.mealPlan.findMany({
        where: { family: { members: { some: { id: userId } } } },
        include: { entries: true },
      }),
      prisma!.shoppingList.findMany({
        where: { family: { members: { some: { id: userId } } } },
        include: { items: true },
      }),
      prisma!.habit.findMany({
        where: { family: { members: { some: { id: userId } } } },
      }),
      prisma!.habitLog.findMany({
        where: { family: { members: { some: { id: userId } } } },
      }),
      prisma!.earnedBadge.findMany({
        where: { family: { members: { some: { id: userId } } } },
        include: { badge: true },
      }),
      prisma!.rewardRedemption.findMany({
        where: { family: { members: { some: { id: userId } } } },
      }),
      prisma!.familyGoal.findMany({
        where: { family: { members: { some: { id: userId } } } },
      }),
      prisma!.importJob.findMany({
        where: { family: { members: { some: { id: userId, role: 'parent' } } } },
        select: {
          id: true, source_app: true, source_version: true, status: true, dry_run: true,
          started_at: true, completed_at: true, summary: true, error: true,
        },
      }),
      prisma!.financialArchiveRecord.findMany({
        where: { family: { members: { some: { id: userId, role: 'parent' } } } },
      }),
      prisma!.familyMeal.findMany({
        where: { family: { members: { some: { id: userId } } } },
        select: {
          id: true, date: true, meal_type: true, recipe_name: true, notes: true,
          cook_id: true, recipe_id: true, servings: true, created_by: true,
          created_at: true, updated_at: true,
        },
        orderBy: [{ date: 'asc' }, { created_at: 'asc' }],
      }),
      // Every member's export carries the legacy MealPlan/ShoppingList rows,
      // so every member's export also carries their archived copies.
      prisma!.importJob.findMany({
        where: {
          source_app: BACKFILL_SOURCE_APP,
          family: { members: { some: { id: userId } } },
        },
        select: {
          id: true, source_app: true, source_version: true, status: true, dry_run: true,
          started_at: true, completed_at: true, summary: true,
        },
      }),
      // Food inventory (#263): every member may read it, so every member's
      // export carries it. No family_id (the export is already one household).
      prisma!.inventoryItem.findMany({
        where: { family: { members: { some: { id: userId } } } },
        select: {
          id: true, name: true, ingredient_id: true, amount: true, unit: true,
          location: true, expires_on: true, date_kind: true, category: true, purchased_on: true,
          opened_on: true, status: true, finished_at: true, added_by: true, created_at: true, updated_at: true,
        },
        orderBy: [{ created_at: 'asc' }, { id: 'asc' }],
      }),
      // Inventory history (#158/#121): "Used it" / "Throw away" rows, same
      // audience as the items. No family_id and no idempotency request id.
      prisma!.inventoryAdjustment.findMany({
        where: { family: { members: { some: { id: userId } } } },
        select: {
          id: true, item_id: true, kind: true, amount_delta: true, amount_before: true, amount_after: true,
          status_before: true, status_after: true, actor_id: true, created_at: true, undone_at: true, undone_by: true,
        },
        orderBy: [{ created_at: 'asc' }, { id: 'asc' }],
      }),
      // Grocery store sections (#273): the household's "Move to…" choices and
      // the shopping trips the walking order is learned from (section ids and
      // times only). Every member may read and set them, so every member's
      // export carries them. No family_id.
      prisma!.grocerySectionPreference.findMany({
        where: { family: { members: { some: { id: userId } } } },
        select: { name_key: true, section: true, updated_by: true, created_at: true, updated_at: true },
        orderBy: [{ name_key: 'asc' }],
      }),
      prisma!.groceryShoppingSession.findMany({
        where: { family: { members: { some: { id: userId } } } },
        select: { id: true, list_id: true, sections: true, started_at: true, last_tick_at: true },
        orderBy: [{ started_at: 'asc' }, { id: 'asc' }],
      }),
      // Household audit history (#285): no family_id; rows past the 12-month
      // retention are left out even before the next read prunes them.
      prisma!.auditLog.findMany({
        where: {
          created_at: { gte: new Date(Date.now() - AUDIT_RETENTION_MS) },
          family: { members: { some: { id: userId } } },
          OR: [
            { family: { members: { some: { id: userId, role: 'parent' } } } },
            { actor_user_id: userId },
          ],
        },
        select: {
          id: true, action: true, actor_kind: true, actor_user_id: true, target_type: true,
          target_id: true, summary: true, created_at: true,
        },
        orderBy: [{ created_at: 'asc' }, { id: 'asc' }],
      }),
      // Beta usage counts (#287): household counts, no family_id.
      prisma!.betaMetricDaily.findMany({
        where: { family: { members: { some: { id: userId } } } },
        select: { day: true, metric: true, count: true },
        orderBy: [{ day: 'asc' }, { metric: 'asc' }],
      }),
      // ---- Per-person domains (current household only, no family_id) ----
      // Allowance (D5): a teen or child sees only rows paid to them.
      own
        ? prisma!.allowance.findMany({
            where: {
              family_id: familyId,
              OR: isParent ? [{ to_user_id: userId }, { from_user_id: userId }] : [{ to_user_id: userId }],
            },
            select: {
              id: true, from_user_id: true, to_user_id: true, amount: true, reason: true, status: true,
              scheduled_for: true, paid_at: true, created_at: true, updated_at: true,
            },
            orderBy: [{ created_at: 'asc' }, { id: 'asc' }],
          })
        : none,
      own
        ? prisma!.wishlistItem.findMany({
            where: { family_id: familyId, requested_by: userId },
            select: {
              id: true, title: true, link: true, description: true, approx_price: true, status: true,
              denied_reason: true, status_changed_at: true, status_changed_by: true, created_at: true, updated_at: true,
            },
            orderBy: [{ created_at: 'asc' }, { id: 'asc' }],
          })
        : none,
      // Sick days and medications (D1): only the ones about the caller.
      own
        ? prisma!.sickDay.findMany({
            where: { family_id: familyId, person_id: userId },
            select: {
              id: true, started_at: true, ended_at: true, symptoms: true, severity: true, status: true,
              temperature_log: true, notes: true, created_by: true, created_at: true, updated_at: true,
            },
            orderBy: [{ started_at: 'asc' }, { id: 'asc' }],
          })
        : none,
      own
        ? prisma!.medication.findMany({
            where: { family_id: familyId, person_id: userId },
            select: {
              id: true, sick_day_id: true, name: true, dosage: true, schedule: true, next_dose_at: true,
              last_dose_at: true, active: true, notes: true, created_by: true, created_at: true, updated_at: true,
            },
            orderBy: [{ created_at: 'asc' }, { id: 'asc' }],
          })
        : none,
      // Emergency card (D1): only the caller's own card.
      own
        ? prisma!.emergencyContact.findMany({
            where: { family_id: familyId, person_id: userId },
            select: {
              id: true, person_name: true, relationship: true, blood_type: true, allergies: true, medications: true,
              medical_conditions: true, doctor_name: true, doctor_phone: true, dentist_name: true,
              dentist_phone: true, insurance_provider: true, insurance_id: true, emergency_contact_name: true,
              emergency_contact_phone: true, emergency_contact_relation: true, notes: true, created_at: true,
              updated_at: true,
            },
            orderBy: [{ created_at: 'asc' }, { id: 'asc' }],
          })
        : none,
      own
        ? prisma!.anniversary.findMany({
            where: { family_id: familyId, OR: [{ person_id: userId }, { created_by: userId }] },
            select: {
              id: true, name: true, type: true, date: true, notes: true, person_id: true, created_by: true,
              created_at: true,
            },
            orderBy: [{ date: 'asc' }, { id: 'asc' }],
          })
        : none,
      own
        ? prisma!.pickup.findMany({
            where: { family_id: familyId, OR: [{ assigned_to: userId }, { created_by: userId }] },
            select: {
              id: true, title: true, location: true, pickup_time: true, assigned_to: true, created_by: true,
              notes: true, completed: true, completed_at: true, created_at: true, updated_at: true,
            },
            orderBy: [{ pickup_time: 'asc' }, { id: 'asc' }],
          })
        : none,
      own
        ? prisma!.pinnedNote.findMany({
            where: { family_id: familyId, created_by: userId },
            select: { id: true, title: true, body: true, color: true, pinned: true, created_at: true, updated_at: true },
            orderBy: [{ created_at: 'asc' }, { id: 'asc' }],
          })
        : none,
      // Saved places carry precise addresses: parent-only, like GET /api/locations.
      own && isParent
        ? prisma!.familyLocation.findMany({
            where: { family_id: familyId, user_id: userId },
            select: {
              id: true, label: true, address: true, latitude: true, longitude: true, is_primary: true,
              created_at: true, updated_at: true,
            },
            orderBy: [{ created_at: 'asc' }, { id: 'asc' }],
          })
        : none,
      // Handoffs (D2): never the share token (a bearer credential for the
      // public sitter page); shaped for the caller's role like GET /api/handoff.
      own
        ? prisma!.handoff.findMany({
            where: { family_id: familyId, created_by: userId },
            select: {
              id: true, sitter_name: true, sitter_phone: true, arrival_time: true, departure_time: true,
              kids_bedtimes: true, where_snacks: true, pickup_authorized: true, code_words: true, pet_care: true,
              emergency_notes: true, house_notes: true, general_notes: true, share_expires_at: true,
              created_by: true, created_at: true, updated_at: true,
            },
            orderBy: [{ created_at: 'asc' }, { id: 'asc' }],
          })
        : none,
      // Photo ownership records (D3): metadata only, never the file bytes.
      own
        ? prisma!.upload.findMany({
            where: { family_id: familyId, uploaded_by: userId },
            select: { id: true, filename: true, content_type: true, size_bytes: true, created_at: true },
            orderBy: [{ created_at: 'asc' }, { id: 'asc' }],
          })
        : none,
      own
        ? prisma!.choreAssignment.findMany({
            where: {
              family_id: familyId,
              OR: [{ assigned_to: userId }, { completed_by: userId }, { approved_by: userId }],
            },
            select: {
              id: true, chore_id: true, assigned_to: true, due_date: true, status: true, photo_url: true,
              completed_at: true, completed_by: true, approved_at: true, approved_by: true, approval_notes: true,
              xp_awarded: true, created_at: true, updated_at: true,
            },
            orderBy: [{ due_date: 'asc' }, { id: 'asc' }],
          })
        : none,
      // ICS subscriptions (#232): parents and teens may read them. The feed URL
      // is write-only (never exported); etag/last_modified are cache plumbing.
      own && mayReadSubscriptions
        ? prisma!.calendarSubscription.findMany({
            where: { family_id: familyId, created_by: userId },
            select: {
              id: true, name: true, color: true, last_fetched_at: true, last_status: true, last_error: true,
              created_at: true, updated_at: true,
            },
            orderBy: [{ created_at: 'asc' }, { id: 'asc' }],
          })
        : none,
      // Calendar sync (#264): parent-only; never tokens or the sync cursor.
      own && isParent
        ? prisma!.calendarConnection.findMany({
            where: { family_id: familyId, user_id: userId },
            select: {
              id: true, provider: true, calendar_id: true, calendar_name: true, push_mode: true, status: true,
              last_synced_at: true, last_error: true, conflicts_count: true, last_conflict_at: true,
              created_at: true, updated_at: true,
            },
            orderBy: [{ created_at: 'asc' }, { id: 'asc' }],
          })
        : none,
      // Web push: the endpoint and keys let a server reach the device, so only
      // the registration dates are exported.
      own
        ? prisma!.pushSubscription.findMany({
            where: { family_id: familyId, user_id: userId },
            select: { id: true, created_at: true, updated_at: true },
            orderBy: [{ created_at: 'asc' }, { id: 'asc' }],
          })
        : none,
      // Budget (finance) is parent-only, like GET /api/budget/categories.
      own && isParent
        ? prisma!.budgetCategory.findMany({
            where: { family_id: familyId, created_by: userId },
            select: { id: true, name: true, icon: true, color: true, type: true, budget_limit: true, created_at: true },
            orderBy: [{ created_at: 'asc' }, { id: 'asc' }],
          })
        : none,
    ])

    const exportData = {
      exportedAt: new Date().toISOString(),
      user,
      // Same shape as GET /api/users/preferences (#286).
      notificationPreferences: user ? preferencesFromRow(user) : null,
      quietHours: user ? quietHoursFromRow(user) : null,
      morningSummary: user ? morningSummaryFromRow(user) : null,
      family,
      chores,
      lists,
      messages,
      events,
      rewards,
      notifications,
      activities,
      transactions,
      projects,
      meals,
      recipes,
      inventory,
      inventoryAdjustments,
      grocerySectionPreferences,
      groceryShoppingSessions,
      auditLog,
      betaMetrics,
      mealPlans,
      shoppingLists,
      habits,
      habitLogs,
      earnedBadges,
      rewardRedemptions,
      familyGoals,
      importJobs,
      mealBackfillJobs,
      financeArchive,
      allowances,
      wishlistItems,
      sickDays,
      medications,
      emergencyContacts,
      anniversaries,
      pickups,
      pinnedNotes,
      familyLocations,
      handoffs: handoffs.map((h) => shapeHandoffForRole(h, me?.role)),
      uploads,
      choreAssignments,
      calendarSubscriptions,
      calendarConnections,
      pushSubscriptions,
      budgetCategories,
    }

    return new NextResponse(JSON.stringify(exportData, null, 2), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Content-Disposition': `attachment; filename="family-planner-export-${userId}-${Date.now()}.json"`,
      },
    })
  } catch (error) {
    logRouteError('GET /api/users/export', error, getRequestId(request))
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
