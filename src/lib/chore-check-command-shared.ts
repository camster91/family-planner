/** Browser-safe original review snapshot. IDs/epochs are preconditions, never
 * authentication. No default epochs, timestamp guessing or name matching.
 */
export const CHORE_CHECK_COMMAND_PROTOCOL = "herewoven.chore-check-command.v1" as const;
export const CHORE_CHECK_EPOCH_MAX = 2147483647;
export const CHORE_CHECK_GENERATION = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export type ChoreCheckSnapshot = { generation: string; materialEpoch: number; completionEpoch: number };
export type ChoreCheckOwner = { userId: string; familyId: string; role: "parent"; generation: number };
export type ChoreCheckCommand = {
  protocol: typeof CHORE_CHECK_COMMAND_PROTOCOL; owner: ChoreCheckOwner; choreId: string;
  expected: ChoreCheckSnapshot; decision: "approve" | "reject"; verificationNotes?: string;
};
export function choreCheckVersion(row: {
  status?: unknown; responsibility_generation?: unknown; responsibility_epoch?: unknown; preparation_epoch?: unknown;
}): ChoreCheckSnapshot | null {
  const epoch = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && value < CHORE_CHECK_EPOCH_MAX;
  if (typeof row.responsibility_generation !== "string"
      || !CHORE_CHECK_GENERATION.test(row.responsibility_generation)
      || !epoch(row.responsibility_epoch) || !epoch(row.preparation_epoch)) return null;
  return { generation: row.responsibility_generation, materialEpoch: row.responsibility_epoch, completionEpoch: row.preparation_epoch };
}
export function choreCheckSnapshot(row: Parameters<typeof choreCheckVersion>[0]): ChoreCheckSnapshot | null {
  return row.status === "completed" ? choreCheckVersion(row) : null;
}
export const CHORE_CHECK_OWNER_HEADER = "X-Herewoven-Chore-Check-Owner";
export function sameChoreCheckSnapshot(left: ChoreCheckSnapshot, right: ChoreCheckSnapshot): boolean {
  return left.generation === right.generation && left.materialEpoch === right.materialEpoch && left.completionEpoch === right.completionEpoch;
}
