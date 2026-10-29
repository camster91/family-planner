/** Native D1 inventory reads and person-owned effects.
 *
 * Inventory is household data, so every plan first proves the session's
 * family, role and token generation, then repeats the captured reads as D1
 * write witnesses.  No caller-provided family, product or ingredient is
 * trusted without the same-family lookup.
 */
import { randomUUID } from "node:crypto";
import type { z } from "zod";
import type { InventoryIntakeInput } from "@/lib/inventory-intake-contract";
import type { InventoryChangeInput } from "@/lib/inventory-change-contract";
import {
  cleanItemName,
  createInventorySchema,
  getCookSuggestions,
  getUseSoonItems,
  INVENTORY_ITEM_SELECT,
  INVENTORY_MAX_LIMIT,
  INVENTORY_SEARCH_MAX,
  type InventoryRow,
  toInventoryDto,
  type UpdateInventoryInput,
  updateInventorySchema,
} from "@/lib/inventory";
import { resolveInventoryIngredient } from "@/lib/inventory";
import { addUTCDays, parseDateOnly } from "@/lib/dates";
import { startOfTodayUTC } from "@/lib/dates";
import {
  ADJUSTMENT_SELECT,
  isUndoable,
  nextItemVersion,
  toAdjustmentDto,
  type AdjustmentRow,
  type AdjustmentDto,
} from "@/lib/inventory-adjust";
import type { EffectResult } from "@/lib/idempotency";
import { normalizeFeatures, isFeatureEnabled } from "@/lib/features";
import type { AssistantProofActor } from "@/lib/assistant-source-proof";
import { d1WriteCheck } from "./write-check";
import { executeD1PersonEffect, type NativePersonPlan } from "./person-effect";
import { getD1Database, type D1Store, type SqlValue } from "./database";
import { withD1ReadClient, type D1ReadClient, type NativeD1 } from "./read-client";
import {
  foodProductLicenseApproved,
  foodProductSourceUrl,
} from "@/lib/food-product-provider";
import { IDEMPOTENCY_TTL_MS } from "@/lib/idempotency-key";

const ITEM_SELECT = {
  ...INVENTORY_ITEM_SELECT,
} as const;

type Item = Awaited<ReturnType<D1ReadClient["inventoryItem"]["findMany"]>>[number];
type Adjustment = Awaited<ReturnType<D1ReadClient["inventoryAdjustment"]["findMany"]>>[number];

const denied = (status: number, error: string): EffectResult => ({
  status,
  body: { error },
});

/** Same authority as the PostgreSQL inventory writer, with D1 feature state. */
export async function authorizeD1Inventory(
  db: D1ReadClient,
  actor: AssistantProofActor,
  write = false,
): Promise<EffectResult | null> {
  const user = await db.user.findUnique({
    where: { id: actor.userId },
    select: { family_id: true, role: true, token_version: true },
  });
  if (
    !user ||
    user.family_id !== actor.familyId ||
    user.role !== actor.role ||
    user.token_version !== actor.generation
  )
    return denied(401, "Unauthorized");
  if (
    !["parent", "teen", "child"].includes(user.role) ||
    (write && !["parent", "teen"].includes(user.role))
  )
    return denied(403, write ? "Ask a parent or teen to change the inventory." : "Forbidden");
  const family = await db.family.findUnique({
    where: { id: actor.familyId },
    select: { features: true },
  });
  if (!family) return denied(404, "Household not found");
  if (!isFeatureEnabled(normalizeFeatures(family.features), "inventory"))
    return denied(403, "This feature is turned off for your family");
  return null;
}

async function readSnapshot<T>(
  actor: AssistantProofActor,
  read: (db: D1ReadClient) => Promise<T>,
  database?: D1Store,
  write = false,
) {
  // Inventory reads are already executed on D1's primary session and carry no
  // write side effect. Do not replay a wide Prisma projection as a write
  // witness: SQLite date decoding can differ from raw witness serialization,
  // which would turn a valid read into a false conflict.
  const store = database ?? (await getD1Database());
  return withD1ReadClient(async (db) => {
    const refusal = await authorizeD1Inventory(db, actor, write);
    return refusal
      ? { refusal, value: undefined as T | undefined }
      : { refusal: null, value: await read(db) };
  }, store as unknown as NativeD1);
}

