/** Canonical list summaries only: counts, not hydrated item rows or content. */
import type { PrismaClient } from "@prisma/client";
import { canCreateList } from "./role-capabilities";
type Actor = {
  userId: string;
  familyId: string;
  role: string;
  tokenVersion: number;
};
export type ListOverview = {
  familyName: string;
  canCreate: boolean;
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
      const lists = await tx.list.findMany({
        where: { family_id: actor.familyId },
        include: {
          _count: { select: { items: true } },
          creator: { select: { name: true } },
        },
        orderBy: [{ updated_at: "desc" }, { id: "asc" }],
      });
      const checked = lists.length
        ? await tx.listItem.groupBy({
            by: ["list_id"],
            where: {
              checked: true,
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
