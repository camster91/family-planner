/** D1 GDPR export adapter.
 *
 * This deliberately builds the same household/person boundaries as the
 * Postgres export.  It uses read-only Prisma-D1 delegates, removes household
 * identity and bearer credentials from exported rows, and never substitutes
 * an empty result when a scoped read fails.
 */
import { BACKFILL_SOURCE_APP } from "@/lib/backfill/meals-groceries";
import { isParentRole, shapeHandoffForRole } from "@/lib/role-capabilities";
import {
  MORNING_SUMMARY_SELECT,
  morningSummaryFromRow,
  NOTIFICATION_PREFERENCE_SELECT,
  preferencesFromRow,
} from "@/lib/notification-policy";
import { QUIET_HOURS_SELECT, quietHoursFromRow } from "@/lib/quiet-hours";
import { AUDIT_RETENTION_MS } from "@/lib/household-audit";
import { getD1Database, type D1Store } from "./database";
import { withD1ReadClient } from "./read-client";
import { exportD1AiUsage } from "./ai-usage";
import { d1ResponsibilityStorageAvailable } from "./responsibility";

type ExportActor = { userId: string; generation: number };
type NativeResult = { status: number; body: unknown };

const PRIVATE_FIELDS = new Set([
  "family_id",
  "password",
  "password_hash",
  "feed_token",
  "invite_code",
  "capture_ai_key_enc",
  "capture_ai_base_url",
  "share_token",
  "url_enc",
  "etag",
  "last_modified",
  "access_token_enc",
  "refresh_token_enc",
  "sync_cursor",
  "endpoint",
  "keys",
  "idempotency_key",
  "request_id",
  "source_request_id",
  "import_metadata",
  // D1-only continuity columns are intentionally @ignore in Prisma and must
  // not become part of a portable export just because the batched SQL uses
  // SELECT * for the canonical table rows.
  "food_generation",
  "food_epoch",
]);

function publicRow(
  row: Record<string, unknown>,
  extra: string[] | number = [],
) {
  const excluded = new Set([
    ...PRIVATE_FIELDS,
    ...(Array.isArray(extra) ? extra : []),
  ]);
  return Object.fromEntries(
    Object.entries(row).filter(([key]) => !excluded.has(key)),
  );
}

