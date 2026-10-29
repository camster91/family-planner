/** Native D1 budget reads and effects.
 *
 * Budget data is private household finance data. Every read re-checks the
 * current parent session and effective feature flag; every write repeats that
 * authority at the D1 batch boundary. Transaction mutations use the native
 * person receipt coordinator so retries never duplicate money rows.
 */
import { randomUUID } from "node:crypto";
import type { EffectResult } from "@/lib/idempotency";
import type { AssistantProofActor } from "@/lib/assistant-source-proof";
import { isFeatureEnabled, normalizeFeatures } from "@/lib/features";
import { RECENT_TRANSACTIONS_LIMIT, sumBudgetLimits } from "@/lib/budget";
import { executeD1PersonEffect, type NativePersonResult } from "./person-effect";
import { getD1Database, type D1Store, type SqlValue } from "./database";
import { withD1ReadClient, type D1ReadClient } from "./read-client";
import { d1WriteCheck, isD1WriteConflict } from "./write-check";

export type D1BudgetActor = AssistantProofActor;
type NativeResult = EffectResult & { replayed?: boolean };
type TransactionFilters = { type: string | null; categoryId: string | null; start: Date | null; end: Date | null; limit: number; offset: number };

const failure = (status: number, error: string): EffectResult => ({ status, body: { error } });
const forbidden = (): EffectResult => failure(403, "Forbidden");
const parentOnly = (): EffectResult => failure(403, "Only parents can perform this action");
const budgetOff = (): EffectResult => failure(403, "This feature is turned off for your family");

function jsonValue(value: unknown): unknown {
  if (typeof value !== "string") return value ?? null;
  try { return JSON.parse(value); } catch { return null; }
}

function dateValue(value: unknown): Date | null {
  if (value == null) return null;
  if (value instanceof Date) return value;
  const date = new Date(typeof value === "number" ? value : String(value));
  return Number.isFinite(date.getTime()) ? date : null;
}

function epoch(value: unknown): number {
  const date = dateValue(value);
  if (!date) throw new Error("Invalid budget timestamp");
  return date.getTime();
}

function actorFeature(value: unknown) {
  return normalizeFeatures(typeof value === "string" ? (() => {
    try { return JSON.parse(value); } catch { return {}; }
  })() : value);
}

async function authority(db: D1ReadClient, actor: D1BudgetActor, requireParentRole = true): Promise<EffectResult | null> {
  const [user, family] = await Promise.all([
    db.user.findUnique({ where: { id: actor.userId }, select: { family_id: true, role: true, token_version: true } }),
    db.family.findUnique({ where: { id: actor.familyId }, select: { features: true } }),
  ]);
  if (!user || user.family_id !== actor.familyId || user.role !== actor.role || user.token_version !== actor.generation)
    return failure(401, "Unauthorized");
  if (requireParentRole && user.role !== "parent") return parentOnly();
  if (!family || !isFeatureEnabled(actorFeature(family.features), "budget")) return budgetOff();
  return null;
}

function categoryDto(row: any, transactionCount = 0, creator?: any) {
  return {
    id: row.id,
    family_id: row.family_id,
    name: row.name,
    icon: row.icon,
    color: row.color,
    type: row.type,
    budget_limit: row.budget_limit == null ? null : Number(row.budget_limit),
    created_by: row.created_by,
    created_at: dateValue(row.created_at),
    import_metadata: jsonValue(row.import_metadata),
    _count: { transactions: Number(transactionCount) },
    ...(creator === undefined ? {} : { creator: creator ? { id: creator.id, name: creator.name } : null }),
  };
}

