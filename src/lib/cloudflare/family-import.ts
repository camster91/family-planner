/** Native D1 family-import writer.
 *
 * The import planners are deliberately shared with PostgreSQL.  This module
 * only owns the storage part: it rechecks the household/session at the D1
 * batch boundary, creates an import job, records provenance, and applies the
 * canonical rows atomically.  It never accepts source ids as target ids.
 */
import { randomUUID } from "node:crypto";
import {
  cleanContent,
  IMPORTED_LIST_DESCRIPTION,
  matchIngredient,
  mealNamesMatch,
  normalizeMealType,
} from "@/lib/backfill/meals-groceries";
import { HouseholdMemberIdentityConflict } from "@/lib/household-member-lifecycle";
import { d1WriteCheck, isD1WriteConflict } from "./write-check";
import { getD1Database, type D1Store, type D1Statement } from "./database";
import { ImportSessionChangedError } from "@/lib/imports/import-authority";
import {
  planBudgetAppImport,
  type BudgetAppImportPlan,
} from "@/lib/imports/budget-app";
import {
  planChoreChampsImport,
  type ChoreChampsImportPlan,
} from "@/lib/imports/chore-champs";
import {
  planMealPlannerImport,
  type MealPlannerImportPlan,
} from "@/lib/imports/meal-planner";
import type { FamilyImportSource } from "@/lib/imports/run-family-import";

export type D1FamilyImportOptions = {
  source: FamilyImportSource;
  data: unknown;
  familyId: string;
  startedBy: string;
  identityMap?: Readonly<Record<string, string>>;
  dryRun?: boolean;
  /** The generation captured by authentication; every apply must recheck it. */
  sessionVersion: number;
  database?: D1Store;
};

type Skipped = { sourceModel: string; sourceId: string; reason: string };
type Counts = Record<string, number>;
type BaseSummary = { created: Counts; reused: Counts; skipped: Skipped[] };

function increment(bucket: Counts, key: string) {
  bucket[key] = (bucket[key] ?? 0) + 1;
}

function json(value: unknown) {
  return JSON.stringify(value);
}

function millis(value: Date | null | undefined) {
  return value ? value.getTime() : null;
}

function key(model: string, id: string) {
  return `${model}:${id}`;
}

type Mapping = { model: string; id: string };

class ImportReplayConflictError extends Error {
  constructor() {
    super("Concurrent import replay");
    this.name = "ImportReplayConflictError";
  }
}

type ChoreSubject = string | null;

/**
 * Resolve the same account/profile subject used by the canonical Chore Champs
 * importer. A missing reconciliation remains a legacy account-only row;
 * archived profiles are retained only for historical source rows.
 */
async function choreSubjectForImport(
  db: D1Store,
  familyId: string,
  userId: string,
  historical: boolean,
): Promise<ChoreSubject> {
  const [legacy, links] = await Promise.all([
    db
      .prepare(
        `SELECT member_id,family_id FROM "HouseholdMemberLegacyMapping" WHERE user_id=?1`,
      )
      .bind(userId)
      .all<{ member_id: string; family_id: string }>(),
    db
      .prepare(
        `SELECT member_id,family_id FROM "HouseholdMemberAccountLink" WHERE user_id=?1`,
      )
      .bind(userId)
      .all<{ member_id: string; family_id: string }>(),
  ]);
  const references = [...legacy.results, ...links.results];
  if (references.some((reference) => reference.family_id !== familyId))
    throw new HouseholdMemberIdentityConflict();
  const memberIds = [
    ...new Set(references.map((reference) => reference.member_id)),
  ];
  if (memberIds.length > 1) throw new HouseholdMemberIdentityConflict();
  const memberId = memberIds[0];
  if (!memberId) return null;

  const member = await db
    .prepare(
      `SELECT id,archived_at,erasure_user_id FROM "HouseholdMember" WHERE id=?1 AND family_id=?2`,
    )
    .bind(memberId, familyId)
    .first<{
      id: string;
      archived_at: number | null;
      erasure_user_id: string | null;
    }>();
  if (!member || member.erasure_user_id)
    throw new HouseholdMemberIdentityConflict();

  const other = await db
    .prepare(
      `SELECT 1 AS present FROM (
      SELECT user_id FROM "HouseholdMemberLegacyMapping" WHERE member_id=?1 AND family_id=?2 AND user_id<>?3
      UNION ALL
      SELECT user_id FROM "HouseholdMemberAccountLink" WHERE member_id=?1 AND family_id=?2 AND user_id<>?3
    ) LIMIT 1`,
    )
    .bind(memberId, familyId, userId)
    .first<{ present: number }>();
  if (other) throw new HouseholdMemberIdentityConflict();
  return member.archived_at && !historical ? null : member.id;
}

async function familyOwnedRows(
  db: D1Store,
  table:
    | "Recipe"
    | "Ingredient"
    | "List"
    | "BudgetCategory"
    | "Chore"
    | "Habit"
    | "Reward"
    | "BadgeDefinition",
  familyId: string,
  ids: readonly string[],
  select = "id",
) {
  const found = new Map<string, { id: string; title?: string }>();
  for (let offset = 0; offset < ids.length; offset += 96) {
    const chunk = [...new Set(ids.slice(offset, offset + 96))];
    if (!chunk.length) continue;
    const placeholders = chunk.map((_, index) => `?${index + 2}`).join(",");
    const rows = await db
      .prepare(
        `SELECT ${select} FROM "${table}" WHERE family_id=?1 AND id IN (${placeholders})`,
      )
      .bind(familyId, ...chunk)
      .all<{ id: string; title?: string }>();
    for (const row of rows.results) found.set(row.id, row);
  }
  return found;
}

async function mappingsFor(db: D1Store, familyId: string, sourceApp: string) {
  const rows = await db
    .prepare(
      `SELECT source_model,source_id,target_model,target_id
         FROM "ImportedRecord" WHERE family_id=?1 AND source_app=?2`,
    )
    .bind(familyId, sourceApp)
    .all<{
      source_model: string;
      source_id: string;
      target_model: string;
      target_id: string;
    }>();
  return new Map(
    rows.results.map((row) => [
      key(row.source_model, row.source_id),
      { model: row.target_model, id: row.target_id },
    ]),
  );
}

