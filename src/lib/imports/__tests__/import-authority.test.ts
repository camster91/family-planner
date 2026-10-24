// Authored for deferred QA. Serial fixtures do not prove PostgreSQL lock races.
import type { Prisma, PrismaClient } from "@prisma/client";
import { HouseholdMemberIdentityConflict } from "@/lib/household-member-lifecycle";
import { ImportSessionChangedError, lockImportAuthorityInTx, recordImportFailure, startImportJob } from "../import-authority";
import { log } from "@/lib/logger";
jest.mock("@/lib/logger", () => ({ log: { warn: jest.fn() } }));
type User = { id: string; family_id: string | null; role: string; token_version: number };
const actor: User = { id: "fixture-parent", family_id: "fixture-family", role: "parent", token_version: 2 };
const mapped: User = { id: "fixture-child", family_id: "fixture-family", role: "child", token_version: 0 };
const authority = { familyId: "fixture-family", startedBy: actor.id, sessionVersion: 2, mappedUserIds: [mapped.id, mapped.id] };
function fixture(users: User[] = [actor, mapped]) {
  const trace: unknown[] = [];
  const create = jest.fn(async () => { trace.push("create-job"); return { id: "fixture-job" }; });
  const updateMany = jest.fn(async () => ({ count: 0 }));
  const tx = {
    $queryRaw: jest.fn(async (strings: TemplateStringsArray, ...values: unknown[]) => {
      const sql = strings.join("?");
      if (sql.includes("pg_advisory_xact_lock")) { trace.push(values[0]); return [{ locked: 1 }]; }
      trace.push({ sql, values }); return users;
    }),
    family: { findUnique: jest.fn(async () => ({ id: authority.familyId })) },
    importJob: { create, updateMany },
  };
  const transaction = jest.fn(async (run: (client: typeof tx) => unknown) => run(tx));
  return { tx: tx as unknown as Prisma.TransactionClient,
    db: { $transaction: transaction } as unknown as Pick<PrismaClient, "$transaction">,
    trace, create, updateMany, transaction };
}
it("takes sorted distinct user locks, household then bound current User row locks before creating a job", async () => {
  const f = fixture();
  await startImportJob(f.db, authority, "chore-champs", "1");
  expect(f.trace.slice(0, 3)).toEqual([
    "user-membership:fixture-child", "user-membership:fixture-parent", "household-membership:fixture-family",
  ]);
  expect(f.trace[3]).toEqual({
    sql: expect.stringContaining('ORDER BY "id" FOR UPDATE'),
    values: [["fixture-child", "fixture-parent"]],
  });
  expect(f.trace[4]).toBe("create-job");
  expect(f.create).toHaveBeenCalledWith({ data: {
    family_id: authority.familyId, started_by: actor.id, source_app: "chore-champs",
    source_version: "1", dry_run: false, status: "running",
  } });
});
it("refuses a revoked session before recording a job", async () => {
  const f = fixture([{ ...actor, token_version: 3 }, mapped]);
  await expect(startImportJob(f.db, authority, "chore-champs", "1")).rejects.toBeInstanceOf(ImportSessionChangedError);
  expect(f.create).not.toHaveBeenCalled();
});
it.each([
  [mapped],
  [{ ...actor, role: "teen" }, mapped],
  [{ ...actor, family_id: "fixture-other" }, mapped],
  [actor, { ...mapped, family_id: "fixture-other" }],
  [actor],
].map(users => ({ users })))("refuses changed/missing/foreign actor or mapped participants", async ({ users }) => {
  const f = fixture(users);
  await expect(lockImportAuthorityInTx(f.tx, authority)).rejects.toBeInstanceOf(HouseholdMemberIdentityConflict);
});
it("retains internal caller compatibility while requiring current parent/household membership", async () => {
  const f = fixture([actor]);
  await lockImportAuthorityInTx(f.tx, { familyId: authority.familyId, startedBy: actor.id });
  expect(f.create).not.toHaveBeenCalled();
});
it("only marks the owned still-running job failed and stores no exception payload", async () => {
  const f = fixture();
  await recordImportFailure(f.db, authority.familyId, "budget-app", "fixture-job");
  expect(f.updateMany).toHaveBeenCalledWith({
    where: { id: "fixture-job", family_id: authority.familyId, source_app: "budget-app", status: "running" },
    data: { status: "failed", completed_at: expect.any(Date), error: "Import failed or outcome unconfirmed; inspect canonical records." },
  });
});
it("does not replace the original import error if failure accounting is unavailable", async () => {
  const f = fixture(); f.transaction.mockRejectedValueOnce(new Error("fabricated private database detail"));
  await expect(recordImportFailure(f.db, authority.familyId, "budget-app", "fixture-job")).resolves.toBeUndefined();
  expect(log.warn).toHaveBeenCalledWith("imports.failure_status_unavailable", { code: "FAILURE_STATUS_UNAVAILABLE" });
});
