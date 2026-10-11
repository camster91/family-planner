/** #480 fixture-only reconciliation; not runtime dual writes or activation. */
import type { Client, PoolClient } from "pg";
export class ChoreMemberRehearsalError extends Error {
  readonly code: string;
  constructor(code: string) {
    super(code);
    this.code = code;
    this.name = "ChoreMemberRehearsalError";
  }
}

type Subject = {
  id: string;
  assigned_to: string;
  assigned_member_id: string | null;
  member_subject_erased: boolean;
  member_id: string | null;
  account_family: string | null;
  member_family: string | null;
  erasure_user_id: string | null;
  linked_user_id: string | null;
};

/** Caller owns an idle client on a guarded disposable database; CLI enforces the guard. */
export async function rehearseChoreMembers(
  db: Client | PoolClient,
  familyId: string,
  apply = false,
) {
  if (!/^fx_[a-zA-Z0-9_-]+$/.test(familyId))
    throw new ChoreMemberRehearsalError("FIXTURE_FAMILY_REQUIRED");
  await db.query("BEGIN");
  try {
    const family = await db.query(
      'SELECT id FROM "Family" WHERE id = $1 FOR UPDATE',
      [familyId],
    );
    if (family.rowCount !== 1)
      throw new ChoreMemberRehearsalError("FAMILY_NOT_FOUND");
    const groups: Array<{
      table: "Chore" | "ChoreAssignment";
      rows: Subject[];
    }> = [];
    for (const table of ["Chore", "ChoreAssignment"] as const) {
      const result = await db.query<Subject>(
        `SELECT c.id,c.assigned_to,c.assigned_member_id,c.member_subject_erased,
        m.member_id,u.family_id AS account_family,p.family_id AS member_family,p.erasure_user_id,l.user_id AS linked_user_id
        FROM "${table}" c LEFT JOIN "User" u ON u.id=c.assigned_to
        LEFT JOIN "HouseholdMemberLegacyMapping" m ON m.user_id=c.assigned_to AND m.family_id=c.family_id
        LEFT JOIN "HouseholdMember" p ON p.id=m.member_id
        LEFT JOIN "HouseholdMemberAccountLink" l ON l.member_id=m.member_id
        WHERE c.family_id=$1 ORDER BY c.id FOR UPDATE OF c`,
        [familyId],
      );
      for (const row of result.rows) {
        if (
          !/^fx_[a-zA-Z0-9_-]+$/.test(row.id) ||
          !/^fx_[a-zA-Z0-9_-]+$/.test(row.assigned_to)
        )
          throw new ChoreMemberRehearsalError("NON_FIXTURE_SUBJECT");
        if (row.member_subject_erased) {
          if (row.assigned_member_id !== null)
            throw new ChoreMemberRehearsalError("ERASURE_CONFLICT");
          continue; // A sticky erasure is not an unmapped row to repair.
        }
        if (
          !row.member_id ||
          row.account_family !== familyId ||
          row.member_family !== familyId ||
          row.erasure_user_id !== null ||
          (row.linked_user_id && row.linked_user_id !== row.assigned_to)
        )
          throw new ChoreMemberRehearsalError(
            "SUBJECT_RECONCILIATION_REQUIRED",
          );
        if (row.assigned_member_id && row.assigned_member_id !== row.member_id)
          throw new ChoreMemberRehearsalError("SUBJECT_CONFLICT");
      }
      groups.push({ table, rows: result.rows });
    }
    const report = {
      choresScanned: groups[0].rows.length,
      assignmentsScanned: groups[1].rows.length,
      subjectsPlanned: 0,
      subjectsWritten: 0,
      erasedSubjectsSkipped: 0,
    };
    for (const group of groups)
      for (const row of group.rows) {
        if (row.member_subject_erased) {
          report.erasedSubjectsSkipped++;
          continue;
        }
        if (row.assigned_member_id !== null) continue;
        report.subjectsPlanned++;
        if (apply) {
          const changed = await db.query(
            `UPDATE "${group.table}" SET assigned_member_id=$1 WHERE id=$2 AND family_id=$3 AND assigned_to=$4 AND assigned_member_id IS NULL AND NOT member_subject_erased`,
            [row.member_id, row.id, familyId, row.assigned_to],
          );
          if (changed.rowCount !== 1)
            throw new ChoreMemberRehearsalError("SUBJECT_CONFLICT");
          report.subjectsWritten++;
        }
      }
    await db.query(apply ? "COMMIT" : "ROLLBACK");
    return report;
  } catch (error) {
    await db.query("ROLLBACK");
    throw error;
  }
}