async function hasPendingMappings(
  db: D1Store,
  familyId: string,
  sourceApp: string,
  pending: readonly string[],
) {
  const mappings = await mappingsFor(db, familyId, sourceApp);
  return pending.some((sourceKey) => mappings.has(sourceKey));
}

async function assertAuthority(
  db: D1Store,
  options: Pick<
    D1FamilyImportOptions,
    "familyId" | "startedBy" | "identityMap" | "sessionVersion"
  >,
) {
  const actor = await db
    .prepare(`SELECT family_id,role,token_version FROM "User" WHERE id=?1`)
    .bind(options.startedBy)
    .first<{ family_id: string | null; role: string; token_version: number }>();
  const family = await db
    .prepare(`SELECT id FROM "Family" WHERE id=?1`)
    .bind(options.familyId)
    .first<{ id: string }>();
  if (
    !actor ||
    !family ||
    actor.family_id !== options.familyId ||
    actor.role !== "parent"
  )
    throw new HouseholdMemberIdentityConflict();
  if (actor.token_version !== options.sessionVersion)
    throw new ImportSessionChangedError();
  const mapped = [...new Set(Object.values(options.identityMap ?? {}))];
  if (mapped.length) {
    const users = await db
      .prepare(
        `SELECT id FROM "User" WHERE family_id=?1 AND id IN (${mapped.map((_, i) => `?${i + 2}`).join(",")})`,
      )
      .bind(options.familyId, ...mapped)
      .all<{ id: string }>();
    if (users.results.length !== mapped.length)
      throw new HouseholdMemberIdentityConflict();
  }
}

function authorityChecks(
  db: D1Store,
  options: Pick<
    D1FamilyImportOptions,
    "familyId" | "startedBy" | "identityMap" | "sessionVersion"
  >,
) {
  const checks: D1Statement[] = [
    d1WriteCheck(db, `EXISTS (SELECT 1 FROM "Family" WHERE id=?1)`, [
      options.familyId,
    ]),
    d1WriteCheck(
      db,
      `EXISTS (SELECT 1 FROM "User" WHERE id=?1 AND family_id=?2 AND role='parent' AND token_version=?3)`,
      [options.startedBy, options.familyId, options.sessionVersion],
    ),
  ];
  for (const userId of new Set(Object.values(options.identityMap ?? {})))
    checks.push(
      d1WriteCheck(
        db,
        `EXISTS (SELECT 1 FROM "User" WHERE id=?1 AND family_id=?2)`,
        [userId, options.familyId],
      ),
    );
  return checks;
}

async function startJob(
  db: D1Store,
  options: D1FamilyImportOptions,
  sourceApp: string,
  sourceVersion: string,
) {
  const id = randomUUID();
  const now = Date.now();
  try {
    await db.batch([
      ...authorityChecks(db, options),
      db
        .prepare(
          `INSERT INTO "ImportJob" (id,family_id,source_app,source_version,status,dry_run,started_by,started_at)
        VALUES (?1,?2,?3,?4,'running',0,?5,?6)`,
        )
        .bind(
          id,
          options.familyId,
          sourceApp,
          sourceVersion,
          options.startedBy,
          now,
        ),
    ]);
  } catch (error) {
    if (isD1WriteConflict(error)) {
      try {
        await assertAuthority(db, options);
      } catch (authorityError) {
        throw authorityError;
      }
      throw new HouseholdMemberIdentityConflict();
    }
    throw error;
  }
  return id;
}

async function failJob(db: D1Store, familyId: string, id: string) {
  await db
    .prepare(
      `UPDATE "ImportJob" SET status='failed',completed_at=?3,error=?4 WHERE id=?1 AND family_id=?2 AND status='running'`,
    )
    .bind(
      id,
      familyId,
      Date.now(),
      "Import failed or outcome unconfirmed; inspect canonical records.",
    )
    .run()
    .catch(() => undefined);
}

async function finishJob(
  db: D1Store,
  options: D1FamilyImportOptions,
  jobId: string,
  summary: unknown,
  statements: D1Statement[],
  sourceApp: string,
  pendingSourceKeys: readonly string[],
) {
  try {
    await db.batch([
      ...authorityChecks(db, options),
      ...statements,
      db
        .prepare(
          `UPDATE "ImportJob" SET status='completed',completed_at=?3,summary=?4 WHERE id=?1 AND family_id=?2 AND status='running'`,
        )
        .bind(jobId, options.familyId, Date.now(), json(summary)),
    ]);
  } catch (error) {
    await failJob(db, options.familyId, jobId);
    // A concurrent import can win the source-key unique index after this
    // invocation read its mappings. Let the outer operation re-read and
    // replay as the canonical importer does, rather than returning a false
    // permanent identity conflict.
    if (
      pendingSourceKeys.length &&
      (await hasPendingMappings(
        db,
        options.familyId,
        sourceApp,
        pendingSourceKeys,
      ))
    ) {
      try {
        await assertAuthority(db, options);
      } catch (authorityError) {
        throw authorityError;
      }
      throw new ImportReplayConflictError();
    }
    if (isD1WriteConflict(error)) {
      // A write precondition can fail because the session changed, a mapped
      // identity left the household, or a concurrent import won a unique
      // source key. Re-read the authority so the HTTP boundary preserves the
      // established 401 versus 409 distinction.
      try {
        await assertAuthority(db, options);
      } catch (authorityError) {
        throw authorityError;
      }
      throw new HouseholdMemberIdentityConflict();
    }
    throw error;
  }
}

function track(
  mappings: Map<string, Mapping>,
  familyId: string,
  jobId: string,
  sourceApp: string,
  sourceModel: string,
  sourceId: string,
  targetModel: string,
  targetId: string,
) {
  // ImportedRecord is intentionally written in the same D1 batch as its row.
  // The caller appends the returned statement so the table remains source-owned.
  mappings.set(key(sourceModel, sourceId), {
    model: targetModel,
    id: targetId,
  });
  return {
    statement: (db: D1Store) =>
      db
        .prepare(
          `INSERT INTO "ImportedRecord" (id,family_id,import_job_id,source_app,source_model,source_id,target_model,target_id,created_at)
      VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9)`,
        )
        .bind(
          randomUUID(),
          familyId,
          jobId,
          sourceApp,
          sourceModel,
          sourceId,
          targetModel,
          targetId,
          Date.now(),
        ),
  };
}