function transactionDto(row: any, category?: any, user?: any) {
  return {
    id: row.id,
    family_id: row.family_id,
    user_id: row.user_id,
    amount: Number(row.amount),
    type: row.type,
    category_id: row.category_id ?? null,
    description: row.description ?? null,
    notes: row.notes ?? null,
    date: dateValue(row.date),
    is_recurring: Number(row.is_recurring) === 1 || row.is_recurring === true,
    recurring_interval: row.recurring_interval ?? null,
    list_item_id: row.list_item_id ?? null,
    created_at: dateValue(row.created_at),
    updated_at: dateValue(row.updated_at),
    import_metadata: jsonValue(row.import_metadata),
    ...(category === undefined ? {} : { category: category ? { id: category.id, name: category.name, icon: category.icon, color: category.color } : null }),
    ...(user === undefined ? {} : { user: user ? { id: user.id, name: user.name, avatar_url: user.avatar_url ?? null } : null }),
  };
}

async function categoryFor(db: D1ReadClient, familyId: string, id: string | null | undefined) {
  if (!id) return { category: null, error: null as EffectResult | null };
  const category = await db.budgetCategory.findFirst({ where: { id, family_id: familyId }, select: { id: true, family_id: true, name: true, icon: true, color: true, type: true } });
  if (!category) return { category: null, error: failure(404, "Category not found") };
  return { category, error: null as EffectResult | null };
}

async function transactionFor(db: D1ReadClient, actor: D1BudgetActor, id: string) {
  return db.transaction.findFirst({
    where: { id, family_id: actor.familyId },
    include: {
      category: { select: { id: true, name: true, icon: true, color: true } },
      user: { select: { id: true, name: true, avatar_url: true } },
    },
  });
}

function transactionInsertValues(input: any, actor: D1BudgetActor, id: string, now: Date) {
  const recurring = input.is_recurring === true;
  return {
    id,
    familyId: actor.familyId,
    userId: actor.userId,
    amount: input.amount,
    type: input.type,
    categoryId: input.category_id || null,
    description: input.description || null,
    notes: input.notes || null,
    date: input.date ? new Date(input.date) : now,
    isRecurring: recurring,
    recurringInterval: recurring ? input.recurring_interval || null : null,
    now,
  };
}

export function createD1BudgetTransaction(actor: D1BudgetActor, input: any, key: string | null, database?: D1Store): Promise<NativePersonResult> {
  return executeD1PersonEffect({
    actor, action: "budget.transaction.create", input, key, database,
    authorize: (db) => authority(db, actor),
    plan: async (db) => {
      const checked = await categoryFor(db, actor.familyId, input.category_id);
      if (checked.error) return checked.error;
      const user = await db.user.findUnique({ where: { id: actor.userId }, select: { id: true, name: true, avatar_url: true } });
      if (!user) return failure(401, "Unauthorized");
      const now = new Date(), id = randomUUID(), values = transactionInsertValues(input, actor, id, now);
      // Keep the projected response in the same snake_case shape as rows
      // returned by D1. `transactionInsertValues` deliberately uses camelCase
      // for the write binding, so spreading it here would silently omit
      // family_id/user_id/category_id from the public response.
      const row = {
        id: values.id,
        family_id: values.familyId,
        user_id: values.userId,
        amount: values.amount,
        type: values.type,
        category_id: values.categoryId,
        description: values.description,
        notes: values.notes,
        date: values.date,
        is_recurring: values.isRecurring,
        recurring_interval: values.recurringInterval,
        list_item_id: null,
        created_at: now,
        updated_at: now,
        import_metadata: null,
      };
      return {
        status: 201,
        body: { transaction: transactionDto(row, checked.category, user) },
        effects: (session) => [session.prepare(`INSERT INTO "Transaction" (id,family_id,user_id,amount,type,category_id,description,notes,date,is_recurring,recurring_interval,created_at,updated_at) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?12)`).bind(values.id, values.familyId, values.userId, values.amount, values.type, values.categoryId, values.description, values.notes, values.date.getTime(), values.isRecurring ? 1 : 0, values.recurringInterval, now.getTime())],
      };
    },
  });
}