export type D1InventoryPage = {
  items: ReturnType<typeof toInventoryDto>[];
  nextOffset: number | null;
};

export async function readD1Inventory(
  actor: AssistantProofActor,
  options: {
    today: Date;
    location?: string | null;
    category?: string | null;
    query?: string;
    expiresBy?: Date | null;
    limit: number;
    offset: number;
  },
  database?: D1Store,
): Promise<{ refusal: EffectResult | null; page?: D1InventoryPage }> {
  const result = await readSnapshot(
    actor,
    async (db) => {
      const rows = await db.inventoryItem.findMany({
        where: {
          family_id: actor.familyId,
          status: "active",
          ...(options.location ? { location: options.location } : {}),
          ...(options.category ? { category: options.category } : {}),
          ...(options.query
            ? { name: { contains: options.query } }
            : {}),
          ...(options.expiresBy
            ? { expires_on: { not: null, lte: options.expiresBy } }
            : {}),
        },
        select: ITEM_SELECT,
        orderBy: [{ name: "asc" }, { id: "asc" }],
        skip: options.offset,
        take: options.limit + 1,
      });
      const hasMore = rows.length > options.limit;
      return {
        items: (hasMore ? rows.slice(0, options.limit) : rows).map((row) =>
          toInventoryDto(row as unknown as InventoryRow, options.today),
        ),
        nextOffset: hasMore ? options.offset + options.limit : null,
      };
    },
    database,
  );
  if (result.refusal) return { refusal: result.refusal };
  return { refusal: null, page: result.value };
}

export async function readD1InventoryItem(
  actor: AssistantProofActor,
  id: string,
  today: Date,
  database?: D1Store,
): Promise<{ refusal: EffectResult | null; item?: ReturnType<typeof toInventoryDto> | null }> {
  const result = await readSnapshot(
    actor,
    async (db) => {
      const row = await db.inventoryItem.findFirst({
        where: { id, family_id: actor.familyId },
        select: ITEM_SELECT,
      });
      return row ? toInventoryDto(row as unknown as InventoryRow, today) : null;
    },
    database,
  );
  if (result.refusal) return { refusal: result.refusal };
  return { refusal: null, item: result.value };
}

export async function readD1UseSoon(
  actor: AssistantProofActor,
  options: { today: Date; days: number; limit: number },
  database?: D1Store,
) {
  const result = await readSnapshot(
    actor,
    (db) =>
      getUseSoonItems(db as never, actor.familyId, {
        today: options.today,
        days: options.days,
        limit: options.limit,
      }),
    database,
  );
  return result.refusal
    ? { refusal: result.refusal }
    : { refusal: null, items: result.value };
}

export async function readD1CookSuggestions(
  actor: AssistantProofActor,
  options: { today: Date; limit: number },
  database?: D1Store,
) {
  const result = await readSnapshot(
    actor,
    (db) =>
      getCookSuggestions(db as never, actor.familyId, {
        today: options.today,
        limit: options.limit,
      }),
    database,
  );
  return result.refusal
    ? { refusal: result.refusal }
    : { refusal: null, result: result.value };
}

export async function readD1InventoryAdjustments(
  actor: AssistantProofActor,
  options: { itemId?: string | null; limit: number; offset: number },
  database?: D1Store,
) {
  const result = await readSnapshot(
    actor,
    async (db) => {
      const rows = await db.inventoryAdjustment.findMany({
        where: {
          family_id: actor.familyId,
          ...(options.itemId ? { item_id: options.itemId } : {}),
        },
        select: {
          ...ADJUSTMENT_SELECT,
          item: { select: { name: true, status: true, updated_at: true } },
        },
        orderBy: [{ created_at: "desc" }, { id: "desc" }],
        skip: options.offset,
        take: options.limit + 1,
      });
      const hasMore = rows.length > options.limit;
      const adjustments = (hasMore ? rows.slice(0, options.limit) : rows).map(
        (row) => ({
          ...toAdjustmentDto(row as unknown as AdjustmentRow),
          item_name: row.item?.name ?? "",
          item_status: row.item?.status ?? "active",
          undoable: isUndoable(row as unknown as AdjustmentRow, row.item),
        }),
      );
      return {
        adjustments,
        nextOffset: hasMore ? options.offset + options.limit : null,
      };
    },
    database,
  );
  return result.refusal
    ? { refusal: result.refusal }
    : { refusal: null, ...result.value };
}

