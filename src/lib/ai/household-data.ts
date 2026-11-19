/**
 * The minimum household context an AI feature may use, read for the caller's
 * own household only: current people (for aliasing and mapping back) and the
 * names of grocery/shopping lists. Ids and names stay on our server; only
 * placeholders and list names are sent to a provider.
 */
import type { PrismaClient } from "@prisma/client";
import type { D1Store } from "@/lib/cloudflare/database";
import { readD1HouseholdPeople } from "@/lib/cloudflare/event-participants";
import { readHouseholdPeople } from "@/lib/event-participants-db";
import { isGroceryListType } from "@/lib/grocery-display";
import { buildAliasTable } from "./aliases";
import { isD1 } from "./household-setting";
import {
  SMART_ADD_LIST_NAME_MAX,
  SMART_ADD_MAX_LISTS,
  type SmartAddHousehold,
  type SmartAddPerson,
} from "./smart-add";

export async function loadSmartAddHousehold(
  db: D1Store | PrismaClient,
  familyId: string,
): Promise<SmartAddHousehold> {
  let peopleMap: Map<
    string,
    { kind: "account" | "profile"; id: string; name: string }
  >;
  let lists: Array<{ id: string; name: string; type: string | null }>;
  if (isD1(db)) {
    const session = db.withSession("first-primary");
    peopleMap = await readD1HouseholdPeople(session, familyId);
    const rows = await session
      .prepare(
        `SELECT id,name,type FROM "List" WHERE family_id=?1 ORDER BY created_at ASC,id ASC LIMIT 100`,
      )
      .bind(familyId)
      .all<{ id: string; name: string; type: string | null }>();
    lists = rows.results;
  } else {
    peopleMap = await readHouseholdPeople(db, familyId);
    lists = await db.list.findMany({
      where: { family_id: familyId },
      orderBy: [{ created_at: "asc" }, { id: "asc" }],
      select: { id: true, name: true, type: true },
      take: 100,
    });
  }
  const people = new Map<string, SmartAddPerson>();
  const inputs: Array<{ key: string; name: string }> = [];
  for (const person of peopleMap.values()) {
    const key = `${person.kind}:${person.id}`;
    people.set(key, { kind: person.kind, id: person.id, name: person.name });
    inputs.push({ key, name: person.name });
  }
  return {
    table: buildAliasTable(inputs),
    people,
    lists: lists
      .filter((l) => isGroceryListType(l.type) && l.name.trim())
      .slice(0, SMART_ADD_MAX_LISTS)
      .map((l) => ({
        id: l.id,
        name: l.name.trim().slice(0, SMART_ADD_LIST_NAME_MAX),
      })),
  };
}