export function updateD1BudgetTransaction(actor: D1BudgetActor, id: string, input: any, key: string | null, database?: D1Store): Promise<NativePersonResult> {
  return executeD1PersonEffect({
    actor, action: "budget.transaction.update", input: { id, ...input }, key, database,
    authorize: async (db) => {
      const denied = await authority(db, actor); if (denied) return denied;
      return null;
    },
    plan: async (db) => {
      const existing = await transactionFor(db, actor, id);
      if (!existing) return failure(404, "Transaction not found");
      const checked = await categoryFor(db, actor.familyId, input.category_id === undefined ? existing.category_id : input.category_id);
      if (checked.error) return checked.error;
      const previousUpdatedAt = epoch(existing.updated_at), now = new Date(Math.max(Date.now(), previousUpdatedAt + 1));
      const isRecurring = input.is_recurring === undefined ? (existing.is_recurring === true || Number(existing.is_recurring) === 1) : input.is_recurring;
      let recurringInterval = existing.recurring_interval;
      if (input.is_recurring !== undefined) {
        if (!input.is_recurring) recurringInterval = null;
        else if (input.recurring_interval !== undefined) recurringInterval = input.recurring_interval;
      } else if (input.recurring_interval !== undefined) recurringInterval = input.recurring_interval;
      const row = {
        ...existing,
        amount: input.amount === undefined ? existing.amount : input.amount,
        type: input.type === undefined ? existing.type : input.type,
        category_id: input.category_id === undefined ? existing.category_id : input.category_id,
        description: input.description === undefined ? existing.description : input.description,
        notes: input.notes === undefined ? existing.notes : input.notes,
        date: input.date === undefined ? existing.date : new Date(input.date),
        is_recurring: isRecurring,
        recurring_interval: recurringInterval,
        updated_at: now,
      };
      return {
        status: 200,
        body: { transaction: transactionDto(row, checked.category, (existing as any).user) },
        effects: (session) => [
          d1WriteCheck(session, `EXISTS (SELECT 1 FROM "Transaction" WHERE id=?1 AND family_id=?2 AND updated_at=?3)`, [id, actor.familyId, previousUpdatedAt]),
          d1WriteCheck(session, `EXISTS (SELECT 1 FROM "User" WHERE id=?1 AND family_id=?2 AND role='parent' AND token_version=?3)`, [actor.userId, actor.familyId, actor.generation]),
          session.prepare(`UPDATE "Transaction" SET amount=?3,type=?4,category_id=?5,description=?6,notes=?7,date=?8,is_recurring=?9,recurring_interval=?10,updated_at=?11 WHERE id=?1 AND family_id=?2 AND updated_at=?12`).bind(id, actor.familyId, Number(row.amount), row.type, row.category_id || null, row.description || null, row.notes || null, epoch(row.date), row.is_recurring ? 1 : 0, row.recurring_interval || null, now.getTime(), previousUpdatedAt),
          d1WriteCheck(session, "changes()=1"),
        ],
      };
    },
  });
}

export function deleteD1BudgetTransaction(actor: D1BudgetActor, id: string, key: string | null, database?: D1Store): Promise<NativePersonResult> {
  return executeD1PersonEffect({
    actor, action: "budget.transaction.delete", input: { id }, key, database,
    authorize: (db) => authority(db, actor),
    plan: async (db) => {
      if (!(await transactionFor(db, actor, id))) return failure(404, "Transaction not found");
      return { status: 200, body: { success: true }, effects: (session) => [
        d1WriteCheck(session, `EXISTS (SELECT 1 FROM "Transaction" WHERE id=?1 AND family_id=?2)`, [id, actor.familyId]),
        d1WriteCheck(session, `EXISTS (SELECT 1 FROM "User" WHERE id=?1 AND family_id=?2 AND role='parent' AND token_version=?3)`, [actor.userId, actor.familyId, actor.generation]),
        session.prepare(`DELETE FROM "Transaction" WHERE id=?1 AND family_id=?2`).bind(id, actor.familyId),
        d1WriteCheck(session, "changes()=1"),
      ] };
    },
  });
}