function parseJson(value: unknown) {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

async function many(db: any, model: string, where: Record<string, unknown>) {
  const delegate = db[model];
  if (!delegate || typeof delegate.findMany !== "function")
    throw new Error(`D1 export model unavailable: ${model}`);
  return delegate.findMany({ where });
}

const DATE_FIELDS = new Set([
  "created_at",
  "updated_at",
  "date",
  "due_date",
  "started_at",
  "completed_at",
  "last_chore_date",
  "last_purchased_at",
  "checked_at",
  "claimed_at",
  "approved_at",
  "redeemed_at",
  "ended_at",
  "started_on",
  "ended_on",
  "pickup_time",
  "arrival_time",
  "departure_time",
  "share_expires_at",
  "scheduled_for",
  "paid_at",
  "status_changed_at",
  "prepared_on",
  "next_prep_on",
  "prepared_at",
  "consumed_at",
  "cancelled_at",
  "expires_on",
  "purchased_on",
  "opened_on",
  "finished_at",
  "last_fetched_at",
  "last_synced_at",
  "last_conflict_at",
  "token_expires_at",
  "day",
  "start_date",
  "end_date",
  "verified_at",
  "logged_date",
  "logged_at",
  "earned_at",
  "requested_at",
  "fulfilled_at",
  "start_time",
  "end_time",
  "source_occurrence_start",
  "snoozed_until",
  "item_version",
  "fetched_at",
  "last_tick_at",
  "next_dose_at",
  "last_dose_at",
  "primary_at",
  "backup_at",
  "recipe_snapshot_at",
]);
const BOOLEAN_FIELDS = new Set([
  "email_verified",
  "notify_chores",
  "notify_events",
  "notify_messages",
  "quiet_hours_enabled",
  "morning_summary_enabled",
  "read",
  "approved",
  "is_active",
  "is_repeatable",
  "sort_by_section",
  "checked",
  "purchased",
  "completed",
  "dry_run",
  "active",
  "is_primary",
  "beta_metrics_enabled",
  "subject_member_erased",
  "photo_verified",
  "is_template",
  "all_day",
  "quiet",
]);
const JSON_FIELDS = new Set([
  "features",
  "summary",
  "payload",
  "metadata",
  "keys",
  "sections",
  "recipe_snapshot",
  "display_preferences",
  "routine_series_config",
  "rotation_member_ids",
  "weekly_days",
  "schedule_config",
  "temperature_log",
  "attachments",
  "read_by",
  "import_metadata",
]);

function hydrateRow(row: Record<string, unknown>) {
  const out: Record<string, unknown> = { ...row };
  for (const [key, value] of Object.entries(out)) {
    if (DATE_FIELDS.has(key) && typeof value === "number")
      out[key] = new Date(value);
    else if (BOOLEAN_FIELDS.has(key) && (value === 0 || value === 1))
      out[key] = value === 1;
    else if (JSON_FIELDS.has(key)) out[key] = parseJson(value);
  }
  return out;
}

type BatchSpec = {
  key: string;
  table: string;
  where: string;
  values: Array<string | number | null>;
};

async function readExportRows(
  database: D1Store,
  familyId: string | null,
  userId: string,
) {
  const familyOnly = (key: string, table: string): BatchSpec => ({
    key,
    table,
    where: familyId ? "family_id=?1" : "1=0",
    values: familyId ? [familyId] : [],
  });
  const familyOrOwner = (
    key: string,
    table: string,
    owner: string,
  ): BatchSpec =>
    familyId
      ? {
          key,
          table,
          where: `family_id=?1 OR ${owner}=?2`,
          values: [familyId, userId],
        }
      : { key, table, where: `${owner}=?1`, values: [userId] };
  const owned = (key: string, table: string, column: string): BatchSpec => ({
    key,
    table,
    where: `${column}=?1`,
    values: [userId],
  });
  const specs: BatchSpec[] = [
    familyOnly("chore", "Chore"),
    familyOrOwner("list", "List", "created_by"),
    owned("message", "Message", "sender_id"),
    owned("event", "Event", "created_by"),
    familyId
      ? {
          key: "reward",
          table: "Reward",
          where: "family_id=?1 OR created_by=?2 OR claimed_by=?2",
          values: [familyId, userId],
        }
      : {
          key: "reward",
          table: "Reward",
          where: "created_by=?1 OR claimed_by=?1",
          values: [userId],
        },
    owned("activity", "Activity", "user_id"),
    owned("transaction", "Transaction", "user_id"),
    familyOrOwner("project", "Project", "created_by"),
    familyOnly("recipe", "Recipe"),
    familyOnly("recipeCollection", "RecipeCollection"),
    familyOnly("familyMeal", "FamilyMeal"),
    familyOnly("mealPlan", "MealPlan"),
    familyOnly("shoppingList", "ShoppingList"),
    familyOnly("habit", "Habit"),
    familyOnly("habitLog", "HabitLog"),
    familyOnly("earnedBadge", "EarnedBadge"),
    familyOnly("rewardRedemption", "RewardRedemption"),
    familyOnly("familyGoal", "FamilyGoal"),
    familyOnly("importJob", "ImportJob"),
    familyOnly("financialArchiveRecord", "FinancialArchiveRecord"),
    familyOnly("inventoryItem", "InventoryItem"),
    familyOnly("foodProduct", "FoodProduct"),
    familyOnly("inventoryAdjustment", "InventoryAdjustment"),
    familyOnly("grocerySectionPreference", "GrocerySectionPreference"),
    familyOnly("groceryShoppingSession", "GroceryShoppingSession"),
    familyOnly("auditLog", "AuditLog"),
    familyOnly("betaMetricDaily", "BetaMetricDaily"),
    familyOnly("allowance", "Allowance"),
    familyOnly("wishlistItem", "WishlistItem"),
    familyOnly("sickDay", "SickDay"),
    familyOnly("medication", "Medication"),
    familyOnly("emergencyContact", "EmergencyContact"),
    familyOnly("anniversary", "Anniversary"),
    familyOnly("pickup", "Pickup"),
    familyOnly("pinnedNote", "PinnedNote"),
    familyOnly("familyLocation", "FamilyLocation"),
    familyOnly("handoff", "Handoff"),
    familyOnly("upload", "Upload"),
    familyOnly("choreAssignment", "ChoreAssignment"),
    familyOnly("calendarSubscription", "CalendarSubscription"),
    familyOnly("calendarConnection", "CalendarConnection"),
    familyOnly("pushSubscription", "PushSubscription"),
    familyOnly("budgetCategory", "BudgetCategory"),
    familyOnly("routineStack", "RoutineStack"),
    familyOnly("mealPrepSession", "MealPrepSession"),
    owned("notification", "Notification", "user_id"),
  ];
  const session = database.withSession("first-primary");
  const results = await session.batch(
    specs.map((spec) =>
      session
        .prepare(`SELECT * FROM "${spec.table}" WHERE ${spec.where}`)
        .bind(...spec.values),
    ),
  );
  return Object.fromEntries(
    specs.map((spec, index) => [
      spec.key,
      results[index].results.map((row: any) => hydrateRow(row)),
    ]),
  ) as Record<string, any[]>;
}

async function nativeEventPreparationExport(
  database: D1Store,
  actor: { userId: string; familyId: string | null; role: string },
  eventIds: string[],
  choreIds: string[],
) {
  if (
    !actor.familyId ||
    actor.role !== "parent" ||
    !eventIds.length ||
    !choreIds.length
  )
    return [];
  const session = database.withSession("first-primary");
  const ready = await session
    .prepare(
      `SELECT COUNT(*) AS total FROM sqlite_master WHERE type='table' AND name IN ('EventPreparation','EventPreparationStep')`,
    )
    .first<{ total: number }>();
  if (Number(ready?.total) !== 2) return undefined;
  const events = JSON.stringify([...new Set(eventIds)]);
  const chores = JSON.stringify([...new Set(choreIds)]);
  const rows = await session
    .prepare(
      `
    SELECT p.id,p.event_id,p.revision,
      s.id AS step_id,s.chore_id,s.position,s.cue_anchor,s.cue_direction,s.cue_minutes
    FROM "EventPreparation" p
    JOIN "Event" e ON e.id=p.event_id AND e.family_id=p.family_id
    LEFT JOIN "EventPreparationStep" s
      ON s.preparation_id=p.id AND s.family_id=p.family_id
      AND s.chore_id IN (SELECT value FROM json_each(?2))
    WHERE p.family_id=?1
      AND e.id IN (SELECT value FROM json_each(?3))
      AND EXISTS (SELECT 1 FROM "User" u WHERE u.id=?4 AND u.family_id=p.family_id AND u.role='parent')
    ORDER BY p.event_id,p.id,s.position,s.id`,
    )
    .bind(actor.familyId, chores, events, actor.userId)
    .all<{
      id: string;
      event_id: string;
      revision: number;
      step_id: string | null;
      chore_id: string | null;
      position: number | null;
      cue_anchor: string | null;
      cue_direction: string | null;
      cue_minutes: number | null;
    }>();
  const plans = new Map<
    string,
    {
      id: string;
      event_id: string;
      revision: number;
      steps: Array<Record<string, unknown>>;
    }
  >();
  for (const row of rows.results) {
    const plan =
      plans.get(row.id) ??
      plans
        .set(row.id, {
          id: row.id,
          event_id: row.event_id,
          revision: row.revision,
          steps: [],
        })
        .get(row.id)!;
    if (row.step_id !== null)
      plan.steps.push({
        id: row.step_id,
        chore_id: row.chore_id,
        position: row.position,
        cue_anchor: row.cue_anchor,
        cue_direction: row.cue_direction,
        cue_minutes: row.cue_minutes,
      });
  }
  return [...plans.values()];
}

async function nativeResponsibilityExport(
  database: D1Store,
  actor: { userId: string; familyId: string | null; role: string },
) {
  if (!actor.familyId || !["parent", "teen", "child"].includes(actor.role))
    return [];
  if (!(await d1ResponsibilityStorageAvailable(database))) return undefined;
  const rows = await database
    .withSession("first-primary")
    .prepare(
      `
    SELECT r.id,r.protocol,r.chore_id,r.pickup_id,r.handoff_id,r.revision,
      r.coordinator_id,r.backup_account_id,r.backup_member_id,
      r.primary_subject_account_id,r.primary_subject_member_id,r.primary_decision,r.primary_by_id,r.primary_method,r.primary_at,
      r.backup_decision,r.backup_by_id,r.backup_method,r.backup_at,r.created_at,r.updated_at
    FROM "ResponsibilityState" r
    WHERE r.family_id=?1 AND (?2<>'child' OR r.handoff_id IS NULL)
      AND EXISTS (SELECT 1 FROM "User" u WHERE u.id=?3 AND u.family_id=r.family_id AND u.role=?2)
      AND (?3 IN (r.coordinator_id,r.backup_account_id,r.primary_subject_account_id,r.primary_by_id,r.backup_by_id)
        OR EXISTS (SELECT 1 FROM "Chore" c WHERE c.id=r.chore_id AND c.family_id=r.family_id AND c.assigned_to=?3)
        OR EXISTS (SELECT 1 FROM "Pickup" p WHERE p.id=r.pickup_id AND p.family_id=r.family_id AND p.assigned_to=?3))
    ORDER BY r.created_at,r.id`,
    )
    .bind(actor.familyId, actor.role, actor.userId)
    .all<Record<string, unknown>>();
  return rows.results.map((row) => hydrateRow(row));
}

async function nativeNotificationEventsExport(
  database: D1Store,
  actor: { userId: string; familyId: string | null; role: string },
) {
  if (!actor.familyId || actor.role !== "parent") return undefined;
  const session = database.withSession("first-primary");
  const ready = await session
    .prepare(
      `SELECT COUNT(*) AS total FROM sqlite_master WHERE type='table' AND name IN ('NotificationEventOccurrence','NotificationRecipientDecision')`,
    )
    .first<{ total: number }>();
  if (Number(ready?.total) !== 2) return undefined;
  const results = await session.batch([
    session
      .prepare(
        `SELECT o.id,o.envelope,o.created_at FROM "NotificationEventOccurrence" o WHERE o.family_id=?1 AND EXISTS (SELECT 1 FROM "User" u WHERE u.id=?2 AND u.family_id=o.family_id AND u.role='parent') ORDER BY o.id`,
      )
      .bind(actor.familyId, actor.userId),
    session
      .prepare(
        `SELECT event_id,slot,user_id,status,notification_id,quiet,created_at FROM "NotificationRecipientDecision" WHERE family_id=?1 ORDER BY event_id,slot`,
      )
      .bind(actor.familyId),
  ]);
  const decisions = new Map<string, Array<Record<string, unknown>>>();
  for (const row of results[1].results as Array<Record<string, unknown>>) {
    (
      decisions.get(String(row.event_id)) ??
      decisions.set(String(row.event_id), []).get(String(row.event_id))!
    ).push({
      slot: row.slot,
      user_id: row.user_id,
      status: row.status,
      notification_id: row.notification_id,
      quiet: row.quiet === 1 || row.quiet === true,
      created_at:
        typeof row.created_at === "number"
          ? new Date(row.created_at)
          : row.created_at,
    });
  }
  return (results[0].results as Array<Record<string, unknown>>).map((row) => ({
    id: row.id,
    envelope: parseJson(row.envelope),
    created_at:
      typeof row.created_at === "number"
        ? new Date(row.created_at)
        : row.created_at,
    recipient_decisions: decisions.get(String(row.id)) ?? [],
  }));
}

export async function readD1UserExport(
  actor: ExportActor,
  database?: D1Store,
): Promise<NativeResult> {
  const store = database ?? (await getD1Database());
  return withD1ReadClient(async (db) => {
    const current = await (db as any).user.findUnique({
      where: { id: actor.userId },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        age: true,
        family_id: true,
        token_version: true,
        xp: true,
        level: true,
        streak: true,
        best_streak: true,
        avatar_url: true,
        last_chore_date: true,
        created_at: true,
        email_verified: true,
        display_preferences: true,
        display_preferences_revision: true,
        weekly_reset_progress: true,
        weekly_reset_revision: true,
        ...NOTIFICATION_PREFERENCE_SELECT,
        ...QUIET_HOURS_SELECT,
        ...MORNING_SUMMARY_SELECT,
      },
    });
    if (!current || current.token_version !== actor.generation)
      return { status: 401, body: { error: "Unauthorized" } };
    const familyId = current.family_id as string | null;
    const role = current.role as string;
    const parent = isParentRole(role);
    const empty = Promise.resolve([] as any[]);
    const family = familyId
      ? (db as any).family.findUnique({
          where: { id: familyId },
          select: {
            id: true,
            name: true,
            subscription_tier: true,
            features: true,
            created_at: true,
            beta_metrics_enabled: true,
            ...(parent
              ? {
                  travel_mode_active: true,
                  travel_start_date: true,
                  travel_end_date: true,
                  travel_destination: true,
                }
              : {}),
          },
        })
      : Promise.resolve(null);
    const rows = await readExportRows(store, familyId, actor.userId);
    const familyRows = family;
    const household = (key: string) => rows[key] ?? [];
    const filter = (key: string, predicate: (row: any) => boolean) =>
      household(key).filter(predicate);
    const [familyRow] = await Promise.all([familyRows]);
    const choresRows = household("chore");
    const listRows = household("list");
    const messageRows = filter(
      "message",
      (row) => row.sender_id === actor.userId,
    );
    const eventRows = filter("event", (row) => row.created_by === actor.userId);
    const rewardRows = household("reward");
    const notificationRows = household("notification");
    const activityRows = filter(
      "activity",
      (row) => row.user_id === actor.userId,
    );
    const transactionRows = filter(
      "transaction",
      (row) => row.user_id === actor.userId,
    );
    const projectRows = household("project");
    const recipeRows = household("recipe");
    const collectionRows = household("recipeCollection");
    const mealRows = household("familyMeal");
    const mealPlanRows = household("mealPlan");
    const shoppingListRows = household("shoppingList");
    const habitRows = household("habit");
    const habitLogRows = household("habitLog");
    const badgeRows = household("earnedBadge");
    const redemptionRows = household("rewardRedemption");
    const goalRows = household("familyGoal");
    const importRows = parent ? household("importJob") : [];
    const archiveRows = parent ? household("financialArchiveRecord") : [];
    const backfillRows = household("importJob").filter(
      (row) => row.source_app === BACKFILL_SOURCE_APP,
    );
    const inventoryRows = household("inventoryItem");
    const foodProductRows =
      parent || role === "teen" ? household("foodProduct") : [];
    const adjustmentRows = household("inventoryAdjustment");
    const sectionRows = household("grocerySectionPreference");
    const shoppingSessionRows = household("groceryShoppingSession");
    const auditRows = filter("auditLog", (row) => {
      const recent =
        !(row.created_at instanceof Date) ||
        row.created_at.getTime() >= Date.now() - AUDIT_RETENTION_MS;
      return recent && (parent || row.actor_user_id === actor.userId);
    });
    const betaRows = household("betaMetricDaily");
    const allowanceRows = filter("allowance", (row) =>
      parent
        ? row.to_user_id === actor.userId || row.from_user_id === actor.userId
        : row.to_user_id === actor.userId,
    );
    const wishlistRows = filter(
      "wishlistItem",
      (row) => row.requested_by === actor.userId,
    );
    const sickRows = filter("sickDay", (row) => row.person_id === actor.userId);
    const medicationRows = filter(
      "medication",
      (row) => row.person_id === actor.userId,
    );
    const emergencyRows = filter(
      "emergencyContact",
      (row) => row.person_id === actor.userId,
    );
    const anniversaryRows = filter(
      "anniversary",
      (row) =>
        row.person_id === actor.userId || row.created_by === actor.userId,
    );
    const pickupRows = filter(
      "pickup",
      (row) =>
        row.assigned_to === actor.userId || row.created_by === actor.userId,
    );
    const noteRows = filter(
      "pinnedNote",
      (row) => row.created_by === actor.userId,
    );
    const locationRows = parent
      ? filter("familyLocation", (row) => row.user_id === actor.userId)
      : [];
    const handoffRows = filter(
      "handoff",
      (row) => row.created_by === actor.userId,
    );
    const uploadRows = filter(
      "upload",
      (row) => row.uploaded_by === actor.userId,
    );
    const assignmentRows = filter(
      "choreAssignment",
      (row) =>
        row.assigned_to === actor.userId ||
        row.completed_by === actor.userId ||
        row.approved_by === actor.userId,
    );
    const subscriptionRows =
      parent || role === "teen"
        ? filter(
            "calendarSubscription",
            (row) => row.created_by === actor.userId,
          )
        : [];
    const connectionRows = parent
      ? filter("calendarConnection", (row) => row.user_id === actor.userId)
      : [];
    const pushRows = filter(
      "pushSubscription",
      (row) => row.user_id === actor.userId,
    );
    const categoryRows = parent
      ? filter("budgetCategory", (row) => row.created_by === actor.userId)
      : [];
    const routineRows = parent ? household("routineStack") : [];
    const prepRows =
      parent || role === "teen" ? household("mealPrepSession") : [];

    const ids = (rows: any[]) => rows.map((row) => row.id).filter(Boolean);
    const [
      listItems,
      projectTasks,
      recipeIngredients,
      collectionEntries,
      mealPlanEntries,
      shoppingItems,
      mealBatches,
    ] = await Promise.all([
      listRows.length
        ? many(db, "listItem", { list_id: { in: ids(listRows) } })
        : empty,
      projectRows.length
        ? many(db, "projectTask", { project_id: { in: ids(projectRows) } })
        : empty,
      recipeRows.length
        ? many(db, "recipeIngredient", { recipe_id: { in: ids(recipeRows) } })
        : empty,
      collectionRows.length
        ? many(db, "recipeCollectionEntry", {
            family_id: familyId,
            collection_id: { in: ids(collectionRows) },
          })
        : empty,
      mealPlanRows.length
        ? many(db, "mealPlanEntry", { meal_plan_id: { in: ids(mealPlanRows) } })
        : empty,
      shoppingListRows.length
        ? many(db, "shoppingItem", {
            shopping_list_id: { in: ids(shoppingListRows) },
          })
        : empty,
      prepRows.length
        ? many(db, "mealBatch", {
            family_id: familyId,
            prep_session_id: { in: ids(prepRows) },
          })
        : empty,
    ]);
    const ingredientIds = [
      ...new Set(
        (recipeIngredients as any[])
          .map((row) => row.ingredient_id)
          .filter(Boolean),
      ),
    ];
    const batchIds = ids(mealBatches as any[]);
    const [ingredients, batchConsumption] = await Promise.all([
      ingredientIds.length
        ? many(db, "ingredient", {
            family_id: familyId,
            id: { in: ingredientIds },
          })
        : empty,
      batchIds.length
        ? many(db, "mealBatchConsumption", {
            family_id: familyId,
            batch_id: { in: batchIds },
          })
        : empty,
    ]);
    const ingredientMap = new Map(
      (ingredients as any[]).map((row) => [row.id, publicRow(row)]),
    );
    const recipeIngredientMap = new Map<string, any[]>();
    for (const row of recipeIngredients as any[])
      (
        recipeIngredientMap.get(row.recipe_id) ??
        recipeIngredientMap.set(row.recipe_id, []).get(row.recipe_id)!
      ).push({
        ...publicRow(row),
        ingredient: ingredientMap.get(row.ingredient_id) ?? null,
      });
    const entriesByCollection = new Map<string, any[]>();
    for (const row of collectionEntries as any[])
      (
        entriesByCollection.get(row.collection_id) ??
        entriesByCollection.set(row.collection_id, []).get(row.collection_id)!
      ).push(publicRow(row));
    const itemsByList = new Map<string, any[]>();
    for (const row of listItems as any[])
      (
        itemsByList.get(row.list_id) ??
        itemsByList.set(row.list_id, []).get(row.list_id)!
      ).push(publicRow(row));
    const tasksByProject = new Map<string, any[]>();
    for (const row of projectTasks as any[])
      (
        tasksByProject.get(row.project_id) ??
        tasksByProject.set(row.project_id, []).get(row.project_id)!
      ).push(publicRow(row));
    const entriesByPlan = new Map<string, any[]>();
    for (const row of mealPlanEntries as any[])
      (
        entriesByPlan.get(row.meal_plan_id) ??
        entriesByPlan.set(row.meal_plan_id, []).get(row.meal_plan_id)!
      ).push(publicRow(row));
    const shoppingItemsByList = new Map<string, any[]>();
    for (const row of shoppingItems as any[])
      (
        shoppingItemsByList.get(row.shopping_list_id) ??
        shoppingItemsByList
          .set(row.shopping_list_id, [])
          .get(row.shopping_list_id)!
      ).push(publicRow(row));
    const batchesByPrep = new Map<string, any[]>();
    for (const row of mealBatches as any[])
      (
        batchesByPrep.get(row.prep_session_id) ??
        batchesByPrep.set(row.prep_session_id, []).get(row.prep_session_id)!
      ).push({
        ...publicRow(row),
        consumption: (batchConsumption as any[])
          .filter((item) => item.batch_id === row.id)
          .map((item) => publicRow(item)),
      });

    const [aiUsage, responsibilityState, eventPreparation, notificationEvents] =
      await Promise.all([
        exportD1AiUsage(store, actor.userId, familyId, role),
        nativeResponsibilityExport(store, {
          userId: actor.userId,
          familyId,
          role,
        }),
        nativeEventPreparationExport(
          store,
          { userId: actor.userId, familyId, role },
          eventRows.map((row) => row.id),
          choresRows.map((row) => row.id),
        ),
        nativeNotificationEventsExport(store, {
          userId: actor.userId,
          familyId,
          role,
        }),
      ]);
    const {
      token_version: _tokenVersion,
      family_id: _currentFamily,
      weekly_reset_progress: _weeklyResetProgress,
      weekly_reset_revision: _weeklyResetRevision,
      ...exportedUser
    } = current;
    const exportData = {
      exportedAt: new Date().toISOString(),
      ...(notificationEvents === undefined ? {} : { notificationEvents }),
      ...(aiUsage === undefined ? {} : { aiUsage }),
      ...(eventPreparation === undefined ? {} : { eventPreparation }),
      ...(responsibilityState === undefined ? {} : { responsibilityState }),
      weeklyReset: {
        progress: parseJson(current.weekly_reset_progress),
        revision: current.weekly_reset_revision,
      },
      user: exportedUser,
      notificationPreferences: preferencesFromRow(current),
      quietHours: quietHoursFromRow(current),
      morningSummary: morningSummaryFromRow(current),
      family: familyRow,
      chores: (choresRows as any[]).map((row) => {
        const value = publicRow(row);
        if (!parent) delete value.routine_series_config;
        return value;
      }),
      lists: (listRows as any[]).map((row) => ({
        ...publicRow(row),
        items: itemsByList.get(row.id) ?? [],
      })),
      messages: (messageRows as any[]).map(publicRow),
      events: (eventRows as any[]).map(publicRow),
      rewards: (rewardRows as any[]).map(publicRow),
      notifications: (notificationRows as any[]).map(publicRow),
      activities: (activityRows as any[]).map(publicRow),
      transactions: (transactionRows as any[]).map(publicRow),
      projects: (projectRows as any[]).map((row) => ({
        ...publicRow(row),
        tasks: tasksByProject.get(row.id) ?? [],
      })),
      recipes: (recipeRows as any[]).map((row) => ({
        ...publicRow(row),
        ingredients: recipeIngredientMap.get(row.id) ?? [],
        collection_entries: (collectionEntries as any[])
          .filter((entry) => entry.recipe_id === row.id)
          .map((entry) => publicRow(entry, ["recipe_id"])),
      })),
      recipeCollections: (collectionRows as any[]).map((row) => ({
        id: row.id,
        name: row.name,
        revision: row.revision,
        created_at: row.created_at,
      })),
      meals: (mealRows as any[]).map(publicRow),
      mealPrepSessions: (prepRows as any[]).map((row) => ({
        ...publicRow(row),
        batches: batchesByPrep.get(row.id) ?? [],
      })),
      inventory: (inventoryRows as any[]).map(publicRow),
      foodProducts: (foodProductRows as any[]).map(publicRow),
      inventoryAdjustments: (adjustmentRows as any[]).map(publicRow),
      grocerySectionPreferences: (sectionRows as any[]).map((row) =>
        publicRow(row, ["id"]),
      ),
      groceryShoppingSessions: (shoppingSessionRows as any[]).map(publicRow),
      auditLog: (auditRows as any[]).map(publicRow),
      betaMetrics: (betaRows as any[]).map(publicRow),
      mealPlans: (mealPlanRows as any[]).map((row) => ({
        ...publicRow(row),
        entries: entriesByPlan.get(row.id) ?? [],
      })),
      shoppingLists: (shoppingListRows as any[]).map((row) => ({
        ...publicRow(row),
        items: shoppingItemsByList.get(row.id) ?? [],
      })),
      habits: (habitRows as any[]).map(publicRow),
      habitLogs: (habitLogRows as any[]).map(publicRow),
      earnedBadges: (badgeRows as any[]).map(publicRow),
      rewardRedemptions: (redemptionRows as any[]).map(publicRow),
      familyGoals: (goalRows as any[]).map(publicRow),
      importJobs: (importRows as any[]).map((row) =>
        publicRow(row, ["started_by"]),
      ),
      financeArchive: (archiveRows as any[]).map((row) => publicRow(row)),
      mealBackfillJobs: (backfillRows as any[]).map((row) =>
        publicRow(row, ["started_by"]),
      ),
      allowances: (allowanceRows as any[]).map(publicRow),
      wishlistItems: (wishlistRows as any[]).map(publicRow),
      sickDays: (sickRows as any[]).map(publicRow),
      medications: (medicationRows as any[]).map(publicRow),
      emergencyContacts: (emergencyRows as any[]).map(publicRow),
      anniversaries: (anniversaryRows as any[]).map(publicRow),
      pickups: (pickupRows as any[]).map((row) =>
        publicRow(row, ["responsibility_generation", "responsibility_epoch"]),
      ),
      pinnedNotes: (noteRows as any[]).map(publicRow),
      familyLocations: (locationRows as any[]).map(publicRow),
      handoffs: (handoffRows as any[]).map((row) =>
        shapeHandoffForRole(
          publicRow(row, ["responsibility_generation", "responsibility_epoch"]),
          role,
        ),
      ),
      uploads: (uploadRows as any[]).map(publicRow),
      choreAssignments: (assignmentRows as any[]).map((row) =>
        publicRow(row, ["assigned_member_id", "member_subject_erased"]),
      ),
      calendarSubscriptions: (subscriptionRows as any[]).map(publicRow),
      calendarConnections: (connectionRows as any[]).map(publicRow),
      pushSubscriptions: (pushRows as any[]).map(publicRow),
      budgetCategories: (categoryRows as any[]).map(publicRow),
      routineStacks: (routineRows as any[]).map(publicRow),
    };
    return { status: 200, body: exportData };
  }, store as any);
}