type BudgetSummary = BaseSummary;

async function applyBudget(
  db: D1Store,
  options: D1FamilyImportOptions,
  plan: BudgetAppImportPlan,
) {
  const sourceApp = "budget-app";
  const summary: BudgetSummary = {
    created: {},
    reused: {},
    skipped: [...plan.skippedRecords],
  };
  const mappings = await mappingsFor(db, options.familyId, sourceApp);
  const jobId = await startJob(db, options, sourceApp, plan.sourceVersion);
  const statements: D1Statement[] = [];
  const records: Array<(store: D1Store) => D1Statement> = [];
  const pendingSourceKeys: string[] = [];
  const categoryIds = new Set<string>();
  const existing = (model: string, id: string) => mappings.get(key(model, id));
  const addRecord = (
    model: string,
    id: string,
    target: string,
    targetId: string,
  ) => {
    const entry = track(
      mappings,
      options.familyId,
      jobId,
      sourceApp,
      model,
      id,
      target,
      targetId,
    );
    records.push(entry.statement);
    pendingSourceKeys.push(key(model, id));
  };
  for (const source of plan.categories) {
    if (existing("Category", source.sourceId)) {
      increment(summary.reused, "BudgetCategory");
      continue;
    }
    const id = randomUUID();
    statements.push(
      db
        .prepare(
          `INSERT INTO "BudgetCategory" (id,family_id,name,icon,color,type,created_by,created_at,import_metadata) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9)`,
        )
        .bind(
          id,
          options.familyId,
          source.name,
          source.icon,
          source.color,
          source.type,
          source.createdBy,
          source.createdAt.getTime(),
          json(source.metadata),
        ),
    );
    categoryIds.add(id);
    addRecord("Category", source.sourceId, "BudgetCategory", id);
    increment(summary.created, "BudgetCategory");
  }
  const mappedCategoryIds = [
    ...new Set(
      plan.transactions
        .map((item) => item.sourceCategoryId)
        .filter((id): id is string => Boolean(id))
        .map((sourceId) => {
          const mapping = existing("Category", sourceId);
          return mapping?.model === "BudgetCategory" ? mapping.id : null;
        })
        .filter((id): id is string => Boolean(id)),
    ),
  ];
  const liveCategories = await familyOwnedRows(
    db,
    "BudgetCategory",
    options.familyId,
    mappedCategoryIds,
  );
  const categoryForSource = (sourceId: string | null) => {
    if (!sourceId) return null;
    const mapping = existing("Category", sourceId);
    if (!mapping || mapping.model !== "BudgetCategory") return null;
    return categoryIds.has(mapping.id) || liveCategories.has(mapping.id)
      ? mapping.id
      : null;
  };
  for (const source of plan.transactions) {
    if (existing("Transaction", source.sourceId)) {
      increment(summary.reused, "Transaction");
      continue;
    }
    const id = randomUUID();
    const categoryId = categoryForSource(source.sourceCategoryId);
    statements.push(
      db
        .prepare(
          `INSERT INTO "Transaction" (id,family_id,user_id,amount,type,category_id,description,date,is_recurring,created_at,updated_at,import_metadata) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?10,?11)`,
        )
        .bind(
          id,
          options.familyId,
          source.userId,
          source.amount,
          source.type,
          categoryId,
          source.description,
          source.date.getTime(),
          source.isRecurring ? 1 : 0,
          source.createdAt.getTime(),
          json(source.metadata),
        ),
    );
    addRecord("Transaction", source.sourceId, "Transaction", id);
    increment(summary.created, "Transaction");
  }
  for (const source of plan.wishlistItems) {
    if (existing("WishlistItem", source.sourceId)) {
      increment(summary.reused, "WishlistItem");
      continue;
    }
    const id = randomUUID();
    statements.push(
      db
        .prepare(
          `INSERT INTO "WishlistItem" (id,family_id,requested_by,title,link,description,approx_price,status,created_at,updated_at) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?9)`,
        )
        .bind(
          id,
          options.familyId,
          source.requestedBy,
          source.title,
          source.link,
          source.description,
          source.approxPrice,
          source.status,
          source.createdAt.getTime(),
        ),
    );
    addRecord("WishlistItem", source.sourceId, "WishlistItem", id);
    increment(summary.created, "WishlistItem");
  }
  for (const source of plan.archive) {
    if (existing(source.sourceModel, source.sourceId)) {
      increment(summary.reused, "FinancialArchiveRecord");
      continue;
    }
    const id = randomUUID();
    statements.push(
      db
        .prepare(
          `INSERT INTO "FinancialArchiveRecord" (id,family_id,source_app,source_model,source_id,payload,created_at) VALUES (?1,?2,?3,?4,?5,?6,?7)`,
        )
        .bind(
          id,
          options.familyId,
          sourceApp,
          source.sourceModel,
          source.sourceId,
          json(source.payload),
          Date.now(),
        ),
    );
    addRecord(
      source.sourceModel,
      source.sourceId,
      "FinancialArchiveRecord",
      id,
    );
    increment(summary.created, "FinancialArchiveRecord");
  }
  statements.push(...records.map((make) => make(db)));
  await finishJob(
    db,
    options,
    jobId,
    summary,
    statements,
    sourceApp,
    pendingSourceKeys,
  );
  return { plan, summary, jobId };
}

type ChoreSummary = BaseSummary;

