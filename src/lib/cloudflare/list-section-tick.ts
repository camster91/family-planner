import { randomUUID } from "node:crypto";
import {
  SHOPPING_SESSION_GAP_MS,
  SHOPPING_SESSION_RETENTION_MS,
  sectionsFor,
} from "@/lib/grocery-section-store";
import type { D1ReadClient } from "./read-client";
import type { D1Store, D1Statement } from "./database";
import { readD1SectionOverrides } from "./list-read";
/** Capture the trip state beside the actual tick. A duplicate/no-op never calls this plan. */
export async function prepareD1SectionTick(
  db: D1ReadClient,
  familyId: string,
  listId: string,
  content: string,
  ingredientId: string | null,
  at: Date,
): Promise<(session: Pick<D1Store, "prepare">) => D1Statement[]> {
  const ingredient = ingredientId
    ? await db.ingredient.findFirst({
        where: { id: ingredientId, family_id: familyId },
        select: { name: true, section: true },
      })
    : null;
  const [section] = sectionsFor(
    [{ content, ingredient }],
    await readD1SectionOverrides(db, familyId, [{ content }]),
  );
  const current = await db.groceryShoppingSession.findFirst({
    where: {
      family_id: familyId,
      list_id: listId,
      last_tick_at: { gte: new Date(at.getTime() - SHOPPING_SESSION_GAP_MS) },
    },
    orderBy: { last_tick_at: "desc" },
    select: { id: true, sections: true, last_tick_at: true },
  });
  if (current) {
    if (
      !Array.isArray(current.sections) ||
      !current.sections.every((value) => typeof value === "string")
    )
      throw new Error("Invalid stored shopping sections");
    const sections = current.sections.includes(section)
      ? current.sections
      : [...current.sections, section];
    return (session) => [
      session
        .prepare(
          "UPDATE GroceryShoppingSession SET sections=?1,last_tick_at=?2 WHERE id=?3 AND family_id=?4 AND list_id=?5",
        )
        .bind(
          JSON.stringify(sections),
          Math.max(at.getTime(), current.last_tick_at.getTime()),
          current.id,
          familyId,
          listId,
        ),
    ];
  }
  const id = randomUUID();
  return (session) => [
    session
      .prepare(
        "DELETE FROM GroceryShoppingSession WHERE family_id=?1 AND last_tick_at<?2",
      )
      .bind(familyId, at.getTime() - SHOPPING_SESSION_RETENTION_MS),
    session
      .prepare(
        "INSERT INTO GroceryShoppingSession(id,family_id,list_id,sections,started_at,last_tick_at) VALUES (?1,?2,?3,?4,?5,?5)",
      )
      .bind(id, familyId, listId, JSON.stringify([section]), at.getTime()),
  ];
}
