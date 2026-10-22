/** Personal list page: current actor, bounded rows and section metadata in one snapshot. */
import type { PrismaClient } from "@prisma/client";
import { listVersion } from "./list-version";
import { isGroceryListType } from "./grocery-display";
import { GROCERY_SECTIONS } from "./grocery-sections";
import {
  SECTION_INGREDIENT_SELECT,
  loadSectionOrder,
  loadSectionOverrides,
  sectionsFor,
} from "./grocery-section-store";
import {
  afterListItemCursor,
  encodeListItemCursor,
  LIST_ITEM_PAGE_ORDER,
  type ListItemPaging,
} from "./list-item-paging";
type Actor = {
  userId: string;
  familyId: string;
  role: string;
  tokenVersion: number;
};
export async function readListDetailPage(
  db: Pick<PrismaClient, "$transaction">,
  actor: Actor,
  listId: string,
  paging: Extract<ListItemPaging, { paged: true }>,
) {
  if (
    !["parent", "teen", "child"].includes(actor.role) ||
    !Number.isSafeInteger(actor.tokenVersion) ||
    actor.tokenVersion < 0
  )
    return { state: "forbidden" } as const;
  return db.$transaction(
    async (tx) => {
      const user = await tx.user.findUnique({
        where: { id: actor.userId },
        select: { family_id: true, role: true, token_version: true },
      });
      if (
        !user ||
        user.family_id !== actor.familyId ||
        user.role !== actor.role ||
        user.token_version !== actor.tokenVersion
      )
        return { state: "forbidden" } as const;
      const list = await tx.list.findFirst({
        where: { id: listId, family_id: actor.familyId },
        include: { creator: { select: { name: true, avatar_url: true } } },
      });
      if (!list) return { state: "missing" } as const;
      const rows = await tx.listItem.findMany({
        where: {
          list_id: listId,
          list: { family_id: actor.familyId },
          ...(paging.cursor ? afterListItemCursor(paging.cursor) : {}),
        },
        include: {
          adder: { select: { name: true, avatar_url: true } },
          checker: { select: { name: true } },
          recipe: { select: { title: true } },
          ingredient: SECTION_INGREDIENT_SELECT,
        },
        orderBy: LIST_ITEM_PAGE_ORDER,
        take: paging.limit + 1,
      });
      const items = rows.slice(0, paging.limit);
      const grocery = isGroceryListType(list.type);
      const overrides = grocery
        ? await loadSectionOverrides(tx, actor.familyId, items)
        : {};
      const sections = grocery ? sectionsFor(items, overrides) : [];
      const sectionOrder = grocery
        ? await loadSectionOrder(tx, actor.familyId)
        : { order: [...GROCERY_SECTIONS], learned: false };
      return {
        state: "available",
        list,
        items,
        overrides,
        sections,
        sectionOrder,
        // Include the lookahead so a new next page changes the poll version too.
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
    { isolationLevel: "RepeatableRead" },
  );
}
