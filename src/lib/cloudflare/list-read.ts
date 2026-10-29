import type { AssistantProofActor } from "@/lib/assistant-source-proof";
import { canCreateList } from "@/lib/role-capabilities";
import { LIST_TYPE_KEYS, type ListTypeKey } from "@/lib/list-type-filter";
import {
  afterListCursor,
  encodeListCursor,
  type ListPaging,
} from "@/lib/list-paging";
import {
  afterListItemCursor,
  encodeListItemCursor,
  LIST_ITEM_PAGE_ORDER,
  type ListItemPaging,
} from "@/lib/list-item-paging";
import { listVersion } from "@/lib/list-version";
import { isGroceryListType } from "@/lib/grocery-display";
import {
  GROCERY_SECTIONS,
  sectionNameKey,
  isGrocerySection,
  sectionOrder,
  type GrocerySectionId,
} from "@/lib/grocery-sections";
import { sectionsFor } from "@/lib/grocery-section-store";
import { captureD1Reads } from "./read-witness";
import { getD1Database, type D1Store } from "./database";
import type { D1ReadClient, NativeD1 } from "./read-client";
import { isD1WriteConflict } from "./write-check";
import { authorizeD1Lists } from "./list-authority";
type Item = Awaited<ReturnType<D1ReadClient["listItem"]["findMany"]>>[number];
export async function readD1SectionOverrides(
  db: D1ReadClient,
  familyId: string,
  rows: readonly { content: string }[],
) {
  const keys = [
      ...new Set(
        rows.map((row) => sectionNameKey(row.content)).filter(Boolean),
      ),
    ],
    result: Record<string, GrocerySectionId> = {};
  for (let offset = 0; offset < keys.length; offset += 60) {
    const values = await db.grocerySectionPreference.findMany({
      where: {
        family_id: familyId,
        name_key: { in: keys.slice(offset, offset + 60) },
      },
      select: { name_key: true, section: true },
    });
    for (const value of values)
      if (isGrocerySection(value.section))
        result[value.name_key] = value.section;
  }
  return result;
}
export async function readD1SectionOrder(db: D1ReadClient, familyId: string) {
  const sessions = await db.groceryShoppingSession.findMany({
    where: { family_id: familyId },
    orderBy: { last_tick_at: "desc" },
    take: 20,
    select: { sections: true },
  });
  return sectionOrder(
    sessions.map((row) => {
      if (
        !Array.isArray(row.sections) ||
        !row.sections.every((value) => typeof value === "string")
      )
        throw new Error("Invalid stored shopping sections");
      return row.sections as string[];
    }),
  );
}
export async function hydrateD1ListItems(
  db: D1ReadClient,
  familyId: string,
  items: Item[],
) {
  const peopleIds = [
      ...new Set(
        items.flatMap((item) => [
          item.added_by,
          ...(item.checked_by ? [item.checked_by] : []),
        ]),
      ),
    ],
    ingredientIds = [
      ...new Set(
        items.flatMap((item) =>
          item.ingredient_id ? [item.ingredient_id] : [],
        ),
      ),
    ],
    recipeIds = [
      ...new Set(
        items.flatMap((item) => (item.recipe_id ? [item.recipe_id] : [])),
      ),
    ];
  const people = new Map<string, { name: string; avatar_url: string | null }>(),
    ingredients = new Map<string, { name: string; section: string | null }>(),
    recipes = new Map<string, { title: string }>();
  for (let i = 0; i < peopleIds.length; i += 60)
    for (const row of await db.user.findMany({
      where: { id: { in: peopleIds.slice(i, i + 60) }, family_id: familyId },
      select: { id: true, name: true, avatar_url: true },
    }))
      people.set(row.id, { name: row.name, avatar_url: row.avatar_url });
  for (let i = 0; i < ingredientIds.length; i += 60)
    for (const row of await db.ingredient.findMany({
      where: {
        id: { in: ingredientIds.slice(i, i + 60) },
        family_id: familyId,
      },
      select: { id: true, name: true, section: true },
    }))
      ingredients.set(row.id, { name: row.name, section: row.section });
  for (let i = 0; i < recipeIds.length; i += 60)
    for (const row of await db.recipe.findMany({
      where: { id: { in: recipeIds.slice(i, i + 60) }, family_id: familyId },
      select: { id: true, title: true },
    }))
      recipes.set(row.id, { title: row.title });
  return items.map((item) => ({
    ...item,
    adder: people.get(item.added_by) ?? {
      name: "Family member",
      avatar_url: null,
    },
    checker:
      item.checked_by && people.has(item.checked_by)
        ? { name: people.get(item.checked_by)!.name }
        : null,
    ingredient: item.ingredient_id
      ? (ingredients.get(item.ingredient_id) ?? null)
      : null,
    recipe: item.recipe_id ? (recipes.get(item.recipe_id) ?? null) : null,
  }));
}
async function readSnapshot<T>(
  actor: AssistantProofActor,
  read: (db: D1ReadClient) => Promise<T>,
  database?: D1Store,
) {
  const store = database ?? (await getD1Database()),
    session = store.withSession("first-primary");
  for (let attempt = 0; attempt < 12; attempt++) {
    const captured = await captureD1Reads(
      async (db) => {
        const denied = await authorizeD1Lists(db, actor);
        return denied
          ? { denied, value: undefined }
          : { denied: null, value: await read(db) };
      },
      store as unknown as NativeD1,
    );
    try {
      await session.batch(captured.checks(session));
      return captured.value;
    } catch (cause) {
      if (!isD1WriteConflict(cause)) throw cause;
    }
  }
  throw new Error("List snapshot changed too many times");
}
export async function readD1ListOverview(
  actor: AssistantProofActor,
  options: {
    type: ListTypeKey | null;
    paging: Extract<ListPaging, { paged: true }>;
  },
  database?: D1Store,
) {
  const snapshot = await readSnapshot(
    actor,
    async (db) => {
      const { type, paging } = options,
        scope = { familyId: actor.familyId, type },
        family = await db.family.findUnique({
          where: { id: actor.familyId },
          select: { name: true },
        });
      const rows = await db.list.findMany({
          where: {
            family_id: actor.familyId,
            ...(type ? { type } : {}),
            ...(paging.cursor ? afterListCursor(paging.cursor) : {}),
          },
          orderBy: [{ created_at: "desc" }, { id: "asc" }],
          take: paging.limit + 1,
        }),
        lists = rows.slice(0, paging.limit);
      const { creators, totals, checked } = await listCounts(
        db,
        actor.familyId,
        lists,
      );
      const groups = await db.list.groupBy({
        by: ["type"],
        where: { family_id: actor.familyId, type: { in: [...LIST_TYPE_KEYS] } },
        _count: { _all: true },
      });
      return {
        familyName: family?.name ?? "",
        canCreate: canCreateList(actor.role),
        nextCursor:
          rows.length > paging.limit
            ? encodeListCursor(scope, lists[lists.length - 1])
            : null,
        typeCounts: Object.fromEntries(
          LIST_TYPE_KEYS.map((key) => [
            key,
            groups.find((row) => row.type === key)?._count._all ?? 0,
          ]),
        ) as Record<ListTypeKey, number>,
        lists: lists.map((list) => {
          const total =
              totals.find((row) => row.list_id === list.id)?._count._all ?? 0,
            checkedCount =
              checked.find((row) => row.list_id === list.id)?._count._all ?? 0;
          if (checkedCount > total)
            throw new Error("Invalid list snapshot counts");
          return {
            id: list.id,
            name: list.name,
            image_url: list.image_url,
            type: list.type,
            description: list.description,
            updated_at: list.updated_at,
            creator: {
              name:
                creators.find((row) => row.id === list.created_by)?.name ??
                "Family member",
            },
            _count: { items: total },
            checked_count: checkedCount,
            total_count: total,
          };
        }),
      };
    },
    database,
  );
  return snapshot.denied ? null : snapshot.value!;
}
export async function readD1ListDetail(
  actor: AssistantProofActor,
  listId: string,
  paging: Extract<ListItemPaging, { paged: true }>,
  database?: D1Store,
) {
  const snapshot = await readSnapshot(
    actor,
    async (db) => {
      const row = await db.list.findFirst({
        where: { id: listId, family_id: actor.familyId },
      });
      if (!row) return { state: "missing" } as const;
      const creator = await db.user.findFirst({
          where: { id: row.created_by, family_id: actor.familyId },
          select: { name: true, avatar_url: true },
        }),
        list = {
          ...row,
          creator: creator ?? { name: "Family member", avatar_url: null },
        };
      const rows = await db.listItem.findMany({
          where: {
            list_id: listId,
            ...(paging.cursor ? afterListItemCursor(paging.cursor) : {}),
          },
          orderBy: LIST_ITEM_PAGE_ORDER,
          take: paging.limit + 1,
        }),
        items = await hydrateD1ListItems(
          db,
          actor.familyId,
          rows.slice(0, paging.limit),
        ),
        grocery = isGroceryListType(list.type),
        overrides = grocery
          ? await readD1SectionOverrides(db, actor.familyId, items)
          : {},
        sections = grocery ? sectionsFor(items, overrides) : [],
        order = grocery
          ? await readD1SectionOrder(db, actor.familyId)
          : { order: [...GROCERY_SECTIONS], learned: false };
      return {
        state: "available",
        list,
        items,
        overrides,
        sections,
        sectionOrder: order,
        version: listVersion(list, rows),
        nextCursor:
          rows.length > paging.limit
            ? encodeListItemCursor(
                { familyId: actor.familyId, listId },
                items[items.length - 1],
              )
            : null,
      } as const;
    },
    database,
  );
  return snapshot.denied ? { state: "forbidden" as const } : snapshot.value!;
}
export async function readD1ListVersion(
  actor: AssistantProofActor,
  listId: string,
  paging: ListItemPaging & { ok: true },
  database?: D1Store,
) {
  const snapshot = await readSnapshot(
    actor,
    async (db) => {
      const list = await db.list.findFirst({
        where: { id: listId, family_id: actor.familyId },
        select: { id: true, updated_at: true },
      });
      if (!list) return null;
      const items = await db.listItem.findMany({
        where: {
          list_id: listId,
          ...(paging.paged && paging.cursor
            ? afterListItemCursor(paging.cursor)
            : {}),
        },
        select: { id: true, updated_at: true },
        ...(paging.paged
          ? { orderBy: LIST_ITEM_PAGE_ORDER, take: paging.limit + 1 }
          : {}),
      });
      return { version: listVersion(list, items) };
    },
    database,
  );
  return (
    snapshot.denied ??
    (snapshot.value
      ? { status: 200, body: snapshot.value }
      : { status: 404, body: { error: "List not found" } })
  );
}