export async function readD1BudgetTransactions(actor: D1BudgetActor, filters: TransactionFilters, database?: D1Store): Promise<NativeResult> {
  const store = database ?? await getD1Database(), db = store.withSession("first-primary");
  const denied = await withD1ReadClient((read) => authority(read, actor), store as any);
  if (denied) return denied;
  const values: SqlValue[] = [actor.familyId];
  let where = `t.family_id=?1`;
  if (filters.type === "income" || filters.type === "expense") { values.push(filters.type); where += ` AND t.type=?${values.length}`; }
  if (filters.categoryId) { values.push(filters.categoryId); where += ` AND t.category_id=?${values.length}`; }
  if (filters.start) { values.push(filters.start.getTime()); where += ` AND t.date>=?${values.length}`; }
  if (filters.end) { values.push(filters.end.getTime()); where += ` AND t.date<=?${values.length}`; }
  const pageValues = [...values, filters.limit, filters.offset];
  const rows = await db.prepare(`SELECT t.*,c.id AS category_ref,c.name AS category_name,c.icon AS category_icon,c.color AS category_color,u.id AS user_ref,u.name AS user_name,u.avatar_url AS user_avatar FROM "Transaction" t LEFT JOIN "BudgetCategory" c ON c.id=t.category_id AND c.family_id=t.family_id JOIN "User" u ON u.id=t.user_id AND u.family_id=t.family_id WHERE ${where} ORDER BY t.date DESC LIMIT ?${pageValues.length - 1} OFFSET ?${pageValues.length}`).bind(...pageValues).all<any>();
  const total = await db.prepare(`SELECT COUNT(*) AS total FROM "Transaction" t WHERE ${where}`).bind(...values).first<{ total: number }>();
  const transactions = rows.results.map(row => transactionDto(row,
    row.category_ref ? { id: row.category_ref, name: row.category_name, icon: row.category_icon, color: row.category_color } : null,
    row.user_ref ? { id: row.user_ref, name: row.user_name, avatar_url: row.user_avatar } : null));
  return { status: 200, body: { transactions, total: Number(total?.total ?? 0), limit: filters.limit, offset: filters.offset } };
}

export async function readD1BudgetCategories(actor: D1BudgetActor, type: string | null, database?: D1Store): Promise<NativeResult> {
  const store = database ?? await getD1Database(), db = store.withSession("first-primary");
  const denied = await withD1ReadClient((read) => authority(read, actor), store as any);
  if (denied) return denied;
  const values: SqlValue[] = [actor.familyId];
  let where = `c.family_id=?1`;
  if (type === "income" || type === "expense") { values.push(type); where += ` AND c.type=?${values.length}`; }
  const rows = await db.prepare(`SELECT c.*,u.id AS creator_ref,u.name AS creator_name,COUNT(t.id) AS transaction_count FROM "BudgetCategory" c JOIN "User" u ON u.id=c.created_by AND u.family_id=c.family_id LEFT JOIN "Transaction" t ON t.category_id=c.id AND t.family_id=c.family_id WHERE ${where} GROUP BY c.id ORDER BY c.name ASC`).bind(...values).all<any>();
  return { status: 200, body: { categories: rows.results.map(row => categoryDto(row, row.transaction_count, { id: row.creator_ref, name: row.creator_name })) } };
}

