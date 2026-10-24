/** Internal foreground traversal position, never a completion receipt or authority. */
import type { Prisma, PrismaClient } from "@prisma/client";
import { lockHousehold } from "./household-lock";
import { normalizeFeatures, isFeatureEnabled } from "./features";
import { log } from "./logger";
import {
  isFairChoreTopUpEnabled, FAIR_CHORE_TOP_UP_MAX, FAIR_CHORE_TOP_UP_BUDGET_MS,
} from "./chore-top-up-gates";

type Db = Pick<PrismaClient, "$transaction">;
type Expand = (tx: Prisma.TransactionClient, rootId: string, familyId: string, now: Date) => Promise<number>;
function transactionBudget(deadline: number, clock: () => number) {
  const remaining = Math.ceil(deadline - clock());
  return remaining > 0 ? { timeout: remaining, maxWait: Math.min(200, remaining) } : null;
}
async function choresAvailable(tx: Prisma.TransactionClient, familyId: string) {
  const family = await tx.family.findUnique({ where: { id: familyId }, select: { features: true } });
  return Boolean(family && isFeatureEnabled(normalizeFeatures(family.features), "chores"));
}

/** Claim only the next attempted root. Its effect never rewrites the cursor, so
 * a delayed worker cannot rewind a newer claim. Deleting the cursor's old root
 * does not invalidate its lexical read position. Root ownership is re-read by
 * the canonical expander, not inferred from this operational pointer. */
async function claimNext(
  db: Db, familyId: string, seen: readonly string[], deadline: number, clock: () => number,
): Promise<string | null> {
  const budget = transactionBudget(deadline, clock);
  if (!budget) return null;
  return db.$transaction(async tx => {
    await lockHousehold(tx, familyId);
    if (!isFairChoreTopUpEnabled() || clock() >= deadline || !await choresAvailable(tx, familyId)) return null;
    const table = await tx.$queryRaw<Array<{ present: boolean }>>`
      SELECT to_regclass('public."ChoreTopUpCursor"') IS NOT NULL AS present`;
    if (table[0]?.present !== true) throw new Error("Fair chore top-up storage unavailable");
    await tx.$executeRaw`INSERT INTO "ChoreTopUpCursor" ("family_id", "after_id") VALUES (${familyId}, NULL) ON CONFLICT ("family_id") DO NOTHING`;
    const rows = await tx.$queryRaw<Array<{ after_id: string | null }>>`
      SELECT "after_id" FROM "ChoreTopUpCursor" WHERE "family_id" = ${familyId} FOR UPDATE`;
    if (rows.length !== 1) throw new Error("Fair chore top-up position unavailable");
    const after = rows[0].after_id;
    const base = { family_id: familyId, is_template: true, frequency: { not: "once" } };
    const find = (wrap: boolean) => tx.chore.findFirst({
      where: { ...base, id: { notIn: [...seen], ...(!wrap && after !== null ? { gt: after } : {}) } },
      orderBy: { id: "asc" }, select: { id: true },
    });
    const root = await find(false) ?? (after !== null ? await find(true) : null);
    if (!root || clock() >= deadline || !isFairChoreTopUpEnabled()) return null;
    const changed = await tx.$executeRaw`UPDATE "ChoreTopUpCursor" SET "after_id" = ${root.id} WHERE "family_id" = ${familyId}`;
    if (changed !== 1) throw new Error("Fair chore top-up position changed");
    return root.id;
  }, budget);
}

/** At most 100 different roots per visit, with a monotonic initiation budget.
 * Claim commits before the separate idempotent effect. Crash/timeout may defer
 * that one root until the next traversal; it never claims an entire unattempted
 * batch. Failures cannot pin every later series behind a poisoned first root. */
export async function topUpFairHouseholdSeries(
  db: Db, familyId: string, now: Date, expand: Expand,
  clock: () => number = () => performance.now(),
): Promise<number> {
  if (!isFairChoreTopUpEnabled()) return 0;
  const deadline = clock() + FAIR_CHORE_TOP_UP_BUDGET_MS;
  const seen = new Set<string>();
  let inserted = 0;
  for (let i = 0; i < FAIR_CHORE_TOP_UP_MAX && clock() < deadline; i++) {
    let rootId: string | null;
    try {
      rootId = await claimNext(db, familyId, [...seen], deadline, clock);
    } catch {
      // Fixed diagnostics only; no IDs, canonical content or ORM errors.
      log.warn("chores.fair_top_up_claim_failed", { code: "CLAIM_FAILED" });
      break;
    }
    if (!rootId || !isFairChoreTopUpEnabled()) break;
    seen.add(rootId);
    const budget = transactionBudget(deadline, clock);
    if (!budget) break;
    try {
      inserted += await db.$transaction(async tx => {
        await lockHousehold(tx, familyId);
        if (!isFairChoreTopUpEnabled() || !await choresAvailable(tx, familyId) || clock() >= deadline) return 0;
        return expand(tx, rootId, familyId, now);
      }, budget);
    } catch {
      log.warn("chores.fair_top_up_series_failed", { code: "EXPANSION_FAILED" });
      // The position denotes an attempt, not success. Later roots continue;
      // this root is retried on a subsequent cyclic traversal.
    }
  }
  return inserted;
}