/** Fixed-size ID groups stay below D1's bind limit even at the 200-row page cap. */
async function listCounts(
  db: D1ReadClient,
  familyId: string,
  lists: { id: string; created_by: string }[],
) {
  const ids = lists.map((row) => row.id),
    creatorIds = [...new Set(lists.map((row) => row.created_by))];
  const creators: { id: string; name: string }[] = [],
    totals: { list_id: string; _count: { _all: number } }[] = [],
    checked: typeof totals = [];
  for (let i = 0; i < creatorIds.length; i += 60)
    creators.push(
      ...(await db.user.findMany({
        where: { family_id: familyId, id: { in: creatorIds.slice(i, i + 60) } },
        select: { id: true, name: true },
      })),
    );
  for (let i = 0; i < ids.length; i += 60) {
    const scope = { list_id: { in: ids.slice(i, i + 60) } };
    totals.push(
      ...(await db.listItem.groupBy({
        by: ["list_id"],
        where: scope,
        _count: { _all: true },
      })),
    );
    checked.push(
      ...(await db.listItem.groupBy({
        by: ["list_id"],
        where: { ...scope, checked: true },
        _count: { _all: true },
      })),
    );
  }
  return { creators, totals, checked };
}
export async function readD1ListIndex(
  actor: AssistantProofActor,
  type: string | null,
  paging: Extract<ListPaging, { ok: true }>,
  database?: D1Store,
) {
  const snapshot = await readSnapshot(
    actor,
    async (db) => {
      const rows = await db.list.findMany({
        where: {
          family_id: actor.familyId,
          ...(type ? { type } : {}),
          ...(paging.paged && paging.cursor
            ? afterListCursor(paging.cursor)
            : {}),
        },
        orderBy: paging.paged
          ? [{ created_at: "desc" }, { id: "asc" }]
          : { updated_at: "desc" },
        ...(paging.paged ? { take: paging.limit + 1 } : {}),
      });
      const lists = paging.paged ? rows.slice(0, paging.limit) : rows,
        { creators, totals } = await listCounts(db, actor.familyId, lists);
      return {
        lists: lists.map((row) => ({
          ...row,
          creator: {
            name:
              creators.find((value) => value.id === row.created_by)?.name ??
              "Family member",
          },
          _count: {
            items:
              totals.find((value) => value.list_id === row.id)?._count._all ??
              0,
          },
        })),
        ...(paging.paged
          ? {
              nextCursor:
                rows.length > paging.limit
                  ? encodeListCursor(
                      { familyId: actor.familyId, type },
                      lists[lists.length - 1],
                    )
                  : null,
            }
          : {}),
      };
    },
    database,
  );
  return snapshot.denied ?? { status: 200, body: snapshot.value! };
}
export async function readD1ListItemsApi(
  actor: AssistantProofActor,
  listId: string,
  paging: Extract<ListItemPaging, { ok: true }>,
  database?: D1Store,
) {
  const snapshot = await readSnapshot(
    actor,
    async (db) => {
      const list = await db.list.findUnique({
        where: { id: listId },
        select: { family_id: true, type: true, sort_by_section: true },
      });
      if (!list) return { status: 404, body: { error: "List not found" } };
      if (list.family_id !== actor.familyId)
        return { status: 403, body: { error: "Access denied" } };
      const rows = await db.listItem.findMany({
        where: {
          list_id: listId,
          ...(paging.paged && paging.cursor
            ? afterListItemCursor(paging.cursor)
            : {}),
        },
        orderBy: paging.paged
          ? LIST_ITEM_PAGE_ORDER
          : [{ checked: "asc" }, { position: "asc" }, { created_at: "asc" }],
        ...(paging.paged ? { take: paging.limit + 1 } : {}),
      });
      const shown = paging.paged ? rows.slice(0, paging.limit) : rows,
        page = paging.paged
          ? {
              nextCursor:
                rows.length > paging.limit
                  ? encodeListItemCursor(
                      { familyId: actor.familyId, listId },
                      shown[shown.length - 1],
                    )
                  : null,
            }
          : {};
      if (!isGroceryListType(list.type))
        return { status: 200, body: { items: shown, ...page } };
      const hydrated = await hydrateD1ListItems(db, actor.familyId, shown),
        sections = sectionsFor(
          hydrated,
          await readD1SectionOverrides(db, actor.familyId, shown),
        ),
        order = await readD1SectionOrder(db, actor.familyId);
      return {
        status: 200,
        body: {
          items: shown.map((row, index) => ({
            ...row,
            section: sections[index],
          })),
          sectionSort: {
            enabled: list.sort_by_section !== false,
            order: order.order,
            learned: order.learned,
          },
          ...page,
        },
      };
    },
    database,
  );
  return snapshot.denied ?? snapshot.value!;
}