export async function createD1BudgetCategory(actor: D1BudgetActor, input: any, database?: D1Store): Promise<NativeResult> {
  const store = database ?? await getD1Database(), db = store.withSession("first-primary");
  const denied = await withD1ReadClient((read) => authority(read, actor), store as any);
  if (denied) return denied;
  const duplicate = await db.prepare(`SELECT id FROM "BudgetCategory" WHERE family_id=?1 AND lower(name)=lower(?2) AND type=?3`).bind(actor.familyId, input.name, input.type || "expense").first();
  if (duplicate) return failure(409, `A ${input.type || "expense"} category named "${input.name}" already exists`);
  const now = new Date(), id = randomUUID(), type = input.type || "expense", row = { id, family_id: actor.familyId, name: input.name, icon: input.icon || "📦", color: input.color || "#6B7280", type, budget_limit: input.budget_limit ?? null, created_by: actor.userId, created_at: now, import_metadata: null };
  try {
    await db.batch([
      d1WriteCheck(db, `EXISTS (SELECT 1 FROM "User" WHERE id=?1 AND family_id=?2 AND role='parent' AND token_version=?3)`, [actor.userId, actor.familyId, actor.generation]),
      d1WriteCheck(db, `NOT EXISTS (SELECT 1 FROM "BudgetCategory" WHERE family_id=?1 AND lower(name)=lower(?2) AND type=?3)`, [actor.familyId, input.name, type]),
      db.prepare(`INSERT INTO "BudgetCategory" (id,family_id,name,icon,color,type,budget_limit,created_by,created_at) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9)`).bind(id, actor.familyId, row.name, row.icon, row.color, row.type, row.budget_limit, actor.userId, now.getTime()),
    ]);
  } catch (error) {
    if (!isD1WriteConflict(error)) throw error;
    const current = await db.prepare(`SELECT id FROM "BudgetCategory" WHERE family_id=?1 AND lower(name)=lower(?2) AND type=?3`).bind(actor.familyId, input.name, type).first();
    if (current) return failure(409, `A ${type} category named "${input.name}" already exists`);
    return failure(401, "Unauthorized");
  }
  const creator = await db.prepare(`SELECT id,name FROM "User" WHERE id=?1 AND family_id=?2`).bind(actor.userId, actor.familyId).first<any>();
  return { status: 201, body: { category: categoryDto(row, 0, creator) } };
}

export async function updateD1BudgetCategory(actor: D1BudgetActor, id: string, input: any, database?: D1Store): Promise<NativeResult> {
  const store = database ?? await getD1Database(), db = store.withSession("first-primary");
  const denied = await withD1ReadClient((read) => authority(read, actor), store as any);
  if (denied) return denied;
  const existing = await db.prepare(`SELECT * FROM "BudgetCategory" WHERE id=?1 AND family_id=?2`).bind(id, actor.familyId).first<any>();
  if (!existing) return failure(404, "Category not found");
  const next = { ...existing, name: input.name === undefined ? existing.name : input.name, icon: input.icon === undefined ? existing.icon : input.icon, color: input.color === undefined ? existing.color : input.color, type: input.type === undefined ? existing.type : input.type, budget_limit: input.budget_limit === undefined ? existing.budget_limit : input.budget_limit };
  if (input.name !== undefined) {
    const duplicate = await db.prepare(`SELECT id FROM "BudgetCategory" WHERE family_id=?1 AND lower(name)=lower(?2) AND id<>?3 AND (?4 IS NULL OR type=?4)`).bind(actor.familyId, input.name, id, input.type ?? null).first();
    if (duplicate) return failure(409, `A category named "${input.name}" already exists`);
  }
  const transactionCount = await db.prepare(`SELECT COUNT(*) AS n FROM "Transaction" WHERE category_id=?1 AND family_id=?2`).bind(id, actor.familyId).first<{ n: number }>();
  try {
    await db.batch([
      d1WriteCheck(db, `EXISTS (SELECT 1 FROM "User" WHERE id=?1 AND family_id=?2 AND role='parent' AND token_version=?3)`, [actor.userId, actor.familyId, actor.generation]),
      d1WriteCheck(db, `EXISTS (SELECT 1 FROM "BudgetCategory" WHERE id=?1 AND family_id=?2)`, [id, actor.familyId]),
      d1WriteCheck(db, `NOT EXISTS (SELECT 1 FROM "BudgetCategory" WHERE family_id=?1 AND lower(name)=lower(?2) AND id<>?3 AND (?4 IS NULL OR type=?4))`, [actor.familyId, next.name, id, input.type ?? null]),
      db.prepare(`UPDATE "BudgetCategory" SET name=?3,icon=?4,color=?5,type=?6,budget_limit=?7 WHERE id=?1 AND family_id=?2`).bind(id, actor.familyId, next.name, next.icon, next.color, next.type, next.budget_limit),
      d1WriteCheck(db, "changes()=1"),
    ]);
  } catch (error) {
    if (!isD1WriteConflict(error)) throw error;
    const current = await db.prepare(`SELECT id FROM "BudgetCategory" WHERE family_id=?1 AND lower(name)=lower(?2) AND id<>?3`).bind(actor.familyId, next.name, id).first();
    if (current) return failure(409, `A category named "${next.name}" already exists`);
    return failure(404, "Category not found");
  }
  const creator = await db.prepare(`SELECT id,name FROM "User" WHERE id=?1 AND family_id=?2`).bind(existing.created_by, actor.familyId).first<any>();
  return { status: 200, body: { category: categoryDto({ ...next, created_at: existing.created_at, created_by: existing.created_by, import_metadata: existing.import_metadata }, transactionCount?.n ?? 0, creator) } };
}

