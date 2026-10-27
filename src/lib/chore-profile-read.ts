/** Read-only canonical chore subject hydration. Action eligibility remains separate. */
import type { PrismaClient } from "@prisma/client";
export const CHORE_PROFILE_READ_BATCH = 200;
export type HydratedProfileMember = {
  id: string
  family_id: string
  name: string
  role: string
  age: number | null
  archived_at: Date | null
  erasure_user_id: string | null
  legacy_mapping: { user_id: string } | null
  account_link: { user_id: string } | null
}

export type ProfileHydrated<T> = T & { assigneeMember?: HydratedProfileMember | null }

/** Only requested own-household profiles, bounded independently of the board cap.
 * Archived profiles are retained for history; current action checks stay downstream.
 */
export async function hydrateChoreProfileMembers<T extends { assigned_member_id?: string | null }>(
  db: Pick<PrismaClient, "householdMember">,
  familyId: string,
  rows: readonly T[],
): Promise<ProfileHydrated<T>[]> {
  const ids = [...new Set(rows.flatMap(row => row.assigned_member_id != null ? [row.assigned_member_id] : []))];
  const byId = new Map<string, HydratedProfileMember>();
  for (let offset = 0; offset < ids.length; offset += CHORE_PROFILE_READ_BATCH) {
    const batch = ids.slice(offset, offset + CHORE_PROFILE_READ_BATCH);
    const requested = new Set(batch);
    const members = await db.householdMember.findMany({
      where: { family_id: familyId, id: { in: batch } },
      take: batch.length,
      select: {
        id: true, family_id: true, name: true, role: true, age: true,
        archived_at: true, erasure_user_id: true,
        legacy_mapping: { select: { user_id: true } },
        account_link: { select: { user_id: true } },
      },
    });
    if (members.length > batch.length) throw new Error("Chore profile read exceeded its bound");
    for (const member of members) {
      if (member.family_id !== familyId || !requested.has(member.id) || byId.has(member.id))
        throw new Error("Invalid chore profile read scope");
      byId.set(member.id, member);
    }
  }
  return rows.map(row => ({
    ...row,
    assigneeMember: row.assigned_member_id != null ? byId.get(row.assigned_member_id) ?? null : undefined,
  }));
}
