import { randomUUID } from "node:crypto";
import type { AssistantProofActor } from "@/lib/assistant-source-proof";
import { canChangeListSectionSort } from "@/lib/role-capabilities";
import { isGroceryListType } from "@/lib/grocery-display";
import { sectionNameKey, type GrocerySectionId } from "@/lib/grocery-sections";
import { sectionsFor } from "@/lib/grocery-section-store";
import { executeD1PersonEffect } from "./person-effect";
import { authorizeD1Lists } from "./list-authority";
import { readD1SectionOverrides } from "./list-read";
import type { D1Store, D1Statement } from "./database";
const fail = (status: number, code: string, message: string) => ({
  status,
  body: { error: { code, message, retryable: false } },
});
export function setD1ListSectionSort(
  actor: AssistantProofActor,
  input: { listId: string; sortBySection: boolean },
  database?: D1Store,
) {
  const now = new Date();
  return executeD1PersonEffect({
    actor,
    action: "list.section-sort",
    input,
    key: null,
    database,
    now,
    authorize: async (db) => {
      const denied = await authorizeD1Lists(db, actor);
      return (
        denied ??
        (canChangeListSectionSort(actor.role)
          ? null
          : fail(
              403,
              "SECTION_SORT_FORBIDDEN",
              "Ask a parent or teen to change how this list is sorted.",
            ))
      );
    },
    plan: async (db) => {
      const list = await db.list.findFirst({
        where: { id: input.listId, family_id: actor.familyId },
        select: {
          id: true,
          type: true,
          sort_by_section: true,
          updated_at: true,
        },
      });
      if (!list) return fail(404, "LIST_NOT_FOUND", "List not found");
      if (!isGroceryListType(list.type))
        return fail(
          400,
          "LIST_NOT_GROCERY",
          "Store sections are only for grocery and shopping lists.",
        );
      return {
        status: 200,
        body: { listId: list.id, sortBySection: input.sortBySection },
        effects: (session) =>
          list.sort_by_section === input.sortBySection
            ? []
            : [
                session
                  .prepare(
                    "UPDATE List SET sort_by_section=?1,updated_at=?2 WHERE id=?3 AND family_id=?4",
                  )
                  .bind(
                    Number(input.sortBySection),
                    Math.max(now.getTime(), list.updated_at.getTime() + 1),
                    list.id,
                    actor.familyId,
                  ),
              ],
      };
    },
  });
}
export function moveD1ListItemSection(
  actor: AssistantProofActor,
  input: { itemId: string; section: GrocerySectionId | null },
  database?: D1Store,
) {
  const now = new Date();
  return executeD1PersonEffect({
    actor,
    action: "list-item.section",
    input,
    key: null,
    database,
    now,
    authorize: (db) => authorizeD1Lists(db, actor),
    plan: async (db) => {
      const item = await db.listItem.findUnique({
        where: { id: input.itemId },
        select: { id: true, list_id: true, content: true, ingredient_id: true },
      });
      const list = item
        ? await db.list.findFirst({
            where: { id: item.list_id, family_id: actor.familyId },
            select: { id: true, type: true },
          })
        : null;
      if (!item || !list) return fail(404, "ITEM_NOT_FOUND", "Item not found");
      if (!isGroceryListType(list.type))
        return fail(
          400,
          "LIST_NOT_GROCERY",
          "Store sections are only for grocery and shopping lists.",
        );
      const nameKey = sectionNameKey(item.content);
      if (!nameKey) return fail(404, "ITEM_NOT_FOUND", "Item not found");
      const siblings = await db.listItem.findMany({
        where: { list_id: list.id },
        select: { id: true, content: true, ingredient_id: true },
      });
      const affected = siblings.filter(
        (row) =>
          sectionNameKey(row.content) === nameKey ||
          (item.ingredient_id !== null &&
            row.ingredient_id === item.ingredient_id),
      );
      const ingredientIds = [
        ...new Set(
          affected.flatMap((row) =>
            row.ingredient_id ? [row.ingredient_id] : [],
          ),
        ),
      ];
      const ingredients = new Map<
        string,
        { name: string; section: string | null }
      >();
      for (let i = 0; i < ingredientIds.length; i += 60)
        for (const row of await db.ingredient.findMany({
          where: {
            family_id: actor.familyId,
            id: { in: ingredientIds.slice(i, i + 60) },
          },
          select: { id: true, name: true, section: true },
        }))
          ingredients.set(row.id, {
            name: row.name,
            section:
              row.id === item.ingredient_id ? input.section : row.section,
          });
      const overrides = await readD1SectionOverrides(
        db,
        actor.familyId,
        affected,
      );
      if (input.section) overrides[nameKey] = input.section;
      else delete overrides[nameKey];
      const resolved = sectionsFor(
          affected.map((row) => ({
            ...row,
            ingredient: row.ingredient_id
              ? (ingredients.get(row.ingredient_id) ?? null)
              : null,
          })),
          overrides,
        ),
        sections = Object.fromEntries(
          affected.map((row, index) => [row.id, resolved[index]]),
        );
      return {
        status: 200,
        body: { nameKey, override: input.section, sections },
        effects: (session) => {
          const effects: D1Statement[] = [];
          if (input.section)
            effects.push(
              session
                .prepare(
                  "INSERT INTO GrocerySectionPreference(id,family_id,name_key,section,updated_by,updated_at) VALUES (?1,?2,?3,?4,?5,?6) ON CONFLICT(family_id,name_key) DO UPDATE SET section=excluded.section,updated_by=excluded.updated_by,updated_at=excluded.updated_at",
                )
                .bind(
                  randomUUID(),
                  actor.familyId,
                  nameKey,
                  input.section,
                  actor.userId,
                  now.getTime(),
                ),
            );
          else
            effects.push(
              session
                .prepare(
                  "DELETE FROM GrocerySectionPreference WHERE family_id=?1 AND name_key=?2",
                )
                .bind(actor.familyId, nameKey),
            );
          const ingredient = item.ingredient_id
            ? ingredients.get(item.ingredient_id)
            : null;
          if (ingredient)
            effects.push(
              session
                .prepare(
                  "UPDATE Ingredient SET section=?1 WHERE id=?2 AND family_id=?3",
                )
                .bind(input.section, item.ingredient_id, actor.familyId),
            );
          return effects;
        },
      };
    },
  });
}