export async function deleteD1BudgetCategory(actor: D1BudgetActor, id: string, database?: D1Store): Promise<NativeResult> {
  const store = database ?? await getD1Database(), db = store.withSession("first-primary");
  const denied = await withD1ReadClient((read) => authority(read, actor), store as any);
  if (denied) return denied;
  const category = await db.prepare(`SELECT id FROM "BudgetCategory" WHERE id=?1 AND family_id=?2`).bind(id, actor.familyId).first();
  if (!category) return failure(404, "Category not found");
  const transactionCount = await db.prepare(`SELECT COUNT(*) AS n FROM "Transaction" WHERE category_id=?1 AND family_id=?2`).bind(id, actor.familyId).first<{ n: number }>();
  try {
    await db.batch([
      d1WriteCheck(db, `EXISTS (SELECT 1 FROM "User" WHERE id=?1 AND family_id=?2 AND role='parent' AND token_version=?3)`, [actor.userId, actor.familyId, actor.generation]),
      d1WriteCheck(db, `EXISTS (SELECT 1 FROM "BudgetCategory" WHERE id=?1 AND family_id=?2)`, [id, actor.familyId]),
      db.prepare(`UPDATE "Transaction" SET category_id=NULL WHERE category_id=?1 AND family_id=?2`).bind(id, actor.familyId),
      db.prepare(`DELETE FROM "BudgetCategory" WHERE id=?1 AND family_id=?2`).bind(id, actor.familyId),
      d1WriteCheck(db, "changes()=1"),
    ]);
  } catch (error) {
    if (!isD1WriteConflict(error)) throw error;
    return failure(404, "Category not found");
  }
  return { status: 200, body: { success: true, orphaned_transactions: Number(transactionCount?.n ?? 0) } };
}

async function aggregateMonth(db: Pick<D1Store, "prepare">, familyId: string, start: Date, end: Date) {
  return db.prepare(`SELECT type,COALESCE(SUM(amount),0) AS total FROM "Transaction" WHERE family_id=?1 AND date>=?2 AND date<?3 GROUP BY type`).bind(familyId, start.getTime(), end.getTime()).all<any>();
}