export async function readD1FoodProduct(
  actor: AssistantProofActor,
  barcode: string,
  database?: D1Store,
) {
  const result = await readSnapshot(
    actor,
    (db) =>
      db.foodProduct.findFirst({
        where: { family_id: actor.familyId, barcode },
        select: {
          barcode: true,
          name: true,
          brand: true,
          package_size: true,
          origin: true,
          source_url: true,
          revision: true,
        },
      }),
    database,
    true,
  );
  return result.refusal
    ? { refusal: result.refusal }
    : { refusal: null, product: result.value };
}

function toSql(value: unknown): SqlValue {
  if (value instanceof Date) return value.getTime();
  if (typeof value === "boolean") return Number(value);
  if (value === undefined) return null;
  if (typeof value === "string" || typeof value === "number" || value === null)
    return value;
  throw new Error("Unsupported inventory SQL value");
}

function itemBody(row: InventoryRow, today: Date) {
  return { item: toInventoryDto(row, today) };
}

export function createD1Inventory(
  actor: AssistantProofActor,
  input: z.infer<typeof createInventorySchema>,
  today: Date,
  key: string | null,
  database?: D1Store,
) {
  const now = new Date();
  return executeD1PersonEffect({
    actor,
    action: "inventory-item.create",
    input,
    key,
    database,
    now,
    authorize: (db) => authorizeD1Inventory(db, actor, true),
    plan: async (db) => {
      const name = cleanItemName(input.name);
      const ingredientId = await resolveInventoryIngredient(
        db as never,
        actor.familyId,
        name,
        input.ingredient_id,
      );
      const row = {
        id: randomUUID(),
        family_id: actor.familyId,
        name,
        barcode: null,
        product_brand: null,
        package_size: null,
        product_source: null,
        ingredient_id: ingredientId,
        amount: input.amount ?? null,
        unit: input.unit ?? null,
        location: input.location ?? "fridge",
        expires_on: input.expires_on ? parseDateOnly(input.expires_on) : null,
        date_kind: input.date_kind ?? "best_before",
        category: input.category ?? null,
        purchased_on: input.purchased_on ? parseDateOnly(input.purchased_on) : null,
        opened_on: input.opened_on ? parseDateOnly(input.opened_on) : null,
        status: "active",
        finished_at: null,
        added_by: actor.userId,
        created_at: now,
        updated_at: now,
      } as unknown as InventoryRow;
      return {
        status: 201,
        body: itemBody(row, today),
        effects: (session: Pick<D1Store, "prepare">) => [
          session
            .prepare(
              `INSERT INTO "InventoryItem"(id,family_id,name,ingredient_id,amount,unit,location,expires_on,date_kind,category,purchased_on,opened_on,status,finished_at,added_by,created_at,updated_at)
               VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,'active',NULL,?13,?14,?14)`,
            )
            .bind(
              row.id,
              actor.familyId,
              row.name,
              row.ingredient_id,
              row.amount,
              row.unit,
              row.location,
              toSql(row.expires_on),
              row.date_kind ?? "best_before",
              row.category ?? null,
              toSql(row.purchased_on),
              toSql(row.opened_on),
              row.added_by,
              now.getTime(),
            ),
        ],
      };
    },
  });
}

/** Reviewed intake used by scan/UPC/photo flows. Product memory and stock
 * metadata are committed with the item, never as a second best-effort write. */