async function applyChores(
  db: D1Store,
  options: D1FamilyImportOptions,
  plan: ChoreChampsImportPlan,
) {
  const sourceApp = "chore-champs";
  const summary: ChoreSummary = {
    created: {},
    reused: {},
    skipped: [
      ...plan.skippedAssignments.map((item) => ({
        sourceModel: "ChoreAssignment",
        ...item,
      })),
      ...plan.skippedRecords,
    ],
  };
  const mappings = await mappingsFor(db, options.familyId, sourceApp);
  const jobId = await startJob(db, options, sourceApp, plan.sourceVersion);
  const statements: D1Statement[] = [];
  const records: Array<(store: D1Store) => D1Statement> = [];
  const pendingSourceKeys: string[] = [];
  const choreIds = new Set<string>();
  const habitIds = new Set<string>();
  const rewardIds = new Set<string>();
  const badgeIds = new Set<string>();
  const subjectCache = new Map<string, ChoreSubject>();
  const choreSubject = async (userId: string, historical: boolean) => {
    const cacheKey = `${userId}:${historical ? "historical" : "current"}`;
    if (!subjectCache.has(cacheKey))
      subjectCache.set(
        cacheKey,
        await choreSubjectForImport(db, options.familyId, userId, historical),
      );
    return subjectCache.get(cacheKey)!;
  };
  const existing = (model: string, id: string) => mappings.get(key(model, id));
  const addRecord = (
    model: string,
    id: string,
    target: string,
    targetId: string,
  ) => {
    const entry = track(
      mappings,
      options.familyId,
      jobId,
      sourceApp,
      model,
      id,
      target,
      targetId,
    );
    records.push(entry.statement);
    pendingSourceKeys.push(key(model, id));
  };
  for (const source of plan.chores) {
    if (existing("Chore", source.sourceId)) {
      increment(summary.reused, "Chore");
      continue;
    }
    const first = plan.assignments.find(
      (item) => item.sourceChoreId === source.sourceId,
    );
    if (!first) {
      summary.skipped.push({
        sourceModel: "Chore",
        sourceId: source.sourceId,
        reason: "No assignment with a mapped Family Planner user",
      });
      continue;
    }
    const id = randomUUID();
    const assignedMemberId = await choreSubject(
      first.targetUserId,
      !source.active,
    );
    statements.push(
      db
        .prepare(
          `INSERT INTO "Chore" (id,family_id,title,description,points,assigned_to,assigned_member_id,due_date,status,frequency,difficulty,created_by,created_at) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13)`,
        )
        .bind(
          id,
          options.familyId,
          source.title,
          source.description,
          source.points,
          first.targetUserId,
          assignedMemberId,
          first.dueDate.getTime(),
          source.active ? "pending" : "archived",
          source.frequency,
          source.difficulty,
          options.startedBy,
          source.createdAt.getTime(),
        ),
    );
    choreIds.add(id);
    addRecord("Chore", source.sourceId, "Chore", id);
    increment(summary.created, "Chore");
  }
  const mappedChoreIds = [
    ...new Set(
      plan.assignments
        .map((item) => item.sourceChoreId)
        .map((sourceId) => {
          const mapping = existing("Chore", sourceId);
          return mapping?.model === "Chore" ? mapping.id : null;
        })
        .filter((id): id is string => Boolean(id)),
    ),
  ];
  const liveChores = await familyOwnedRows(
    db,
    "Chore",
    options.familyId,
    mappedChoreIds,
  );
  const choreForSource = (sourceId: string) => {
    const mapping = existing("Chore", sourceId);
    if (!mapping || mapping.model !== "Chore") return null;
    return choreIds.has(mapping.id) || liveChores.has(mapping.id)
      ? mapping.id
      : null;
  };
  for (const source of plan.assignments) {
    if (existing("ChoreAssignment", source.sourceId)) {
      increment(summary.reused, "ChoreAssignment");
      continue;
    }
    const choreId = choreForSource(source.sourceChoreId);
    if (!choreId) {
      summary.skipped.push({
        sourceModel: "ChoreAssignment",
        sourceId: source.sourceId,
        reason: `No imported chore ${source.sourceChoreId}`,
      });
      continue;
    }
    const id = randomUUID();
    const assignedMemberId = await choreSubject(
      source.targetUserId,
      ["completed", "verified", "approved", "archived"].includes(source.status),
    );
    statements.push(
      db
        .prepare(
          `INSERT INTO "ChoreAssignment" (id,family_id,chore_id,assigned_to,assigned_member_id,due_date,status,completed_at,completed_by,idempotency_key,created_at,updated_at) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?11)`,
        )
        .bind(
          id,
          options.familyId,
          choreId,
          source.targetUserId,
          assignedMemberId,
          source.dueDate.getTime(),
          source.status,
          millis(source.completedAt),
          source.completedAt ? source.targetUserId : null,
          source.idempotencyKey,
          source.createdAt.getTime(),
        ),
    );
    addRecord("ChoreAssignment", source.sourceId, "ChoreAssignment", id);
    increment(summary.created, "ChoreAssignment");
  }
  for (const source of plan.habits) {
    if (existing("Habit", source.sourceId)) {
      increment(summary.reused, "Habit");
      continue;
    }
    const id = randomUUID();
    statements.push(
      db
        .prepare(
          `INSERT INTO "Habit" (id,family_id,title,description,icon,points,is_active,created_by,created_at,updated_at) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?9)`,
        )
        .bind(
          id,
          options.familyId,
          source.title,
          source.description,
          source.icon,
          source.points,
          source.active ? 1 : 0,
          options.startedBy,
          source.createdAt.getTime(),
        ),
    );
    habitIds.add(id);
    addRecord("Habit", source.sourceId, "Habit", id);
    increment(summary.created, "Habit");
  }
  const mappedHabitIds = [
    ...new Set(
      plan.habitLogs
        .map((item) => item.sourceHabitId)
        .map((sourceId) => {
          const mapping = existing("Habit", sourceId);
          return mapping?.model === "Habit" ? mapping.id : null;
        })
        .filter((id): id is string => Boolean(id)),
    ),
  ];
  const liveHabits = await familyOwnedRows(
    db,
    "Habit",
    options.familyId,
    mappedHabitIds,
  );
  const habitForSource = (sourceId: string) => {
    const mapping = existing("Habit", sourceId);
    if (!mapping || mapping.model !== "Habit") return null;
    return habitIds.has(mapping.id) || liveHabits.has(mapping.id)
      ? mapping.id
      : null;
  };
  for (const source of plan.habitLogs) {
    if (existing("HabitLog", source.sourceId)) {
      increment(summary.reused, "HabitLog");
      continue;
    }
    const habitId = habitForSource(source.sourceHabitId);
    if (!habitId) {
      summary.skipped.push({
        sourceModel: "HabitLog",
        sourceId: source.sourceId,
        reason: `No imported habit ${source.sourceHabitId}`,
      });
      continue;
    }
    const id = randomUUID();
    statements.push(
      db
        .prepare(
          `INSERT INTO "HabitLog" (id,family_id,habit_id,user_id,logged_date,logged_at) VALUES (?1,?2,?3,?4,?5,?6)`,
        )
        .bind(
          id,
          options.familyId,
          habitId,
          source.targetUserId,
          source.loggedDate.getTime(),
          source.loggedAt.getTime(),
        ),
    );
    addRecord("HabitLog", source.sourceId, "HabitLog", id);
    increment(summary.created, "HabitLog");
  }
  for (const source of plan.rewards) {
    if (existing("Reward", source.sourceId)) {
      increment(summary.reused, "Reward");
      continue;
    }
    const id = randomUUID();
    statements.push(
      db
        .prepare(
          `INSERT INTO "Reward" (id,family_id,name,description,cost,icon,is_active,created_by,created_at) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9)`,
        )
        .bind(
          id,
          options.familyId,
          source.name,
          source.description,
          source.cost,
          source.icon ?? "gift",
          source.active ? 1 : 0,
          options.startedBy,
          source.createdAt.getTime(),
        ),
    );
    rewardIds.add(id);
    addRecord("Reward", source.sourceId, "Reward", id);
    increment(summary.created, "Reward");
  }
  const mappedRewardIds = [
    ...new Set(
      plan.redemptions
        .map((item) => item.sourceRewardId)
        .map((sourceId) => {
          const mapping = existing("Reward", sourceId);
          return mapping?.model === "Reward" ? mapping.id : null;
        })
        .filter((id): id is string => Boolean(id)),
    ),
  ];
  const liveRewards = await familyOwnedRows(
    db,
    "Reward",
    options.familyId,
    mappedRewardIds,
  );
  const rewardForSource = (sourceId: string) => {
    const mapping = existing("Reward", sourceId);
    if (!mapping || mapping.model !== "Reward") return null;
    return rewardIds.has(mapping.id) || liveRewards.has(mapping.id)
      ? mapping.id
      : null;
  };
  for (const source of plan.redemptions) {
    if (existing("Redemption", source.sourceId)) {
      increment(summary.reused, "RewardRedemption");
      continue;
    }
    const rewardId = rewardForSource(source.sourceRewardId);
    if (!rewardId) {
      summary.skipped.push({
        sourceModel: "Redemption",
        sourceId: source.sourceId,
        reason: `No imported reward ${source.sourceRewardId}`,
      });
      continue;
    }
    const id = randomUUID();
    statements.push(
      db
        .prepare(
          `INSERT INTO "RewardRedemption" (id,family_id,reward_id,requested_by,points,status,requested_at,fulfilled_at) VALUES (?1,?2,?3,?4,?5,'fulfilled',?6,?6)`,
        )
        .bind(
          id,
          options.familyId,
          rewardId,
          source.targetUserId,
          source.points,
          source.requestedAt.getTime(),
        ),
    );
    addRecord("Redemption", source.sourceId, "RewardRedemption", id);
    increment(summary.created, "RewardRedemption");
  }
  for (const source of plan.familyGoals) {
    if (existing("FamilyGoal", source.sourceId)) {
      increment(summary.reused, "FamilyGoal");
      continue;
    }
    const id = randomUUID();
    statements.push(
      db
        .prepare(
          `INSERT INTO "FamilyGoal" (id,family_id,title,description,target_points,current_points,reward,is_active,created_by,created_at,updated_at) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?10)`,
        )
        .bind(
          id,
          options.familyId,
          source.title,
          source.description,
          source.targetPoints,
          source.currentPoints,
          source.reward,
          source.active ? 1 : 0,
          options.startedBy,
          source.createdAt.getTime(),
        ),
    );
    addRecord("FamilyGoal", source.sourceId, "FamilyGoal", id);
    increment(summary.created, "FamilyGoal");
  }
  for (const source of plan.badges) {
    if (existing("BadgeDefinition", source.sourceId)) {
      increment(summary.reused, "BadgeDefinition");
      continue;
    }
    const id = randomUUID();
    statements.push(
      db
        .prepare(
          `INSERT INTO "BadgeDefinition" (id,family_id,name,description,icon,requirement,created_at) VALUES (?1,?2,?3,?4,?5,?6,?7)`,
        )
        .bind(
          id,
          options.familyId,
          source.name,
          source.description,
          source.icon,
          json(source.requirement),
          source.createdAt.getTime(),
        ),
    );
    badgeIds.add(id);
    addRecord("BadgeDefinition", source.sourceId, "BadgeDefinition", id);
    increment(summary.created, "BadgeDefinition");
  }
  const mappedBadgeIds = [
    ...new Set(
      plan.earnedBadges
        .map((item) => item.sourceBadgeId)
        .map((sourceId) => {
          const mapping = existing("BadgeDefinition", sourceId);
          return mapping?.model === "BadgeDefinition" ? mapping.id : null;
        })
        .filter((id): id is string => Boolean(id)),
    ),
  ];
  const liveBadges = await familyOwnedRows(
    db,
    "BadgeDefinition",
    options.familyId,
    mappedBadgeIds,
  );
  const badgeForSource = (sourceId: string) => {
    const mapping = existing("BadgeDefinition", sourceId);
    if (!mapping || mapping.model !== "BadgeDefinition") return null;
    return badgeIds.has(mapping.id) || liveBadges.has(mapping.id)
      ? mapping.id
      : null;
  };
  for (const source of plan.earnedBadges) {
    if (existing("EarnedBadge", source.sourceId)) {
      increment(summary.reused, "EarnedBadge");
      continue;
    }
    const badgeId = badgeForSource(source.sourceBadgeId);
    if (!badgeId) {
      summary.skipped.push({
        sourceModel: "EarnedBadge",
        sourceId: source.sourceId,
        reason: `No imported badge ${source.sourceBadgeId}`,
      });
      continue;
    }
    const id = randomUUID();
    statements.push(
      db
        .prepare(
          `INSERT INTO "EarnedBadge" (id,family_id,badge_id,user_id,earned_at) VALUES (?1,?2,?3,?4,?5)`,
        )
        .bind(
          id,
          options.familyId,
          badgeId,
          source.targetUserId,
          source.earnedAt.getTime(),
        ),
    );
    addRecord("EarnedBadge", source.sourceId, "EarnedBadge", id);
    increment(summary.created, "EarnedBadge");
  }
  statements.push(...records.map((make) => make(db)));
  await finishJob(
    db,
    options,
    jobId,
    summary,
    statements,
    sourceApp,
    pendingSourceKeys,
  );
  return { plan, summary, jobId };
}

