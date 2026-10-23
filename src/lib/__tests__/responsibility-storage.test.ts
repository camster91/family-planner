/** Authored source cases, not migration/lock/database proof. */
import type { Prisma } from "@prisma/client";
import {
  clearHouseholdResponsibilityInTx,
  responsibilitySourceToken,
  readResponsibilitySource,
  exportResponsibilityState,
} from "@/lib/responsibility-storage";
const target = { kind: "chore" as const, id: "chore-a" };
const source = { generation: "00000000-0000-4000-8000-000000000001", epoch: 0 };
it("binds generation, epoch, household, target kind and recurring root without private content", () => {
  const first = responsibilitySourceToken(target, "family-a", source);
  expect(first).toMatch(/^[a-f0-9]{64}$/);
  for (const value of [
    responsibilitySourceToken(target, "family-a", { ...source, epoch: 2 }),
    responsibilitySourceToken(target, "family-a", {
      ...source,
      generation: "00000000-0000-4000-8000-000000000002",
    }),
    responsibilitySourceToken(target, "family-b", source),
    responsibilitySourceToken(
      { kind: "pickup", id: target.id },
      "family-a",
      source,
    ),
  ])
    expect(value).not.toBe(first);
  const recurring = {
    ...source,
    recurrence_id: "root-a",
    root_generation: source.generation,
    root_epoch: 1,
  };
  expect(responsibilitySourceToken(target, "family-a", recurring)).not.toBe(
    responsibilitySourceToken(target, "family-a", {
      ...recurring,
      root_epoch: 2,
    }),
  );
});
it("holds unknown, missing-root and saturated epochs instead of accepting ambiguous source continuity", () => {
  for (const patch of [
    { generation: "unknown" },
    { epoch: -1 },
    { epoch: 2147483647 },
    { recurrence_id: "root-a" },
  ])
    expect(() =>
      responsibilitySourceToken(target, "family-a", { ...source, ...patch }),
    ).toThrow("UNAVAILABLE");
});
function fixture(ready: boolean, rows: unknown[] = []) {
  const query = jest.fn(async (strings: TemplateStringsArray) =>
    strings.join("?").includes("pg_attribute") ? [{ ready }] : rows,
  );
  return {
    tx: { $queryRaw: query } as unknown as Prisma.TransactionClient,
    query,
  };
}
it("does not select absent table/source columns before migration", async () => {
  const { tx, query } = fixture(false);
  expect(
    await exportResponsibilityState(tx, "user-a", "family-a", "parent"),
  ).toBeUndefined();
  await expect(
    readResponsibilitySource(tx, "family-a", target),
  ).rejects.toThrow("UNAVAILABLE");
  expect(
    query.mock.calls.every(([parts]) =>
      parts.join("?").includes("pg_attribute"),
    ),
  ).toBe(true);
});
it("clears household metadata before its FKs without requiring rollout/source readiness or a new delegate", async () => {
  for (const present of [false, true]) {
    const execute = jest.fn(async () => 1);
    const tx = {
      $queryRaw: jest.fn(async () => [{ present }]),
      $executeRaw: execute,
    } as unknown as Prisma.TransactionClient;
    await clearHouseholdResponsibilityInTx(tx, "family-a");
    expect(execute).toHaveBeenCalledTimes(present ? 1 : 0);
    if (present) {
      const call = execute.mock.calls as unknown as Array<
        [TemplateStringsArray, ...unknown[]]
      >;
      expect(call[0][0].join("?")).toBe(
        'DELETE FROM "ResponsibilityState" WHERE "family_id" = ?',
      );
      expect(call[0].slice(1)).toEqual(["family-a"]);
    }
  }
});
it("locks target/root together in stable ID order and never resolves a foreign root", async () => {
  const { tx, query } = fixture(true, [
    { ...source, id: "chore-a", recurrence_id: "root-a" },
    { ...source, id: "root-a", recurrence_id: "root-a" },
  ]);
  await expect(
    readResponsibilitySource(tx, "family-a", target),
  ).resolves.toMatch(/^[a-f0-9]{64}$/);
  expect(query.mock.calls[1][0].join("?")).toContain(
    'ORDER BY "id" FOR UPDATE',
  );
  const missing = fixture(true, [
    { ...source, id: "chore-a", recurrence_id: "foreign-root" },
  ]);
  await expect(
    readResponsibilitySource(missing.tx, "family-a", target),
  ).rejects.toThrow("UNAVAILABLE");
});
it("exports only current own participation, excluding child handoffs and privileged target content", async () => {
  const { tx, query } = fixture(true, []);
  await exportResponsibilityState(tx, "user-a", "family-a", "child");
  expect(query.mock.calls[1].slice(1)).toEqual([
    "family-a",
    false,
    "user-a",
    "child",
    "user-a",
    "user-a",
    "user-a",
  ]);
  const sql = query.mock.calls[1][0].join("?");
  expect(sql).toContain('"handoff_id" IS NULL');
  for (const privateField of [
    "source_token",
    "sitter_phone",
    "share_token",
    "email",
    "erasure_user_id",
    "description",
  ])
    expect(sql).not.toContain(`"${privateField}"`);
  const noFamily = fixture(true);
  expect(
    await exportResponsibilityState(noFamily.tx, "user-a", null, "parent"),
  ).toEqual([]);
  expect(noFamily.query).toHaveBeenCalledTimes(1);
});