export function intakeD1Inventory(
  actor: AssistantProofActor,
  input: InventoryIntakeInput,
  key: string,
  database?: D1Store,
) {
  const now = new Date();
  return executeD1PersonEffect({
    actor,
    action: "inventory.intake.v1",
    input,
    key,
    database,
    now,
    authorize: (db) => authorizeD1Inventory(db, actor, true),
    plan: async (db) => {
      if (
        input.expected_user_id !== actor.userId ||
        input.expected_family_id !== actor.familyId
      )
        return { status: 403, body: { error: "AUTH_CONTEXT_CHANGED" } };
      const issued = new Date(input.issued_at).getTime();
      if (!Number.isFinite(issued) || now.getTime() - issued < -60_000 || now.getTime() - issued > IDEMPOTENCY_TTL_MS - 3_600_000)
        return { status: 409, body: { error: "INTAKE_INTENT_EXPIRED" } };
      const data = input.item;
      const name = cleanItemName(data.name);
      const ingredientId = await resolveInventoryIngredient(
        db as never,
        actor.familyId,
        name,
        data.ingredient_id,
      );
      const product = input.product;
      if (product?.origin === "open-food-facts" && !foodProductLicenseApproved())
        return { status: 403, body: { error: "PRODUCT_REUSE_DISABLED" } };
      const productSource = product?.origin === "open-food-facts" ? foodProductSourceUrl(product.barcode) : null;
      const existing = product?.remember
        ? await db.foodProduct.findFirst({ where: { family_id: actor.familyId, barcode: product.barcode } })
        : null;
      const desired = product
        ? { name, brand: product.brand, package_size: product.package_size, origin: product.origin, source_url: productSource }
        : null;
      const same = Boolean(existing && desired && Object.entries(desired).every(([field, value]) => existing[field as keyof typeof desired] === value));
      if (product?.remember && !same && (existing?.revision ?? null) !== product.base_revision)
        return { status: 409, body: { error: "PRODUCT_CHANGED" } };
      const itemId = randomUUID();
      return {
        status: 201,
        body: { itemId },
        effects: (session: Pick<D1Store, "prepare">) => {
          const statements = [] as ReturnType<Pick<D1Store, "prepare">["prepare"]>[];
          if (product?.remember && desired) {
            if (!existing)
              statements.push(session.prepare(`INSERT INTO "FoodProduct"(id,family_id,barcode,name,brand,package_size,origin,source_url,revision,updated_at) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,0,?9)`).bind(randomUUID(), actor.familyId, product.barcode, desired.name, desired.brand, desired.package_size, desired.origin, desired.source_url, now.getTime()));
            else if (!same)
              statements.push(session.prepare(`UPDATE "FoodProduct" SET name=?1,brand=?2,package_size=?3,origin=?4,source_url=?5,revision=revision+1,updated_at=?6 WHERE id=?7 AND family_id=?8 AND revision=?9`).bind(desired.name, desired.brand, desired.package_size, desired.origin, desired.source_url, now.getTime(), existing.id, actor.familyId, product.base_revision));
          }
          statements.push(session.prepare(`INSERT INTO "InventoryItem"(id,family_id,name,barcode,product_brand,package_size,product_source,ingredient_id,amount,unit,location,expires_on,date_kind,category,purchased_on,opened_on,status,finished_at,added_by,created_at,updated_at) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,'active',NULL,?17,?18,?18)`).bind(itemId, actor.familyId, name, product?.barcode ?? null, product?.brand ?? null, product?.package_size ?? input.label?.package_size ?? null, productSource, ingredientId, data.amount ?? null, data.unit ?? null, data.location ?? "fridge", data.expires_on ? parseDateOnly(data.expires_on)?.getTime() ?? null : null, data.date_kind ?? "best_before", data.category ?? null, data.purchased_on ? parseDateOnly(data.purchased_on)?.getTime() ?? null : null, data.opened_on ? parseDateOnly(data.opened_on)?.getTime() ?? null : null, actor.userId, now.getTime()));
          return statements;
        },
      };
    },
  });
}

