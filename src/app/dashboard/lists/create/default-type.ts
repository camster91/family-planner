import { getServerActor } from "@/lib/supabase/server";
import { prisma } from "@/lib/prisma";
import { readListOverview } from "@/lib/list-overview";
import { parseListPaging } from "@/lib/list-paging";

/**
 * The type a new list starts as: To-do when the household already has a
 * grocery list, else Grocery (the form's own default, returned as undefined).
 * Reads through the shared list overview, so D1 and Postgres answer alike; a
 * failed read keeps the plain default.
 */
export async function readDefaultNewListType(): Promise<"todo" | undefined> {
  try {
    const actor = await getServerActor();
    if (!actor?.family_id || !actor.role) return undefined;
    const paging = parseListPaging(new URLSearchParams({ limit: "1" }), {
      familyId: actor.family_id,
      type: "grocery",
    });
    if (!paging.ok || !paging.paged) return undefined;
    const overview = await readListOverview(
      prisma!,
      {
        userId: actor.id,
        familyId: actor.family_id,
        role: actor.role,
        tokenVersion: actor.tokenVersion,
      },
      { type: "grocery", paging },
    );
    return (overview?.typeCounts.grocery ?? 0) > 0 ? "todo" : undefined;
  } catch {
    console.warn("New list default type read failed");
    return undefined;
  }
}
