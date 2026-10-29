/** Personal list effects and keyed replies commit together on native D1. */
import { randomUUID } from "node:crypto";
import type { z } from "zod";
import type { createListSchema } from "@/lib/validations";
import type { NewListItem } from "@/lib/list-item-create";
import type {
  AssistantProofActor,
  AssistantSourceGuard,
} from "@/lib/assistant-source-proof";
import {
  resolveChorePhotoForWrite,
  type ChorePhotoReadDb,
} from "@/lib/chore-photos";
import { isGroceryListType } from "@/lib/grocery-display";
import { sectionsFor } from "@/lib/grocery-section-store";
import { executeD1PersonEffect, type NativePersonPlan } from "./person-effect";
import { authorizeD1Lists } from "./list-authority";
import { readD1SectionOverrides } from "./list-read";
import type { D1Store } from "./database";
import type { D1ReadClient } from "./read-client";

export function createD1List(
  actor: AssistantProofActor,
  input: z.infer<typeof createListSchema>,
  key: string | null,
  sourceGuard?: AssistantSourceGuard,
  database?: D1Store,
) {
  const now = new Date();
  return executeD1PersonEffect({
    actor,
    action: "list.create",
    input,
    key,
    sourceGuard,
    database,
    now,
    authorize: (db) => authorizeD1Lists(db, actor, true),
    plan: async (db) => {
      const image = await resolveChorePhotoForWrite(
        actor.familyId,
        input.image_url,
        undefined,
        db as unknown as ChorePhotoReadDb,
      );
      if (!image.ok)
        return {
          status: 400,
          body: {
            error: "Image not found. Upload a household image and retry.",
          },
        };
      const list = {
        id: randomUUID(),
        family_id: actor.familyId,
        created_by: actor.userId,
        name: input.name,
        type: input.type,
        description: input.description ?? null,
        image_url: image.value ?? null,
        is_repeatable: false,
        last_purchased_at: null,
        created_at: now,
        updated_at: now,
        sort_by_section: true,
      };
      return {
        status: 200,
        body: { success: true, list },
        effects: (session) => [
          session
            .prepare(
              "INSERT INTO List(id,family_id,created_by,name,type,description,image_url,created_at,updated_at) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?8)",
            )
            .bind(
              list.id,
              list.family_id,
              list.created_by,
              list.name,
              list.type,
              list.description,
              list.image_url,
              now.getTime(),
            ),
        ],
      };
    },
  });
}
/** Shared pure read/SQL plan, usable only after the caller's current authority. */
export async function prepareD1ListItem(
  db: D1ReadClient,
  actor: AssistantProofActor,
  input: NewListItem,
  receiptId: string | null,
  now: Date,
  groceryOnly = false,
): Promise<NativePersonPlan> {
  const list = await db.list.findFirst({
    where: { id: input.listId, family_id: actor.familyId },
    select: { id: true, type: true },
  });
  if (!list || (groceryOnly && !isGroceryListType(list.type)))
    return { status: 404, body: { error: "List not found" } };
  const ingredient = input.ingredient_id
    ? await db.ingredient.findFirst({
        where: { id: input.ingredient_id, family_id: actor.familyId },
        select: { id: true, name: true, section: true },
      })
    : null;
  if (input.ingredient_id && !ingredient)
    return { status: 400, body: { error: "Ingredient not found" } };
  const recovered = receiptId
    ? await db.listItem.findFirst({
        where: {
          list_id: list.id,
          added_by: actor.userId,
          source_request_id: receiptId,
        },
      })
    : null;
  const max = recovered
    ? null
    : await db.listItem.findFirst({
        where: { list_id: list.id },
        orderBy: { position: "desc" },
        select: { position: true },
      });
  if (!recovered && max && max.position >= 2147483647)
    return {
      status: 409,
      body: { error: "This list has reached its item position limit" },
    };
  const item = recovered ?? {
    id: randomUUID(),
    list_id: list.id,
    content: input.content,
    checked: false,
    quantity: input.quantity || 1,
    price: null,
    purchased: false,
    category: input.category || null,
    notes: input.notes || null,
    added_by: actor.userId,
    checked_by: null,
    checked_at: null,
    position: (max?.position || 0) + 1,
    created_at: now,
    updated_at: now,
    ingredient_id: input.ingredient_id ?? null,
    recipe_id: null,
    meal_id: null,
    amount: input.amount ?? null,
    unit: input.unit ?? null,
    source: "manual",
    source_key: null,
    source_request_id: receiptId,
  };
  const section = isGroceryListType(list.type)
    ? sectionsFor(
        [{ content: item.content, ingredient }],
        await readD1SectionOverrides(db, actor.familyId, [item]),
      )[0]
    : undefined;
  return {
    status: 200,
    body: { success: true, item: { ...item, ...(section ? { section } : {}) } },
    effects: (session) =>
      recovered
        ? []
        : [
            session
              .prepare(
                "INSERT INTO ListItem(id,list_id,content,quantity,category,notes,added_by,position,created_at,updated_at,ingredient_id,amount,unit,source_request_id) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?9,?10,?11,?12,?13)",
              )
              .bind(
                item.id,
                item.list_id,
                item.content,
                item.quantity,
                item.category,
                item.notes,
                item.added_by,
                item.position,
                now.getTime(),
                item.ingredient_id,
                item.amount,
                item.unit,
                receiptId,
              ),
          ],
  };
}
export function createD1ListItem(
  actor: AssistantProofActor,
  input: NewListItem,
  key: string | null,
  sourceGuard?: AssistantSourceGuard,
  database?: D1Store,
) {
  const now = new Date();
  return executeD1PersonEffect({
    actor,
    action: "list-item.add",
    input,
    key,
    sourceGuard,
    database,
    now,
    authorize: async (db) => {
      const denied = await authorizeD1Lists(db, actor);
      if (denied) return denied;
      const list = await db.list.findFirst({
        where: { id: input.listId, family_id: actor.familyId },
        select: { type: true },
      });
      return !list || (sourceGuard && !isGroceryListType(list.type))
        ? { status: 404, body: { error: "List not found" } }
        : null;
    },
    plan: (db, receiptId) =>
      prepareD1ListItem(db, actor, input, receiptId, now, Boolean(sourceGuard)),
  });
}