export function updateD1Inventory(
  actor: AssistantProofActor,
  id: string,
  input: UpdateInventoryInput,
  today: Date,
  key: string | null,
  database?: D1Store,
  expectedVersion?: string,
) {
  const now = new Date();
  return executeD1PersonEffect({
    actor,
    action: "inventory-item.update",
    input: { id, ...input },
    key,
    database,
    now,
    authorize: (db) => authorizeD1Inventory(db, actor, true),
    plan: async (db) => {
      const current = await db.inventoryItem.findFirst({
        where: { id, family_id: actor.familyId },
        select: ITEM_SELECT,
      });
      if (!current) return { status: 404, body: { error: "Item not found" } };
      if (current.status !== "active")
        return { status: 409, body: { error: "This item was already finished" } };
      if (
        expectedVersion &&
        current.updated_at.getTime() !== new Date(expectedVersion).getTime()
      )
        return { status: 409, body: { error: "The item changed while saving. Try again." } };
      const next: Record<string, SqlValue> = {};
      const name = input.name === undefined ? undefined : cleanItemName(input.name);
      if (name !== undefined) next.name = name;
      if (input.ingredient_id !== undefined || (name !== undefined && name !== current.name))
        next.ingredient_id = await resolveInventoryIngredient(
          db as never,
          actor.familyId,
          name ?? current.name,
          input.ingredient_id,
        );
      for (const field of ["amount", "unit", "location", "date_kind", "category"] as const)
        if (input[field] !== undefined) next[field] = toSql(input[field]);
      for (const field of ["expires_on", "purchased_on", "opened_on"] as const)
        if (input[field] !== undefined) {
          const parsed = input[field] ? parseDateOnly(input[field] as string) : null;
          if (input[field] && !parsed) return { status: 400, body: { error: "Invalid date" } };
          next[field] = parsed ? parsed.getTime() : null;
        }
      const updated = new Date(Math.max(now.getTime(), current.updated_at.getTime() + 1));
      next.updated_at = updated.getTime();
      const row = { ...current, ...next, updated_at: updated } as unknown as InventoryRow;
      const entries = Object.entries(next);
      return {
        status: 200,
        body: itemBody(row, today),
        effects: (session: Pick<D1Store, "prepare">) => [
          session
            .prepare(
              `UPDATE "InventoryItem" SET ${entries.map(([field], i) => `"${field}"=?${i + 1}`).join(",")} WHERE id=?${entries.length + 1} AND family_id=?${entries.length + 2} AND status='active' AND updated_at=?${entries.length + 3}`,
            )
            .bind(
              ...entries.map(([, value]) => value),
              id,
              actor.familyId,
              current.updated_at.getTime(),
            ),
          d1WriteCheck(session, "changes()=1"),
        ],
      };
    },
  });
}

export function deleteD1Inventory(
  actor: AssistantProofActor,
  id: string,
  key: string | null,
  database?: D1Store,
  expectedVersion?: string,
) {
  return executeD1PersonEffect({
    actor,
    action: "inventory-item.delete",
    input: { id },
    key,
    database,
    authorize: (db) => authorizeD1Inventory(db, actor, true),
    plan: async (db) => {
      const current = await db.inventoryItem.findFirst({
        where: { id, family_id: actor.familyId },
        select: { id: true, updated_at: true },
      });
      if (!current) return { status: 404, body: { error: "Item not found" } };
      if (
        expectedVersion &&
        current.updated_at.getTime() !== new Date(expectedVersion).getTime()
      )
        return { status: 409, body: { error: "The item changed while saving. Try again." } };
      return {
        status: 200,
        body: { success: true },
        effects: (session: Pick<D1Store, "prepare">) => [
          session
            .prepare(
              `DELETE FROM "InventoryItem" WHERE id=?1 AND family_id=?2 AND updated_at=?3`,
            )
            .bind(id, actor.familyId, current.updated_at.getTime()),
          d1WriteCheck(session, "changes()=1"),
        ],
      };
    },
  });
}

