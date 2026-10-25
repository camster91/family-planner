/** Strict original review contract and atomic source guard. Currently no HTTP
 * endpoint uses it. Requires the caller's freshly authenticated parent and
 * ordered User/household/actual principal locks BEFORE this chore row lock.
 */
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { memberIdentityIdSchema as id } from "@/lib/member-subject-contract";
import { CHORE_CHECK_COMMAND_PROTOCOL, CHORE_CHECK_EPOCH_MAX, CHORE_CHECK_GENERATION, type ChoreCheckOwner, type ChoreCheckSnapshot } from "@/lib/chore-check-command-shared";
const epoch = z.number().int().min(0).max(CHORE_CHECK_EPOCH_MAX - 1);
export const choreCheckCommandSchema = z.object({
  protocol: z.literal(CHORE_CHECK_COMMAND_PROTOCOL),
  owner: z.object({ userId: id, familyId: id, role: z.literal("parent"), generation: z.number().int().nonnegative() }).strict(),
  choreId: id,
  expected: z.object({ generation: z.string().regex(CHORE_CHECK_GENERATION), materialEpoch: epoch, completionEpoch: epoch }).strict(),
  decision: z.enum(["approve", "reject"]), verificationNotes: z.string().max(500).trim().optional(),
}).strict();
/** Precondition comparison only; the authenticated principal is server supplied. */
export function choreCheckOwnerMatches(owner: ChoreCheckOwner, actor: { userId: string; familyId: string; role: string; tokenVersion: number }): boolean {
  return owner.userId === actor.userId && owner.familyId === actor.familyId && owner.role === actor.role && owner.generation === actor.tokenVersion;
}
export async function lockOriginalChoreCheckInTx(
  tx: Prisma.TransactionClient, familyId: string, choreId: string, snapshot: ChoreCheckSnapshot,
): Promise<boolean> {
  // Validate even for internal callers: exhausted epochs cannot distinguish ABA.
  const parsed = choreCheckCommandSchema.shape.expected.safeParse(snapshot);
  if (!parsed.success) return false;
  const expected = parsed.data;
  const rows = await tx.$queryRaw<Array<{ id: string }>>`
    SELECT "id" FROM "Chore" WHERE "id" = ${choreId} AND "family_id" = ${familyId}
    AND "status" = 'completed' AND "responsibility_generation" = ${expected.generation}
    AND "responsibility_epoch" = ${expected.materialEpoch} AND "preparation_epoch" = ${expected.completionEpoch}
    FOR UPDATE`;
  return rows.length === 1;
}
