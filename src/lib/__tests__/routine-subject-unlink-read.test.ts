/** Authored/unrun. Dormant reader preparation, no database/account mutation. */
import type { Prisma } from "@prisma/client";
import { prepareRoutineSubjectUnlinkInTx } from "../routine-subject-unlink-read";
import { ROUTINE_UNLINK_MAX_ROOTS } from "../routine-subject-unlink";
const association = { familyId: "family-a", userId: "account-a", memberId: "profile-a" };
const root = (id: string, definition: unknown = { protocol: "future-unknown" }) => ({
  id, family_id: association.familyId, recurrence_id: id, routine_series_config: definition,
});
function reader(rows: unknown[], present = true) {
  const read = jest.fn().mockResolvedValueOnce([{ present }]).mockResolvedValueOnce(rows);
  return { read, tx: { $queryRaw: read } as unknown as Pick<Prisma.TransactionClient, "$queryRaw"> };
}
it("refuses invalid scope without reading storage", async () => {
  const { read, tx } = reader([]);
  expect(await prepareRoutineSubjectUnlinkInTx(tx, { ...association, userId: "" })).toEqual({ kind: "held", reason: "invalid-scope" });
  expect(read).not.toHaveBeenCalled();
});
it("holds absent routine storage instead of claiming no future work", async () => {
  const { read, tx } = reader([], false);
  expect(await prepareRoutineSubjectUnlinkInTx(tx, association)).toEqual({ kind: "held", reason: "storage-unavailable" });
  expect(read).toHaveBeenCalledTimes(1);
});
it("reads scoped, ordered and locked roots with one lookahead and no subject/protocol/state filters", async () => {
  const { read, tx } = reader([]);
  expect(await prepareRoutineSubjectUnlinkInTx(tx, association)).toEqual({
    kind: "ready", inspectedRoots: 0, unchangedRoots: 0, rewrites: [], stackIds: [],
  });
  const [strings, ...values] = read.mock.calls[1];
  const sql = strings.join("?");
  expect(sql).toContain('"family_id" = ?');
  expect(sql).toContain('"recurrence_id" = "id"');
  expect(sql).toContain('"routine_series_config" IS NOT NULL');
  expect(sql).toContain('ORDER BY "id" LIMIT ? FOR UPDATE');
  expect(sql).not.toMatch(/subject|protocol|state|->/);
  expect(values).toEqual([association.familyId, ROUTINE_UNLINK_MAX_ROOTS + 1]);
});
it("prepares supported roots without rewriting history or executing updates", async () => {
  const definition = {
    protocol: "herewoven.routine-step-series.v1", revision: 4, stack_id: "stack-a",
    state: "paused", effective_on: "2026-10-24", anchor: "After lunch",
    schedule: { frequency: "weekly", starts_on: "2026-10-24", weekly_days: [1, 3], monthly_day: null },
    content: { title: "Synthetic step", description: null,
      subject: { kind: "account", user_id: association.userId, member_id: association.memberId },
      points: 7, difficulty: "easy", icon: null, duration_minutes: 5 },
  };
  const { tx, read } = reader([root("root-a", definition)]);
  const result = await prepareRoutineSubjectUnlinkInTx(tx, association);
  expect(result).toMatchObject({ kind: "ready", inspectedRoots: 1, unchangedRoots: 0,
    stackIds: ["stack-a"], rewrites: [{ rootId: "root-a", previousRevision: 4,
      value: { revision: 5, state: "paused", content: { subject: { kind: "profile", member_id: association.memberId } } } }],
  });
  expect(definition.revision).toBe(4);
  expect(definition.content.subject.kind).toBe("account");
  expect(read).toHaveBeenCalledTimes(2);
});
it("holds an oversized inventory without returning partial rewrites", async () => {
  const { tx } = reader(Array.from({ length: ROUTINE_UNLINK_MAX_ROOTS + 1 }, (_, i) => root(`root-${i}`)));
  expect(await prepareRoutineSubjectUnlinkInTx(tx, association)).toEqual({ kind: "held", reason: "too-many-roots" });
});
it("keeps an unknown apparently unrelated definition in the all-or-nothing preflight", async () => {
  const { tx } = reader([root("root-a", { protocol: "future-unknown", content: { subject: { user_id: "unrelated" } } })]);
  expect(await prepareRoutineSubjectUnlinkInTx(tx, association)).toEqual({
    kind: "held", reason: "future-definition-held", rootId: "root-a", detail: "unsupported-definition",
  });
});
it.each([
  { rows: [{ ...root("root-a"), family_id: "family-b" }] },
  { rows: [{ ...root("root-a"), recurrence_id: "another-root" }] },
  { rows: [root("root-a"), root("root-a")] },
])("refuses returned rows that do not match a complete canonical inventory", async ({ rows }) => {
  const { tx } = reader(rows);
  const result = await prepareRoutineSubjectUnlinkInTx(tx, association);
  expect(result.kind).toBe("held");
  expect(result).not.toHaveProperty("rewrites");
});
it("propagates storage errors so a future transaction cannot mistake them for a ready plan", async () => {
  const failure = new Error("Synthetic read failure");
  const { read, tx } = reader([]);
  read.mockReset().mockResolvedValueOnce([{ present: true }]).mockRejectedValueOnce(failure);
  await expect(prepareRoutineSubjectUnlinkInTx(tx, association)).rejects.toBe(failure);
});