export type D1AdjustKind = "consume" | "discard";
export function adjustD1Inventory(
  actor: AssistantProofActor,
  id: string,
  kind: D1AdjustKind,
  amount: number | null,
  today: Date,
  key: string | null,
  database?: D1Store,
  expectedVersion?: string,
) {
  const now = new Date();
  return executeD1PersonEffect({
    actor,
    action: kind === "consume" ? "inventory-item.consume" : "inventory-item.discard",
    input: { id, amount },
    key,
    database,
    now,
    authorize: (db) => authorizeD1Inventory(db, actor, true),
    plan: async (db, receiptId) => {
      const replay = receiptId
        ? await db.inventoryAdjustment.findFirst({
            where: { request_id: receiptId, family_id: actor.familyId },
            select: { ...ADJUSTMENT_SELECT },
          })
        : null;
      if (replay) {
        const item = await db.inventoryItem.findFirst({
          where: { id: replay.item_id, family_id: actor.familyId },
          select: ITEM_SELECT,
        });
        return item
          ? { status: 200, body: { item: toInventoryDto(item as unknown as InventoryRow, today), adjustment: toAdjustmentDto(replay as unknown as AdjustmentRow) } }
          : { status: 404, body: { error: "Item not found" } };
      }
      const item = await db.inventoryItem.findFirst({
        where: { id, family_id: actor.familyId },
        select: ITEM_SELECT,
      });
      if (!item) return { status: 404, body: { error: "Item not found" } };
      if (item.status !== "active") return { status: 409, body: { error: "This item was already finished" } };
      if (
        expectedVersion &&
        item.updated_at.getTime() !== new Date(expectedVersion).getTime()
      )
        return { status: 409, body: { error: "The item changed while saving. Try again." } };
      if (kind === "consume" && amount !== null && item.amount === null)
        return { status: 400, body: { error: "This item has no amount. Use all of it, or set an amount first." } };
      if (kind === "consume" && amount !== null && item.amount !== null && amount > item.amount)
        return { status: 400, body: { error: "Amount cannot exceed the amount on hand." } };
      const partial = kind === "consume" && amount !== null && item.amount !== null && amount < item.amount;
      const statusAfter = partial ? "active" : kind === "consume" ? "consumed" : "discarded";
      const amountAfter = partial ? Number((item.amount! - amount!).toPrecision(15)) : item.amount;
      const amountDelta = item.amount === null ? null : partial ? -amount! : -item.amount;
      const version = nextItemVersion(item.updated_at, now);
      const adjustmentId = randomUUID();
      const dto = {
        id: adjustmentId,
        item_id: id,
        kind,
        amount_delta: amountDelta,
        amount_before: item.amount,
        amount_after: amountAfter,
        status_before: "active",
        status_after: statusAfter,
        actor_id: actor.userId,
        item_version: version,
        created_at: now,
        undone_at: null,
      } as unknown as AdjustmentRow;
      const updated = { ...item, status: statusAfter, amount: amountAfter, finished_at: statusAfter === "active" ? null : now, updated_at: version } as unknown as InventoryRow;
      return {
        status: 200,
        body: { item: toInventoryDto(updated, today), adjustment: toAdjustmentDto(dto) },
        effects: (session: Pick<D1Store, "prepare">) => [
          session.prepare(`UPDATE "InventoryItem" SET status=?1,amount=?2,finished_at=?3,updated_at=?4 WHERE id=?5 AND family_id=?6 AND status='active' AND updated_at=?7`).bind(statusAfter, amountAfter, statusAfter === "active" ? null : now.getTime(), version.getTime(), id, actor.familyId, item.updated_at.getTime()),
          d1WriteCheck(session, "changes()=1"),
          session.prepare(`INSERT INTO "InventoryAdjustment"(id,family_id,item_id,kind,amount_delta,amount_before,amount_after,status_before,status_after,actor_id,request_id,item_version,created_at) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13)`).bind(adjustmentId, actor.familyId, id, kind, amountDelta, item.amount, amountAfter, "active", statusAfter, actor.userId, receiptId, version.getTime(), now.getTime()),
        ],
      };
    },
  });
}

