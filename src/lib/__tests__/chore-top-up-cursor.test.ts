// Authored source only. This serial fake is not PostgreSQL/concurrency evidence.
import type { PrismaClient } from "@prisma/client";
import { topUpFairHouseholdSeries } from "../chore-top-up-cursor";
import { FAIR_CHORE_TOP_UP_ENV, FAIR_CHORE_TOP_UP_READY_ENV } from "../chore-top-up-gates";
jest.mock("../logger", () => ({ log: { warn: jest.fn() } }));

function fixture(ids: string[]) {
  let after: string | null = null;
  let present = true;
  const claims: string[] = [];
  const tx = {
    family: { findUnique: jest.fn(async () => ({ features: { chores: true } })) },
    chore: { findFirst: jest.fn(async ({ where }: any) => {
      const id = ids.filter(id => !where.id.notIn.includes(id) && (!where.id.gt || id > where.id.gt)).sort()[0];
      return id ? { id } : null;
    }) },
    $queryRaw: jest.fn(async (parts: TemplateStringsArray) => {
      const sql = parts.join("?");
      if (sql.includes("to_regclass")) return [{ present }];
      if (sql.includes('SELECT "after_id"')) return [{ after_id: after }];
      return [{ locked: 1 }];
    }),
    $executeRaw: jest.fn(async (parts: TemplateStringsArray, ...values: string[]) => {
      if (parts.join("?").startsWith('UPDATE "ChoreTopUpCursor"')) {
        after = values[0]; claims.push(after);
      }
      return 1;
    }),
  };
  const transaction = jest.fn(async (run: (client: typeof tx) => Promise<unknown>) => run(tx));
  return {
    db: { $transaction: transaction } as unknown as Pick<PrismaClient, "$transaction">,
    transaction, tx, claims,
    setAfter: (value: string) => { after = value; },
    removeStorage: () => { present = false; },
  };
}
const previous = [process.env[FAIR_CHORE_TOP_UP_ENV], process.env[FAIR_CHORE_TOP_UP_READY_ENV]];
beforeEach(() => {
  process.env[FAIR_CHORE_TOP_UP_ENV] = "1";
  process.env[FAIR_CHORE_TOP_UP_READY_ENV] = "1";
});
afterEach(() => {
  [FAIR_CHORE_TOP_UP_ENV, FAIR_CHORE_TOP_UP_READY_ENV].forEach((key, index) => {
    if (previous[index] === undefined) delete process.env[key];
    else process.env[key] = previous[index];
  });
});
const now = new Date("2026-10-24T12:00:00Z");
it("does not touch storage with either acknowledgement missing", async () => {
  for (const key of [FAIR_CHORE_TOP_UP_ENV, FAIR_CHORE_TOP_UP_READY_ENV]) {
    process.env[key] = "0";
    const f = fixture(["a"]);
    expect(await topUpFairHouseholdSeries(f.db, "family-a", now, jest.fn(), () => 0)).toBe(0);
    expect(f.transaction).not.toHaveBeenCalled();
    process.env[key] = "1";
  }
});
it("continues beyond 100 and attempts each root at most once per visit", async () => {
  const ids = Array.from({ length: 150 }, (_, i) => String(i).padStart(3, "0"));
  const f = fixture(ids);
  const expand = jest.fn(async () => 1);
  expect(await topUpFairHouseholdSeries(f.db, "family-a", now, expand, () => 0)).toBe(100);
  expect(new Set(f.claims).size).toBe(100);
  await topUpFairHouseholdSeries(f.db, "family-a", now, expand, () => 0);
  expect(new Set(f.claims).size).toBe(150);
  expect(new Set(f.claims.slice(100)).size).toBe(100);
  expect(f.tx.chore.findFirst.mock.calls.every(([query]: any[]) => query.where.family_id === "family-a")).toBe(true);
});
it("continues after a failed root and retries it after cyclic traversal", async () => {
  const f = fixture(["a", "b", "c"]);
  const expand = jest.fn(async (_tx, id: string) => {
    if (id === "a") throw new Error("fabricated failure");
    return 1;
  });
  expect(await topUpFairHouseholdSeries(f.db, "family-a", now, expand, () => 0)).toBe(2);
  expect(f.claims).toEqual(["a", "b", "c"]);
  await topUpFairHouseholdSeries(f.db, "family-a", now, expand, () => 0);
  expect(f.claims).toEqual(["a", "b", "c", "a", "b", "c"]);
});
it("wraps from a removed lexical position without requiring that row", async () => {
  const f = fixture(["a", "b"]); f.setAfter("deleted-z");
  await topUpFairHouseholdSeries(f.db, "family-a", now, async () => 0, () => 0);
  expect(f.claims).toEqual(["a", "b"]);
});
it("fails closed if its additive table is unavailable", async () => {
  const f = fixture(["a"]); f.removeStorage(); const expand = jest.fn();
  await topUpFairHouseholdSeries(f.db, "family-a", now, expand, () => 0);
  expect(f.claims).toEqual([]); expect(expand).not.toHaveBeenCalled();
});
it("stops starting work when the budget expires or the gate closes", async () => {
  const f = fixture(["a", "b"]); let elapsed = 0;
  await topUpFairHouseholdSeries(f.db, "family-a", now, async () => { elapsed = 1500; return 1; }, () => elapsed);
  expect(f.claims).toEqual(["a"]);
  const paused = fixture(["a", "b"]);
  await topUpFairHouseholdSeries(paused.db, "family-a", now, async () => {
    process.env[FAIR_CHORE_TOP_UP_ENV] = "0"; return 0;
  }, () => 0);
  expect(paused.claims).toEqual(["a"]);
});