export async function updateD1ListItem(
  actor: AssistantProofActor,
  input: import("@/lib/list-item-update").ListItemUpdate,
  key: string | null,
  action: "list-item.update" | "list-item.edit" = "list-item.update",
  database?: D1Store,
) {
  const now = new Date();
  return executeD1PersonEffect({
    actor,
    action,
    input,
    key,
    database,
    now,
    authorize: async (db) => {
      const denied = await authorizeD1Lists(db, actor);
      if (denied) return denied;
      if (action === "list-item.edit") {
        const item = await db.listItem.findUnique({
          where: { id: input.itemId },
          select: { list_id: true },
        });
        if (!item) return { status: 404, body: { error: "Item not found" } };
        if (
          !(await db.list.findFirst({
            where: { id: item.list_id, family_id: actor.familyId },
            select: { id: true },
          }))
        )
          return { status: 403, body: { error: "Forbidden" } };
      }
      return null;
    },
    plan: async (db) => {
      const item = await db.listItem.findUnique({
        where: { id: input.itemId },
      });
      if (!item) return { status: 404, body: { error: "Item not found" } };
      const list = await db.list.findFirst({
        where: { id: item.list_id, family_id: actor.familyId },
        select: { id: true, type: true },
      });
      if (!list) return { status: 403, body: { error: "Forbidden" } };
      if (
        input.expectedUpdatedAt !== undefined &&
        new Date(input.expectedUpdatedAt).getTime() !==
          item.updated_at.getTime()
      )
        return {
          status: 409,
          body: {
            error: {
              code: "LIST_ITEM_CHANGED",
              message:
                "This item changed. Refresh the list and review it before saving.",
              retryable: false,
            },
          },
        };
      if (
        input.ingredient_id &&
        !(await db.ingredient.findFirst({
          where: { id: input.ingredient_id, family_id: actor.familyId },
          select: { id: true },
        }))
      )
        return { status: 400, body: { error: "Ingredient not found" } };
      const changes: Partial<typeof item> = {};
      if (
        typeof input.checked === "boolean" &&
        input.checked !== item.checked
      ) {
        changes.checked = input.checked;
        changes.checked_by = input.checked ? actor.userId : null;
        changes.checked_at = input.checked ? now : null;
      }
      for (const field of [
        "content",
        "quantity",
        "category",
        "notes",
        "amount",
        "unit",
        "ingredient_id",
      ] as const)
        if (input[field] !== undefined)
          Object.assign(changes, { [field]: input[field] });
      if (Object.keys(changes).length)
        changes.updated_at = new Date(
          Math.max(now.getTime(), item.updated_at.getTime() + 1),
        );
      const updated = { ...item, ...changes };
      if (!updated.checked && updated.ingredient_id && updated.source_key) {
        const duplicate = await db.listItem.findFirst({
          where: {
            id: { not: item.id },
            list_id: item.list_id,
            checked: false,
            ingredient_id: updated.ingredient_id,
            source_key: updated.source_key,
          },
          select: { id: true },
        });
        if (duplicate)
          return {
            status: 409,
            body: {
              error: {
                code: "DUPLICATE_OPEN_ITEM",
                message: "This item is already on the list and not yet ticked.",
                retryable: false,
              },
            },
          };
      }
      const { prepareD1SectionTick } = await import("./list-section-tick");
      const tick =
        changes.checked === true && isGroceryListType(list.type)
          ? await prepareD1SectionTick(
              db,
              actor.familyId,
              list.id,
              updated.content,
              updated.ingredient_id,
              now,
            )
          : null;
      return {
        status: 200,
        body: { success: true, item: updated },
        effects: (session) => {
          const entries = Object.entries(changes),
            effects = [];
          if (entries.length)
            effects.push(
              session
                .prepare(
                  `UPDATE ListItem SET ${entries.map(([name], index) => `"${name}"=?${index + 1}`).join(",")} WHERE id=?${entries.length + 1} AND list_id=?${entries.length + 2}`,
                )
                .bind(
                  ...entries.map(([, value]) =>
                    value instanceof Date
                      ? value.getTime()
                      : typeof value === "boolean"
                        ? Number(value)
                        : (value as string | number | null),
                  ),
                  item.id,
                  list.id,
                ),
            );
          if (tick) effects.push(...tick(session));
          return effects;
        },
      };
    },
  });
}
export function deleteD1ListItem(
  actor: AssistantProofActor,
  itemId: string,
  database?: D1Store,
) {
  return executeD1PersonEffect({
    actor,
    action: "list-item.delete",
    input: { itemId },
    key: null,
    database,
    authorize: async (db) => {
      const denied = await authorizeD1Lists(db, actor);
      return (
        denied ??
        (actor.role === "parent"
          ? null
          : {
              status: 403,
              body: { error: "Only parents can perform this action" },
            })
      );
    },
    plan: async (db) => {
      const item = await db.listItem.findUnique({
        where: { id: itemId },
        select: { list_id: true },
      });
      if (
        !item ||
        !(await db.list.findFirst({
          where: { id: item.list_id, family_id: actor.familyId },
          select: { id: true },
        }))
      )
        return { status: 404, body: { error: "Item not found" } };
      return {
        status: 200,
        body: { success: true },
        effects: (session) => [
          session
            .prepare(
              "DELETE FROM ListItem WHERE id=?1 AND list_id IN (SELECT id FROM List WHERE family_id=?2)",
            )
            .bind(itemId, actor.familyId),
        ],
      };
    },
  });
}
export function resolveD1DefaultGrocery(
  actor: AssistantProofActor,
  database?: D1Store,
) {
  const now = new Date();
  return executeD1PersonEffect({
    actor,
    action: "grocery.resolve-default",
    input: {},
    key: null,
    database,
    now,
    authorize: (db) => authorizeD1Lists(db, actor, true),
    plan: async (db) => {
      for (const type of ["grocery", "shopping"]) {
        const found = await db.list.findFirst({
          where: { family_id: actor.familyId, type },
          orderBy: [{ updated_at: "desc" }, { id: "asc" }],
          select: { id: true, name: true, type: true },
        });
        if (found)
          return { status: 200, body: { list: found, created: false } };
      }
      const list = { id: randomUUID(), name: "Groceries", type: "grocery" };
      return {
        status: 200,
        body: { list, created: true },
        effects: (session) => [
          session
            .prepare(
              "INSERT INTO List(id,family_id,name,type,created_by,created_at,updated_at) VALUES (?1,?2,?3,?4,?5,?6,?6)",
            )
            .bind(
              list.id,
              actor.familyId,
              list.name,
              list.type,
              actor.userId,
              now.getTime(),
            ),
        ],
      };
    },
  });
}
