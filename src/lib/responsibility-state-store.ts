/** Private transaction primitives, not an authenticated endpoint. Caller locks
 * current actor/household/target first and commits the effect + receipt together. */
import { randomUUID } from "node:crypto";
import type { Prisma } from "@prisma/client";
import {
  responsibilityState,
  ResponsibilityError,
  type ResponsibilityState,
  type ResponsibilityTarget,
  type ResponsibilitySubject,
} from "@/lib/responsibility";
export type ResponsibilityRow = {
  id: string;
  protocol: string;
  family_id: string;
  chore_id: string | null;
  pickup_id: string | null;
  handoff_id: string | null;
  source_token: string;
  revision: number;
  coordinator_id: string | null;
  backup_account_id: string | null;
  backup_member_id: string | null;
  primary_subject_account_id: string | null;
  primary_subject_member_id: string | null;
  primary_decision: string | null;
  primary_by_id: string | null;
  primary_method: string | null;
  primary_at: Date | null;
  backup_decision: string | null;
  backup_by_id: string | null;
  backup_method: string | null;
  backup_at: Date | null;
};
function subject(
  accountId: string | null,
  memberId: string | null,
): ResponsibilitySubject | null {
  if (accountId && memberId) throw new ResponsibilityError("UNSUPPORTED");
  return accountId
    ? { kind: "account", accountId }
    : memberId
      ? { kind: "profile", memberId }
      : null;
}
export function decodeResponsibilityRow(row: ResponsibilityRow): {
  id: string;
  state: ResponsibilityState;
} {
  try {
    const refs = [row.chore_id, row.pickup_id, row.handoff_id].filter(
      (value) => value !== null,
    );
    if (refs.length !== 1) throw new Error("Ambiguous target");
    const primary = subject(
      row.primary_subject_account_id,
      row.primary_subject_member_id,
    );
    const backup = subject(row.backup_account_id, row.backup_member_id);
    const primaryParts = [
      primary,
      row.primary_decision,
      row.primary_by_id,
      row.primary_method,
      row.primary_at,
    ];
    const backupParts = [
      row.backup_decision,
      row.backup_by_id,
      row.backup_method,
      row.backup_at,
    ];
    if (
      primaryParts.some((value) => value !== null) &&
      primaryParts.some((value) => value === null)
    )
      throw new Error("Partial statement");
    if (
      backupParts.some((value) => value !== null) &&
      (!backup || backupParts.some((value) => value === null))
    )
      throw new Error("Partial statement");
    const state = responsibilityState.parse({
      protocol: row.protocol,
      familyId: row.family_id,
      target: {
        kind: row.chore_id ? "chore" : row.pickup_id ? "pickup" : "handoff",
        id: refs[0],
      },
      sourceToken: row.source_token,
      revision: row.revision,
      coordinator: row.coordinator_id
        ? { kind: "account", accountId: row.coordinator_id }
        : null,
      primaryStatement: primary
        ? {
            subject: primary,
            decision: row.primary_decision,
            byAccountId: row.primary_by_id,
            method: row.primary_method,
            at: row.primary_at!.toISOString(),
          }
        : null,
      backup: backup
        ? {
            subject: backup,
            statement:
              row.backup_decision === null
                ? null
                : {
                    subject: backup,
                    decision: row.backup_decision,
                    byAccountId: row.backup_by_id,
                    method: row.backup_method,
                    at: row.backup_at!.toISOString(),
                  },
          }
        : null,
    });
    if (!row.id) throw new Error("Missing identity");
    return { id: row.id, state };
  } catch {
    throw new ResponsibilityError("UNSUPPORTED");
  }
}
export async function readResponsibilityStateInTx(
  tx: Prisma.TransactionClient,
  familyId: string,
  target: ResponsibilityTarget,
) {
  const rows = await tx.$queryRaw<ResponsibilityRow[]>`
    SELECT "id", "protocol", "family_id", "chore_id", "pickup_id", "handoff_id", "source_token", "revision", "coordinator_id",
      "backup_account_id", "backup_member_id", "primary_subject_account_id", "primary_subject_member_id",
      "primary_decision", "primary_by_id", "primary_method", "primary_at", "backup_decision", "backup_by_id", "backup_method", "backup_at"
    FROM "ResponsibilityState" WHERE "family_id" = ${familyId} AND
      ((${target.kind} = 'chore' AND "chore_id" = ${target.id}) OR (${target.kind} = 'pickup' AND "pickup_id" = ${target.id}) OR (${target.kind} = 'handoff' AND "handoff_id" = ${target.id}))
    FOR UPDATE`;
  if (rows.length > 1) throw new ResponsibilityError("UNSUPPORTED");
  if (!rows[0]) return null;
  const decoded = decodeResponsibilityRow(rows[0]);
  if (
    decoded.state.familyId !== familyId ||
    decoded.state.target.kind !== target.kind ||
    decoded.state.target.id !== target.id
  )
    throw new ResponsibilityError("NOT_FOUND");
  return decoded;
}
function columns(state: ResponsibilityState) {
  const primary = state.primaryStatement,
    backup = state.backup;
  return {
    choreId: state.target.kind === "chore" ? state.target.id : null,
    pickupId: state.target.kind === "pickup" ? state.target.id : null,
    handoffId: state.target.kind === "handoff" ? state.target.id : null,
    coordinator: state.coordinator?.accountId ?? null,
    backupAccount:
      backup?.subject.kind === "account" ? backup.subject.accountId : null,
    backupMember:
      backup?.subject.kind === "profile" ? backup.subject.memberId : null,
    primaryAccount:
      primary?.subject.kind === "account" ? primary.subject.accountId : null,
    primaryMember:
      primary?.subject.kind === "profile" ? primary.subject.memberId : null,
    primaryDecision: primary?.decision ?? null,
    primaryBy: primary?.byAccountId ?? null,
    primaryMethod: primary?.method ?? null,
    primaryAt: primary ? new Date(primary.at) : null,
    backupDecision: backup?.statement?.decision ?? null,
    backupBy: backup?.statement?.byAccountId ?? null,
    backupMethod: backup?.statement?.method ?? null,
    backupAt: backup?.statement ? new Date(backup.statement.at) : null,
  };
}
/** Apply only a changed planner result after fresh permission/source checks.
 * CAS + target FKs refuse stale, erased, foreign and future-protocol writes.
 * Never deletes/recreates metadata on conflict or performs a domain mutation. */
