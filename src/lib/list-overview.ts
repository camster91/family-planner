/** Canonical list summaries only: counts, not hydrated item rows or content. */
import type { PrismaClient } from "@prisma/client";
import { canCreateList } from "./role-capabilities";
import {
  afterListCursor,
  encodeListCursor,
  type ListPaging,
} from "./list-paging";
import { LIST_TYPE_KEYS, type ListTypeKey } from "./list-type-filter";
type Actor = {
  userId: string;
  familyId: string;
  role: string;
  tokenVersion: number;
};
export type ListOverview = {
  familyName: string;
  canCreate: boolean;
  nextCursor: string | null;
  typeCounts: Record<ListTypeKey, number>;
  lists: Array<{
    id: string;
    name: string;
    image_url: string | null;
    type: string;
    description: string | null;
    updated_at: Date;
    creator: { name: string };
    _count: { items: number };
    checked_count: number;
    total_count: number;
  }>;
};
export async function readListOverview(
  db: Pick<PrismaClient, "$transaction">,
  actor: Actor,
  options: {
    type: ListTypeKey | null;
    paging: Extract<ListPaging, { paged: true }>;
  },
): Promise<ListOverview | null> {
  if (
    !["parent", "teen", "child"].includes(actor.role) ||
    !Number.isSafeInteger(actor.tokenVersion) ||
    actor.tokenVersion < 0
  )
    return null;
  return db.$transaction(
    async (tx) => {
      const user = await tx.user.findUnique({
        where: { id: actor.userId },
        select: {
          family_id: true,
          role: true,
          token_version: true,
          family: { select: { name: true } },
        },
      });
      if (
        !user ||
        user.family_id !== actor.familyId ||
        user.role !== actor.role ||
        user.token_version !== actor.tokenVersion ||
        !user.family
      )
        return null;
      const { type, paging } = options;
      const scope = { familyId: actor.familyId, type };
      const rows = await tx.list.findMany({
        where: {
          family_id: actor.familyId,
          ...(type ? { type } : {}),
          ...(paging.cursor ? afterListCursor(paging.cursor) : {}),
        },
        include: {
          _count: { select: { items: true } },
          creator: { select: { name: true } },
        },
        orderBy: [{ created_at: "desc" }, { id: "asc" }],
        take: paging.limit + 1,
      });
      const lists = rows.slice(0, paging.limit);
      // At most six fixed type groups; keep filter counts/discovery independent
      // of the current page without hydrating another collection of lists.
      const groups = await tx.list.groupBy({
        by: ["type"],
        where: { family_id: actor.familyId, type: { in: [...LIST_TYPE_KEYS] } },
        _count: { _all: true },
      });
      const typeCounts = Object.fromEntries(
        LIST_TYPE_KEYS.map((key) => [
          key,
          groups.find((row) => row.type === key)?._count._all ?? 0,
        ]),
      ) as Record<ListTypeKey, number>;
      const checked = lists.length
        ? await tx.listItem.groupBy({
            by: ["list_id"],
            where: {
              checked: true,
              list_id: { in: lists.map((list) => list.id) },
              list: { family_id: actor.familyId },
            },
            _count: { _all: true },
          })
        : [];
      const checkedByList = new Map<string, number>(
        checked.map((row) => [row.list_id, row._count._all]),
      );
      return {
        familyName: user.family.name,
        canCreate: canCreateList(user.role),
        typeCounts,
        nextCursor:
          rows.length > paging.limit
            ? encodeListCursor(scope, lists[lists.length - 1])
            : null,
        lists: lists.map((list) => {
          const checkedCount = checkedByList.get(list.id) ?? 0;
          if (checkedCount > list._count.items)
            throw new Error("List count snapshot inconsistent");
          return {
            id: list.id,
            name: list.name,
            image_url: list.image_url ?? null,
            type: list.type,
            description: list.description,
            updated_at: list.updated_at,
            creator: list.creator,
            _count: list._count,
            checked_count: checkedCount,
            total_count: list._count.items,
          };
        }),
      };
    },
    { isolationLevel: "RepeatableRead" },
  );
}
