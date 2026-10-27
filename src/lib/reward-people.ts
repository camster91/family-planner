/** Household-scoped display names for reward reads. Scalar history is retained;
 * a stale User relation never authorizes reading that person's current name.
 */
import type { Prisma } from "@prisma/client";
type RewardPeopleSource = { created_by: string; claimed_by: string | null };
type Person = { id: string; name: string };
export async function projectRewardPeople<T extends RewardPeopleSource>(
  db: Pick<Prisma.TransactionClient, "user">,
  familyId: string,
  rows: T[],
): Promise<Array<T & { creator: Person | null; claimer: Person | null }>> {
  const result: Array<T & { creator: Person | null; claimer: Person | null }> = [];
  // Page reads need one small batch. Legacy unpaged responses keep their
  // contract, but each related-person lookup still has a bounded ID list.
  for (let offset = 0; offset < rows.length; offset += 100) {
    const batch = rows.slice(offset, offset + 100);
    const ids = [...new Set(batch.flatMap(row => [row.created_by, row.claimed_by]).filter((id): id is string => typeof id === "string" && id.length > 0))];
    const people = ids.length ? await db.user.findMany({
      where: { family_id: familyId, id: { in: ids } },
      select: { id: true, name: true, family_id: true }, take: ids.length,
    }) : [];
    const visible = new Map(people.filter(person => person.family_id === familyId && ids.includes(person.id))
      .map(person => [person.id, { id: person.id, name: person.name }]));
    for (const row of batch) result.push({ ...row,
      creator: visible.get(row.created_by) ?? null,
      claimer: row.claimed_by ? visible.get(row.claimed_by) ?? null : null,
    });
  }
  return result;
}

/** Receipt snapshots are history, never authority for related-person names. */
export async function projectRewardMutationPeople(
  db: Pick<Prisma.TransactionClient, "user">,
  familyId: string,
  envelope: unknown,
): Promise<Record<string, unknown>> {
  if (!envelope || typeof envelope !== "object" || Array.isArray(envelope)) throw new Error("Reward response held");
  const body = envelope as Record<string, unknown>;
  const value = body.reward;
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Reward response held");
  const reward = value as Record<string, unknown>;
  if (reward.family_id !== familyId || typeof reward.created_by !== "string" || !reward.created_by
      || !(reward.claimed_by === null || (typeof reward.claimed_by === "string" && reward.claimed_by.length > 0)))
    throw new Error("Reward response held");
  // Drop both cached relation objects before projection, including extra fields
  // carried by older stored responses. Scalar receipt history is unchanged.
  const { creator: _creator, claimer: _claimer, ...scalars } = reward;
  const [projected] = await projectRewardPeople(db, familyId, [{ ...scalars,
    created_by: reward.created_by, claimed_by: reward.claimed_by as string | null,
  }]);
  return { ...body, reward: projected };
}
