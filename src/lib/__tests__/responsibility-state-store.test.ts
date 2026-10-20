/** Column-codec/CAS source cases; fake statements do not prove FK or atomicity. */
import type { Prisma } from "@prisma/client";
import { RESPONSIBILITY_PROTOCOL } from "@/lib/responsibility";
import {
  decodeResponsibilityRow,
  readResponsibilityStateInTx,
  persistResponsibilityStateInTx,
  type ResponsibilityRow,
} from "@/lib/responsibility-state-store";
const row: ResponsibilityRow = {
  id: "state-a",
  protocol: RESPONSIBILITY_PROTOCOL,
  family_id: "family-a",
  chore_id: "chore-a",
  pickup_id: null,
  handoff_id: null,
  source_token: "a".repeat(64),
  revision: 1,
  coordinator_id: null,
  backup_account_id: "backup-a",
  backup_member_id: null,
  primary_subject_account_id: "user-a",
  primary_subject_member_id: null,
  primary_decision: "accepted",
  primary_by_id: "user-a",
  primary_method: "self",
  primary_at: new Date("2026-10-20T16:00:00Z"),
  backup_decision: null,
  backup_by_id: null,
  backup_method: null,
  backup_at: null,
};
it("decodes historical statement identity from its own FKs, not a later canonical owner or display name", () => {
  const { state } = decodeResponsibilityRow(row);
  expect(state.primaryStatement).toEqual({
    subject: { kind: "account", accountId: "user-a" },
    decision: "accepted",
    byAccountId: "user-a",
    method: "self",
    at: "2026-10-20T16:00:00.000Z",
  });
  expect(state.backup).toEqual({
    subject: { kind: "account", accountId: "backup-a" },
    statement: null,
  });
});
it.each([
  { protocol: "future" },
  { handoff_id: "handoff-a" },
  { primary_at: null },
  { primary_subject_member_id: "profile-a" },
  { backup_method: "self" },
])(
  "holds unknown or contradictory stored columns without rewriting %j",
  (patch) => {
    expect(() => decodeResponsibilityRow({ ...row, ...patch })).toThrow(
      "UNSUPPORTED",
    );
  },
);
function fixture(rows = [row], count = 1) {
  const query = jest.fn(async () => rows),
    execute = jest.fn(async () => count);
  return {
    tx: {
      $queryRaw: query,
      $executeRaw: execute,
    } as unknown as Prisma.TransactionClient,
    query,
    execute,
  };
}
it("refuses a wrong-household/target adapter result and locks a matching read", async () => {
  const target = { kind: "chore" as const, id: "chore-a" };
  const good = fixture();
  expect(
    (await readResponsibilityStateInTx(good.tx, "family-a", target))?.id,
  ).toBe(row.id);
  const foreign = fixture([{ ...row, family_id: "family-b" }]);
  await expect(
    readResponsibilityStateInTx(foreign.tx, "family-a", target),
  ).rejects.toThrow("NOT_FOUND");
  expect(good.execute).not.toHaveBeenCalled();
});
it("CAS updates only an exact known target/protocol/revision and never deletes or replaces on conflict", async () => {
  const state = { ...decodeResponsibilityRow(row).state, revision: 2 };
  const good = fixture();
  expect(await persistResponsibilityStateInTx(good.tx, state, 1, row.id)).toBe(
    row.id,
  );
  const call = good.execute.mock.calls as unknown as Array<
    [TemplateStringsArray, ...unknown[]]
  >;
  const sql = call[0][0].join("?");
  expect(sql).toContain('UPDATE "ResponsibilityState"');
  expect(sql).toContain('"revision" = ?');
  expect(sql).toContain('"chore_id" IS NOT DISTINCT FROM ?');
  expect(sql).not.toContain("DELETE");
  expect(sql).not.toContain('UPDATE "Chore"');
  const lost = fixture([], 0);
  await expect(
    persistResponsibilityStateInTx(lost.tx, state, 1, row.id),
  ).rejects.toThrow("CONFLICT");
  expect(lost.execute).toHaveBeenCalledTimes(1);
});
it("does not create a replacement for a missing nonzero revision or write an unknown protocol", async () => {
  const f = fixture();
  const state = decodeResponsibilityRow(row).state;
  await expect(
    persistResponsibilityStateInTx(f.tx, { ...state, revision: 2 }, 1, null),
  ).rejects.toThrow("CONFLICT");
  await expect(
    persistResponsibilityStateInTx(
      f.tx,
      { ...state, protocol: "future" },
      0,
      null,
    ),
  ).rejects.toThrow("UNSUPPORTED");
  expect(f.execute).not.toHaveBeenCalled();
});