export async function persistResponsibilityStateInTx(
  tx: Prisma.TransactionClient,
  raw: unknown,
  expectedRevision: number,
  existingId: string | null,
) {
  const parsed = responsibilityState.safeParse(raw);
  if (!parsed.success) throw new ResponsibilityError("UNSUPPORTED");
  const state = parsed.data;
  if (
    !Number.isInteger(expectedRevision) ||
    expectedRevision < 0 ||
    state.revision !== expectedRevision + 1 ||
    (!existingId && expectedRevision !== 0)
  )
    throw new ResponsibilityError("CONFLICT");
  const c = columns(state),
    id = existingId ?? randomUUID();
  const count = existingId
    ? await tx.$executeRaw`UPDATE "ResponsibilityState" SET
      "source_token" = ${state.sourceToken}, "revision" = ${state.revision}, "coordinator_id" = ${c.coordinator},
      "backup_account_id" = ${c.backupAccount}, "backup_member_id" = ${c.backupMember},
      "primary_subject_account_id" = ${c.primaryAccount}, "primary_subject_member_id" = ${c.primaryMember},
      "primary_decision" = ${c.primaryDecision}, "primary_by_id" = ${c.primaryBy}, "primary_method" = ${c.primaryMethod}, "primary_at" = ${c.primaryAt},
      "backup_decision" = ${c.backupDecision}, "backup_by_id" = ${c.backupBy}, "backup_method" = ${c.backupMethod}, "backup_at" = ${c.backupAt}, "updated_at" = CURRENT_TIMESTAMP
      WHERE "id" = ${id} AND "family_id" = ${state.familyId} AND "protocol" = ${state.protocol} AND "revision" = ${expectedRevision}
        AND "chore_id" IS NOT DISTINCT FROM ${c.choreId} AND "pickup_id" IS NOT DISTINCT FROM ${c.pickupId} AND "handoff_id" IS NOT DISTINCT FROM ${c.handoffId}`
    : await tx.$executeRaw`INSERT INTO "ResponsibilityState"
      ("id", "protocol", "family_id", "chore_id", "pickup_id", "handoff_id", "source_token", "revision", "coordinator_id", "backup_account_id", "backup_member_id",
       "primary_subject_account_id", "primary_subject_member_id", "primary_decision", "primary_by_id", "primary_method", "primary_at", "backup_decision", "backup_by_id", "backup_method", "backup_at")
      VALUES (${id}, ${state.protocol}, ${state.familyId}, ${c.choreId}, ${c.pickupId}, ${c.handoffId}, ${state.sourceToken}, ${state.revision}, ${c.coordinator}, ${c.backupAccount}, ${c.backupMember},
        ${c.primaryAccount}, ${c.primaryMember}, ${c.primaryDecision}, ${c.primaryBy}, ${c.primaryMethod}, ${c.primaryAt}, ${c.backupDecision}, ${c.backupBy}, ${c.backupMethod}, ${c.backupAt})
      ON CONFLICT DO NOTHING`;
  if (count !== 1) throw new ResponsibilityError("CONFLICT");
  return id;
}