export function undoD1InventoryAdjustment(
  actor: AssistantProofActor,
  adjustmentId: string,
  today: Date,
  key: string | null,
  database?: D1Store,
) {
  const now = new Date();
  return executeD1PersonEffect({
    actor,
    action: "inventory-adjustment.undo",
    input: { adjustmentId },
    key,
    database,
    now,
    authorize: (db) => authorizeD1Inventory(db, actor, true),
    plan: async (db) => {
      const adjustment = await db.inventoryAdjustment.findFirst({
        where: { id: adjustmentId, family_id: actor.familyId },
        select: { ...ADJUSTMENT_SELECT },
      });
      if (!adjustment) return { status: 404, body: { error: "That change was not found" } };
      const item = await db.inventoryItem.findFirst({
        where: { id: adjustment.item_id, family_id: actor.familyId },
        select: ITEM_SELECT,
      });
      if (!item) return { status: 404, body: { error: "That change was not found" } };
      if (adjustment.undone_at)
        return { status: 200, body: { item: toInventoryDto(item as unknown as InventoryRow, today), adjustment: toAdjustmentDto(adjustment as unknown as AdjustmentRow), alreadyUndone: true } };
      if (item.status !== adjustment.status_after || item.updated_at.getTime() !== adjustment.item_version.getTime())
        return { status: 409, body: { error: "This item changed after that, so it cannot be undone. Edit the item instead." } };
      const version = nextItemVersion(item.updated_at, now);
      const updated = { ...item, status: adjustment.status_before, amount: adjustment.amount_before, finished_at: null, updated_at: version } as unknown as InventoryRow;
      const marked = { ...adjustment, undone_at: now, undone_by: actor.userId } as unknown as AdjustmentRow;
      return {
        status: 200,
        body: { item: toInventoryDto(updated, today), adjustment: toAdjustmentDto(marked), alreadyUndone: false },
        effects: (session: Pick<D1Store, "prepare">) => [
          session.prepare(`UPDATE "InventoryItem" SET status=?1,amount=?2,finished_at=NULL,updated_at=?3 WHERE id=?4 AND family_id=?5 AND status=?6 AND updated_at=?7`).bind(adjustment.status_before, adjustment.amount_before, version.getTime(), adjustment.item_id, actor.familyId, adjustment.status_after, adjustment.item_version.getTime()),
          d1WriteCheck(session, "changes()=1"),
          session.prepare(`UPDATE "InventoryAdjustment" SET undone_at=?1,undone_by=?2 WHERE id=?3 AND family_id=?4 AND undone_at IS NULL`).bind(now.getTime(), actor.userId, adjustment.id, actor.familyId),
          d1WriteCheck(session, "changes()=1"),
        ],
      };
    },
  });
}

/** Reviewed change protocol adapter. The operation delegates to the same
 * household-scoped effects used by the direct routes, while returning the
 * compact receipt expected by offline/recovery clients. */
export async function changeD1Inventory(
  actor: AssistantProofActor,
  input: InventoryChangeInput,
  key: string,
  database?: D1Store,
) {
  if (
    input.expected_user_id !== actor.userId ||
    input.expected_family_id !== actor.familyId
  )
    return { status: 403, body: { error: { code: "AUTH_CONTEXT_CHANGED" } }, replayed: false };
  const operation = input.operation;
  const today = startOfTodayUTC();
  let result:
    | Awaited<ReturnType<typeof updateD1Inventory>>
    | Awaited<ReturnType<typeof deleteD1Inventory>>
    | Awaited<ReturnType<typeof adjustD1Inventory>>
    | Awaited<ReturnType<typeof undoD1InventoryAdjustment>>;
  if (operation.kind === "edit")
    result = await updateD1Inventory(actor, operation.item_id, operation.changes, today, key, database, operation.expected_version);
  else if (operation.kind === "remove")
    result = await deleteD1Inventory(actor, operation.item_id, key, database, operation.expected_version);
  else if (operation.kind === "undo")
    result = await undoD1InventoryAdjustment(actor, operation.adjustment_id, today, key, database);
  else
    result = await adjustD1Inventory(actor, operation.item_id, operation.kind, operation.kind === "consume" ? operation.amount : null, today, key, database, operation.expected_version);
  if (result.status < 200 || result.status >= 300)
    return {
      ...result,
      body: {
        error: {
          code:
            result.status === 404
              ? "CHANGE_TARGET_UNAVAILABLE"
              : result.status === 400
                ? "CHANGE_AMOUNT_INVALID"
                : "CHANGE_CONFLICT",
        },
      },
    };
  const body = operation.kind === "edit" || operation.kind === "remove"
    ? { itemId: operation.item_id, kind: operation.kind }
    : operation.kind === "undo"
      ? { itemId: (result.body as { item?: { id: string } }).item?.id ?? "", adjustmentId: operation.adjustment_id, kind: "undo" as const }
      : { itemId: operation.item_id, adjustmentId: (result.body as { adjustment?: { id: string } }).adjustment?.id ?? "", kind: operation.kind };
  return { status: 200, body, replayed: result.replayed };
}

/** Keep imports in this module honest when schema selectors change. */
export const INVENTORY_NATIVE_LIMIT = INVENTORY_MAX_LIMIT;
export const INVENTORY_NATIVE_SEARCH_MAX = INVENTORY_SEARCH_MAX;
export { addUTCDays };