type MealSummary = BaseSummary & {
  archived: Counts;
  linked: Counts;
  nulled: Array<{
    sourceModel: string;
    sourceId: string;
    field: string;
    reason: string;
  }>;
  mealPlans: Array<{
    sourceId: string;
    name: string;
    startDate: string;
    endDate: string;
  }>;
};

async function applyMeals(
  db: D1Store,
  options: D1FamilyImportOptions,
  plan: MealPlannerImportPlan,
) {
  const sourceApp = "meal-planner";
  const summary: MealSummary = {
    created: {},
    reused: {},
    archived: {},
    linked: {},
    skipped: [...plan.skippedRecords],
    nulled: [],
    mealPlans: [],
  };
  const mappings = await mappingsFor(db, options.familyId, sourceApp);
  const jobId = await startJob(db, options, sourceApp, plan.sourceVersion);
  const statements: D1Statement[] = [];
  const records: Array<(store: D1Store) => D1Statement> = [];
  const pendingSourceKeys: string[] = [];
  const ingredientNames: Array<{ id: string; name: string }> = [];
  const recipeTitles = new Map<string, string>();
  const pendingMeals: Array<{
    id: string;
    date: number;
    mealType: string;
    recipeName: string;
  }> = [];
  const listIds = new Set<string>();
  const existing = (model: string, id: string) => mappings.get(key(model, id));
  const addRecord = (
    model: string,
    id: string,
    target: string,
    targetId: string,
  ) => {
    const entry = track(
      mappings,
      options.familyId,
      jobId,
      sourceApp,
      model,
      id,
      target,
      targetId,
    );
    records.push(entry.statement);
    pendingSourceKeys.push(key(model, id));
  };
  for (const source of plan.ingredients) {
    if (existing("Ingredient", source.sourceId)) {
      increment(summary.reused, "Ingredient");
      continue;
    }
    const found = await db
      .prepare(`SELECT id FROM "Ingredient" WHERE family_id=?1 AND name=?2`)
      .bind(options.familyId, source.name)
      .first<{ id: string }>();
    const id = found?.id ?? randomUUID();
    if (!found)
      statements.push(
        db
          .prepare(
            `INSERT INTO "Ingredient" (id,family_id,name,unit) VALUES (?1,?2,?3,?4)`,
          )
          .bind(id, options.familyId, source.name, source.unit),
      );
    ingredientNames.push({ id, name: source.name });
    addRecord("Ingredient", source.sourceId, "Ingredient", id);
    increment(summary.created, "Ingredient");
  }
  for (const source of plan.recipes) {
    if (existing("Recipe", source.sourceId)) {
      increment(summary.reused, "Recipe");
      continue;
    }
    const id = randomUUID();
    statements.push(
      db
        .prepare(
          `INSERT INTO "Recipe" (id,family_id,title,description,instructions,prep_time,cook_time,servings,image_url,created_by,created_at,updated_at) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?11)`,
        )
        .bind(
          id,
          options.familyId,
          source.title,
          source.description,
          source.instructions,
          source.prepTime,
          source.cookTime,
          source.servings,
          source.imageUrl,
          source.createdBy,
          source.createdAt.getTime(),
        ),
    );
    recipeTitles.set(id, source.title);
    addRecord("Recipe", source.sourceId, "Recipe", id);
    increment(summary.created, "Recipe");
  }
  const mappedRecipeIds = [
    ...new Set(
      [
        ...plan.recipeIngredients.map((item) => item.sourceRecipeId),
        ...plan.mealPlanEntries.map((item) => item.sourceRecipeId),
        ...plan.shoppingItems.map((item) => item.sourceRecipeId),
      ]
        .filter((sourceId): sourceId is string => Boolean(sourceId))
        .map((sourceId) => {
          const mapping = existing("Recipe", sourceId);
          return mapping?.model === "Recipe" ? mapping.id : null;
        })
        .filter((id): id is string => Boolean(id)),
    ),
  ];
  const liveRecipes = await familyOwnedRows(
    db,
    "Recipe",
    options.familyId,
    mappedRecipeIds,
    "id,title",
  );
  const recipeForSource = (sourceId: string | null) => {
    if (!sourceId) return null;
    const mapping = existing("Recipe", sourceId);
    if (!mapping || mapping.model !== "Recipe") return null;
    const title =
      recipeTitles.get(mapping.id) ?? liveRecipes.get(mapping.id)?.title;
    return title ? { id: mapping.id, title } : null;
  };
  const mappedIngredientIds = [
    ...new Set(
      plan.recipeIngredients
        .map((item) => item.sourceIngredientId)
        .map((sourceId) => {
          const mapping = existing("Ingredient", sourceId);
          return mapping?.model === "Ingredient" ? mapping.id : null;
        })
        .filter((id): id is string => Boolean(id)),
    ),
  ];
  const liveIngredients = await familyOwnedRows(
    db,
    "Ingredient",
    options.familyId,
    mappedIngredientIds,
  );
  const ingredientForSource = (sourceId: string) => {
    const mapping = existing("Ingredient", sourceId);
    if (!mapping || mapping.model !== "Ingredient") return null;
    return ingredientNames.some((ingredient) => ingredient.id === mapping.id) ||
      liveIngredients.has(mapping.id)
      ? mapping.id
      : null;
  };
  for (const source of plan.recipeIngredients) {
    if (existing("RecipeIngredient", source.sourceId)) {
      increment(summary.reused, "RecipeIngredient");
      continue;
    }
    const recipeId = recipeForSource(source.sourceRecipeId)?.id;
    const ingredientId = ingredientForSource(source.sourceIngredientId);
    if (!recipeId || !ingredientId) {
      summary.skipped.push({
        sourceModel: "RecipeIngredient",
        sourceId: source.sourceId,
        reason: "Recipe or ingredient was not imported",
      });
      continue;
    }
    const found = await db
      .prepare(
        `SELECT id FROM "RecipeIngredient" WHERE recipe_id=?1 AND ingredient_id=?2`,
      )
      .bind(recipeId, ingredientId)
      .first<{ id: string }>();
    const id = found?.id ?? randomUUID();
    if (!found)
      statements.push(
        db
          .prepare(
            `INSERT INTO "RecipeIngredient" (id,recipe_id,ingredient_id,amount,unit,note) VALUES (?1,?2,?3,?4,?5,?6)`,
          )
          .bind(
            id,
            recipeId,
            ingredientId,
            source.amount,
            source.unit,
            source.note,
          ),
      );
    addRecord("RecipeIngredient", source.sourceId, "RecipeIngredient", id);
    increment(summary.created, "RecipeIngredient");
  }
  for (const source of plan.mealPlans) {
    if (existing("MealPlan", source.sourceId)) {
      increment(summary.reused, "MealPlan");
      continue;
    }
    summary.mealPlans.push({
      sourceId: source.sourceId,
      name: source.name,
      startDate: source.startDate.toISOString(),
      endDate: source.endDate.toISOString(),
    });
    addRecord("MealPlan", source.sourceId, "ImportJob", jobId);
    increment(summary.archived, "MealPlan");
  }
  const planOwner = new Map(
    plan.mealPlans.map((item) => [item.sourceId, item.createdBy]),
  );
  for (const source of plan.mealPlanEntries) {
    if (existing("MealPlanEntry", source.sourceId)) {
      increment(summary.reused, "MealPlanEntry");
      continue;
    }
    const createdBy = planOwner.get(source.sourceMealPlanId);
    const recipe = recipeForSource(source.sourceRecipeId);
    if (!createdBy || !recipe) {
      summary.skipped.push({
        sourceModel: "MealPlanEntry",
        sourceId: source.sourceId,
        reason: "Meal plan or recipe was not imported",
      });
      continue;
    }
    const mealType = normalizeMealType(source.mealType);
    if (!mealType) {
      summary.skipped.push({
        sourceModel: "MealPlanEntry",
        sourceId: source.sourceId,
        reason: `Unsupported meal type "${source.mealType}"`,
      });
      continue;
    }
    const day = Date.UTC(
      source.date.getUTCFullYear(),
      source.date.getUTCMonth(),
      source.date.getUTCDate(),
    );
    const rows = await db
      .prepare(
        `SELECT id,recipe_name,recipe_id FROM "FamilyMeal" WHERE family_id=?1 AND date=?2 AND meal_type=?3 ORDER BY created_at ASC,id ASC`,
      )
      .bind(options.familyId, day, mealType)
      .all<{
        id: string;
        recipe_name: string | null;
        recipe_id: string | null;
      }>();
    const recipeRow = recipeTitles.get(recipe.id)
      ? { title: recipeTitles.get(recipe.id)! }
      : await db
          .prepare(`SELECT title FROM "Recipe" WHERE id=?1 AND family_id=?2`)
          .bind(recipe.id, options.familyId)
          .first<{ title: string }>();
    const same =
      rows.results.find((row) =>
        mealNamesMatch(row.recipe_name, recipeRow?.title),
      ) ??
      pendingMeals.find(
        (row) =>
          row.date === day &&
          row.mealType === mealType &&
          mealNamesMatch(row.recipeName, recipeRow?.title),
      );
    if (same) {
      if (!("recipe_id" in same) || !same.recipe_id)
        statements.push(
          db
            .prepare(
              `UPDATE "FamilyMeal" SET recipe_id=?1,updated_at=?2 WHERE id=?3 AND family_id=?4`,
            )
            .bind(recipe.id, Date.now(), same.id, options.familyId),
        );
      addRecord("MealPlanEntry", source.sourceId, "FamilyMeal", same.id);
      increment(summary.linked, "FamilyMeal");
      continue;
    }
    const id = randomUUID();
    statements.push(
      db
        .prepare(
          `INSERT INTO "FamilyMeal" (id,family_id,date,meal_type,recipe_name,created_by,created_at,recipe_id,servings,updated_at) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?7)`,
        )
        .bind(
          id,
          options.familyId,
          day,
          mealType,
          recipeRow?.title ?? null,
          createdBy,
          Date.now(),
          recipe.id,
          source.servings,
        ),
    );
    pendingMeals.push({
      id,
      date: day,
      mealType,
      recipeName: recipeRow?.title ?? "",
    });
    addRecord("MealPlanEntry", source.sourceId, "FamilyMeal", id);
    increment(summary.created, "FamilyMeal");
  }
  for (const source of plan.shoppingLists) {
    if (existing("ShoppingList", source.sourceId)) {
      increment(summary.reused, "ShoppingList");
      continue;
    }
    const id = randomUUID();
    statements.push(
      db
        .prepare(
          `INSERT INTO "List" (id,family_id,name,type,description,created_by,created_at,updated_at) VALUES (?1,?2,?3,'grocery',?4,?5,?6,?6)`,
        )
        .bind(
          id,
          options.familyId,
          source.name,
          IMPORTED_LIST_DESCRIPTION,
          source.createdBy,
          source.createdAt.getTime(),
        ),
    );
    listIds.add(id);
    addRecord("ShoppingList", source.sourceId, "List", id);
    increment(summary.created, "List");
  }
  const mappedListIds = [
    ...new Set(
      plan.shoppingItems
        .map((item) => item.sourceShoppingListId)
        .map((sourceId) => {
          const mapping = existing("ShoppingList", sourceId);
          return mapping?.model === "List" ? mapping.id : null;
        })
        .filter((id): id is string => Boolean(id)),
    ),
  ];
  const liveLists = await familyOwnedRows(
    db,
    "List",
    options.familyId,
    mappedListIds,
  );
  const listForSource = (sourceId: string) => {
    const mapping = existing("ShoppingList", sourceId);
    if (!mapping || mapping.model !== "List") return null;
    return listIds.has(mapping.id) || liveLists.has(mapping.id)
      ? mapping
      : null;
  };
  const familyIngredients = plan.shoppingItems.length
    ? [
        ...(
          await db
            .prepare(`SELECT id,name FROM "Ingredient" WHERE family_id=?1`)
            .bind(options.familyId)
            .all<{ id: string; name: string }>()
        ).results,
        ...ingredientNames,
      ]
    : [];
  const nextPosition = new Map<string, number>();
  for (const source of plan.shoppingItems) {
    if (existing("ShoppingItem", source.sourceId)) {
      increment(summary.reused, "ShoppingItem");
      continue;
    }
    const list = listForSource(source.sourceShoppingListId);
    if (!list) {
      summary.skipped.push({
        sourceModel: "ShoppingItem",
        sourceId: source.sourceId,
        reason: "Shopping list was not imported",
      });
      continue;
    }
    if (list.model !== "List") {
      summary.skipped.push({
        sourceModel: "ShoppingItem",
        sourceId: source.sourceId,
        reason: "Shopping list is archived or no longer exists",
      });
      continue;
    }
    const content = cleanContent(source.ingredientName);
    if (!content) {
      summary.skipped.push({
        sourceModel: "ShoppingItem",
        sourceId: source.sourceId,
        reason: "Empty ingredient name",
      });
      continue;
    }
    const recipeId = recipeForSource(source.sourceRecipeId)?.id ?? null;
    if (source.sourceRecipeId && !recipeId)
      summary.nulled.push({
        sourceModel: "ShoppingItem",
        sourceId: source.sourceId,
        field: "recipe_id",
        reason: "Recipe was not imported into this household",
      });
    let position = nextPosition.get(list.id);
    if (position === undefined) {
      const row = await db
        .prepare(
          `SELECT COALESCE(MAX(position),0) AS position FROM "ListItem" WHERE list_id=?1`,
        )
        .bind(list.id)
        .first<{ position: number }>();
      position = Number(row?.position ?? 0) + 1;
    }
    nextPosition.set(list.id, position + 1);
    const id = randomUUID();
    statements.push(
      db
        .prepare(
          `INSERT INTO "ListItem" (id,list_id,content,checked,quantity,category,added_by,position,created_at,updated_at,ingredient_id,recipe_id,amount,unit,source) VALUES (?1,?2,?3,?4,1,?5,?6,?7,?8,?8,?9,?10,?11,?12,'import')`,
        )
        .bind(
          id,
          list.id,
          content,
          source.checked ? 1 : 0,
          source.category,
          plan.shoppingLists.find(
            (item) => item.sourceId === source.sourceShoppingListId,
          )?.createdBy ?? options.startedBy,
          position,
          Date.now(),
          matchIngredient(content, familyIngredients),
          recipeId,
          source.amount,
          source.unit,
        ),
    );
    addRecord("ShoppingItem", source.sourceId, "ListItem", id);
    increment(summary.created, "ListItem");
  }
  statements.push(...records.map((make) => make(db)));
  await finishJob(
    db,
    options,
    jobId,
    summary,
    statements,
    sourceApp,
    pendingSourceKeys,
  );
  return { plan, summary, jobId };
}

