/** Current import authority, separate from source-data review or reconciliation. */
import type { Prisma, PrismaClient } from "@prisma/client";
import { lockHousehold, lockUser } from "@/lib/household-lock";
import { HouseholdMemberIdentityConflict } from "@/lib/household-member-lifecycle";
import { log } from "@/lib/logger";
export type ImportAuthority = {
  familyId: string;
  startedBy: string;
  /** HTTP callers bind the originally verified session generation. */
  sessionVersion?: number;
  mappedUserIds?: readonly string[];
};
export class ImportSessionChangedError extends Error {
  constructor() {
    super("Import session changed");
    this.name = "ImportSessionChangedError";
  }
}
/** User advisory locks in stable order, then household, then current User rows.
 * Row locks also fence ordinary role/session UPDATEs that do not use advisory
 * locks. Nothing takes another User advisory lock after acquiring household. */
export async function lockImportAuthorityInTx(
  tx: Prisma.TransactionClient,
  authority: ImportAuthority,
) {
  const ids = [
    ...new Set([authority.startedBy, ...(authority.mappedUserIds ?? [])]),
  ].sort();
  for (const id of ids) await lockUser(tx, id);
  await lockHousehold(tx, authority.familyId);
  const users = await tx.$queryRaw<
    Array<{
      id: string;
      family_id: string | null;
      role: string;
      token_version: number;
    }>
  >`SELECT "id", "family_id", "role", "token_version" FROM "User"
      WHERE "id" = ANY(${ids}::text[]) ORDER BY "id" FOR UPDATE`;
  const actor = users.find((user) => user.id === authority.startedBy);
  if (
    actor &&
    authority.sessionVersion !== undefined &&
    actor.token_version !== authority.sessionVersion
  )
    throw new ImportSessionChangedError();
  if (
    !actor ||
    actor.family_id !== authority.familyId ||
    actor.role !== "parent" ||
    users.length !== ids.length ||
    users.some((user) => user.family_id !== authority.familyId)
  )
    throw new HouseholdMemberIdentityConflict();
  // The actor FK and row check above do not replace household existence.
  const family = await tx.family.findUnique({
    where: { id: authority.familyId },
    select: { id: true },
  });
  if (!family) throw new HouseholdMemberIdentityConflict();
}
type Db = Pick<PrismaClient, "$transaction">;
export function startImportJob(
  db: Db,
  authority: ImportAuthority,
  sourceApp: string,
  sourceVersion: string,
) {
  return db.$transaction(async (tx) => {
    await lockImportAuthorityInTx(tx, authority);
    return tx.importJob.create({
      data: {
        family_id: authority.familyId,
        source_app: sourceApp,
        source_version: sourceVersion,
        status: "running",
        dry_run: false,
        started_by: authority.startedBy,
      },
    });
  });
}
/** Operational failure accounting only. A deleted or completed job stays so;
 * failure to record cannot mask the original import refusal/error. */
export async function recordImportFailure(
  db: Db,
  familyId: string,
  sourceApp: string,
  jobId: string,
) {
  try {
    await db.$transaction(async (tx) => {
      await lockHousehold(tx, familyId);
      await tx.importJob.updateMany({
        where: {
          id: jobId,
          family_id: familyId,
          source_app: sourceApp,
          status: "running",
        },
        data: {
          status: "failed",
          completed_at: new Date(),
          error:
            "Import failed or outcome unconfirmed; inspect canonical records.",
        },
      });
    });
  } catch {
    log.warn("imports.failure_status_unavailable", {
      code: "FAILURE_STATUS_UNAVAILABLE",
    });
  }
}
