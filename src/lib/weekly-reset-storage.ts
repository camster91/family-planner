import type { Prisma } from "@prisma/client";
/** Compatibility reads and erasure remain active even when the new UI is off. */
async function hasWeeklyResetColumns(
  tx: Pick<Prisma.TransactionClient, "$queryRaw">,
) {
  const rows = await tx.$queryRaw<
    Array<{ ready: boolean }>
  >`SELECT COUNT(*) = 2 AS ready
    FROM pg_attribute WHERE attrelid = to_regclass('public."User"')
      AND attname IN ('weekly_reset_progress', 'weekly_reset_revision') AND NOT attisdropped`;
  return rows[0]?.ready === true;
}
export async function clearWeeklyResetInTx(
  tx: Prisma.TransactionClient,
  userId: string,
) {
  if (!(await hasWeeklyResetColumns(tx))) return;
  await tx.$executeRaw`UPDATE "User" SET "weekly_reset_progress" = NULL,
    "weekly_reset_revision" = CASE WHEN "weekly_reset_revision" < 2147483647
      THEN "weekly_reset_revision" + 1 ELSE "weekly_reset_revision" END
    WHERE "id" = ${userId} AND "weekly_reset_progress" IS NOT NULL`;
}
export async function exportWeeklyReset(
  db: Pick<Prisma.TransactionClient, "$queryRaw">,
  userId: string,
) {
  if (!(await hasWeeklyResetColumns(db))) return undefined;
  const rows = await db.$queryRaw<
    Array<{ progress: unknown; revision: number }>
  >`
    SELECT "weekly_reset_progress" AS progress, "weekly_reset_revision" AS revision
    FROM "User" WHERE "id" = ${userId}`;
  return rows[0] ?? null;
}