export async function readD1BudgetStats(actor: D1BudgetActor, targetYear: number, targetMonth: number, database?: D1Store): Promise<NativeResult> {
  const store = database ?? await getD1Database(), db = store.withSession("first-primary");
  const denied = await withD1ReadClient((read) => authority(read, actor), store as any);
  if (denied) return denied;
  const start = new Date(Date.UTC(targetYear, targetMonth - 1, 1)), end = new Date(Date.UTC(targetYear, targetMonth, 1));
  const aggregation = await aggregateMonth(db, actor.familyId, start, end);
  let totalIncome = 0, totalExpenses = 0;
  for (const row of aggregation.results) { if (row.type === "income") totalIncome = Number(row.total); if (row.type === "expense") totalExpenses = Number(row.total); }
  const breakdownRows = await db.prepare(`SELECT category_id,COALESCE(SUM(amount),0) AS total FROM "Transaction" WHERE family_id=?1 AND type='expense' AND date>=?2 AND date<?3 GROUP BY category_id`).bind(actor.familyId, start.getTime(), end.getTime()).all<any>();
  const categoryIds = breakdownRows.results.map(row => row.category_id).filter(Boolean);
  const categoryMap = new Map<string, any>();
  if (categoryIds.length) {
    const placeholders = categoryIds.map((_, index) => `?${index + 2}`).join(",");
    const categories = await db.prepare(`SELECT id,name,icon,color,budget_limit FROM "BudgetCategory" WHERE family_id=?1 AND id IN (${placeholders})`).bind(actor.familyId, ...categoryIds).all<any>();
    for (const row of categories.results) categoryMap.set(row.id, row);
  }
  const categoryBreakdown = breakdownRows.results.map(row => {
    const category = row.category_id ? categoryMap.get(row.category_id) : null, total = Number(row.total);
    return { category_id: row.category_id ?? null, name: category?.name || "Uncategorized", icon: category?.icon || "📦", color: category?.color || "#6B7280", budget_limit: category?.budget_limit == null ? null : Number(category.budget_limit), total: Math.round(total * 100) / 100, percentage: totalExpenses > 0 ? Math.round(total / totalExpenses * 1000) / 10 : 0 };
  }).sort((a, b) => b.total - a.total);
  const limits = await db.prepare(`SELECT budget_limit FROM "BudgetCategory" WHERE family_id=?1 AND type='expense'`).bind(actor.familyId).all<{ budget_limit: number | null }>();
  const budgetLimit = sumBudgetLimits(limits.results.map(row => ({ budget_limit: row.budget_limit == null ? null : Number(row.budget_limit) })));
  const recent = await db.prepare(`SELECT t.*,c.id AS category_ref,c.name AS category_name,c.icon AS category_icon,c.color AS category_color,u.id AS user_ref,u.name AS user_name,u.avatar_url AS user_avatar FROM "Transaction" t LEFT JOIN "BudgetCategory" c ON c.id=t.category_id AND c.family_id=t.family_id JOIN "User" u ON u.id=t.user_id AND u.family_id=t.family_id WHERE t.family_id=?1 ORDER BY t.date DESC LIMIT ${RECENT_TRANSACTIONS_LIMIT}`).bind(actor.familyId).all<any>();
  const monthlyTrend: Array<{ month: string; income: number; expenses: number }> = [];
  for (let index = 5; index >= 0; index -= 1) {
    const trendStart = new Date(Date.UTC(targetYear, targetMonth - 1 - index, 1)), trendEnd = new Date(Date.UTC(targetYear, targetMonth - index, 1));
    const trend = await aggregateMonth(db, actor.familyId, trendStart, trendEnd);
    let income = 0, expenses = 0;
    for (const row of trend.results) { if (row.type === "income") income = Number(row.total); if (row.type === "expense") expenses = Number(row.total); }
    monthlyTrend.push({ month: `${trendStart.getUTCFullYear()}-${String(trendStart.getUTCMonth() + 1).padStart(2, "0")}`, income: Math.round(income * 100) / 100, expenses: Math.round(expenses * 100) / 100 });
  }
  return { status: 200, body: { month: `${targetYear}-${String(targetMonth).padStart(2, "0")}`, total_income: Math.round(totalIncome * 100) / 100, total_expenses: Math.round(totalExpenses * 100) / 100, balance: Math.round((totalIncome - totalExpenses) * 100) / 100, budget_limit: budgetLimit, category_breakdown: categoryBreakdown, recent_transactions: recent.results.map(row => transactionDto(row, row.category_ref ? { id: row.category_ref, name: row.category_name, icon: row.category_icon, color: row.category_color } : null, row.user_ref ? { id: row.user_ref, name: row.user_name, avatar_url: row.user_avatar } : null)), monthly_trend: monthlyTrend } };
}
