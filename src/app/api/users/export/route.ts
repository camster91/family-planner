import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { authenticateRequest } from '@/lib/api-auth'
import { BACKFILL_SOURCE_APP } from '@/lib/backfill/meals-groceries'
import { NOTIFICATION_PREFERENCE_SELECT, preferencesFromRow } from '@/lib/notification-policy'
import { QUIET_HOURS_SELECT, quietHoursFromRow } from '@/lib/quiet-hours'
import { AUDIT_RETENTION_MS } from '@/lib/household-audit'
import { logRouteError } from '@/lib/api-error'
import { getRequestId } from '@/lib/request-id'

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
export async function GET(request: NextRequest) {
  try {
    const [payload, error] = await authenticateRequest(request)
    if (error) return error

    const userId = payload.userId

    // Fetch all data in parallel
    const [
      user, family, chores, lists, messages, events, rewards, notifications, activities,
      transactions, projects, recipes, mealPlans, shoppingLists, habits, habitLogs,
      earnedBadges, rewardRedemptions, familyGoals, importJobs, financeArchive,
      meals, mealBackfillJobs, inventory, inventoryAdjustments, grocerySectionPreferences, groceryShoppingSessions,
      auditLog, betaMetrics,
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
          // Explicitly EXCLUDE password
        },
      }),
      prisma!.user.findUnique({ where: { id: userId }, select: { family_id: true, role: true } }).then(u =>
        // Explicit select: never export secrets (feed_token, invite_code,
        // capture_ai_key_enc, capture_ai_base_url) — children can export too.
        // Travel plans are parent-only (#102), so only a parent's export has them.
        u?.family_id
          ? prisma!.family.findUnique({
              where: { id: u.family_id },
              select: {
                id: true, name: true, subscription_tier: true, features: true,
                created_at: true, beta_metrics_enabled: true,
                ...(u.role === 'parent'
                  ? {
                      travel_mode_active: true, travel_start_date: true,
                      travel_end_date: true, travel_destination: true,
                    }
                  : {}),
              },
            })
          : null
      ),
      prisma!.chore.findMany({
        where: {
          OR: [
            { created_by: userId },
            { assigned_to: userId },
            { family: { members: { some: { id: userId } } } },
          ],
        },
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
    ])

    const exportData = {
      exportedAt: new Date().toISOString(),
      user,
      // Same shape as GET /api/users/preferences (#286).
      notificationPreferences: user ? preferencesFromRow(user) : null,
      quietHours: user ? quietHoursFromRow(user) : null,
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