export async function runD1FamilyImport(options: D1FamilyImportOptions) {
  const identityMap = options.identityMap ?? {};
  let plan: BudgetAppImportPlan | ChoreChampsImportPlan | MealPlannerImportPlan;
  if (options.source === "budget-app")
    plan = planBudgetAppImport(options.data, options.startedBy);
  else if (options.source === "chore-champs")
    plan = planChoreChampsImport(options.data, identityMap);
  else plan = planMealPlannerImport(options.data, identityMap);
  if (options.dryRun !== false) {
    const summary =
      options.source === "meal-planner"
        ? {
            created: {},
            reused: {},
            archived: {},
            linked: {},
            skipped: (plan as MealPlannerImportPlan).skippedRecords,
            nulled: [],
            mealPlans: [],
          }
        : {
            created: {},
            reused: {},
            skipped:
              options.source === "chore-champs"
                ? [
                    ...(plan as ChoreChampsImportPlan).skippedAssignments.map(
                      (item) => ({ sourceModel: "ChoreAssignment", ...item }),
                    ),
                    ...(plan as ChoreChampsImportPlan).skippedRecords,
                  ]
                : (plan as BudgetAppImportPlan).skippedRecords,
          };
    return { plan, summary, jobId: null };
  }
  const db = options.database ?? (await getD1Database());
  await assertAuthority(db, {
    familyId: options.familyId,
    startedBy: options.startedBy,
    identityMap,
    sessionVersion: options.sessionVersion,
  });
  // D1 has no interactive transaction spanning the mapping read and final
  // batch. If another writer wins ImportedRecord_source_key in that window,
  // replay the same plan against its committed mappings. This preserves the
  // canonical importer's concurrent idempotency without inventing a lock.
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      if (options.source === "budget-app")
        return await applyBudget(db, options, plan as BudgetAppImportPlan);
      if (options.source === "chore-champs")
        return await applyChores(db, options, plan as ChoreChampsImportPlan);
      return await applyMeals(db, options, plan as MealPlannerImportPlan);
    } catch (error) {
      if (!(error instanceof ImportReplayConflictError)) throw error;
      if (attempt === 2) throw new HouseholdMemberIdentityConflict();
    }
  }
  throw new HouseholdMemberIdentityConflict();
}
