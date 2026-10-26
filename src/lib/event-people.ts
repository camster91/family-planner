/** Current same-household creator names; scalar event history is retained. */
import type { Prisma } from "@prisma/client";
type Person = { id: string; name: string };
export async function projectEventCreators<T extends { created_by: string }>(
  db: Pick<Prisma.TransactionClient, "user">, familyId: string, rows: T[],
): Promise<Array<T & { creator: Person | null }>> {
  const result: Array<T & { creator: Person | null }> = [];
  for (let offset = 0; offset < rows.length; offset += 100) {
    const batch = rows.slice(offset, offset + 100);
    const ids = [...new Set(batch.map(row => row.created_by).filter(id => typeof id === "string" && id.length > 0))];
    const people = ids.length ? await db.user.findMany({
      where: { family_id: familyId, id: { in: ids } },
      select: { id: true, name: true, family_id: true }, take: ids.length,
    }) : [];
    const visible = new Map(people.filter(person => person.family_id === familyId && ids.includes(person.id))
      .map(person => [person.id, { id: person.id, name: person.name }]));
    for (const row of batch) result.push({ ...row, creator: visible.get(row.created_by) ?? null });
  }
  return result;
}
