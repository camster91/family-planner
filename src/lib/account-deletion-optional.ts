import type { Prisma } from "@prisma/client";

type Tx = Pick<Prisma.TransactionClient, "$queryRaw" | "$executeRaw">;
type Model =
  "householdProfileLinkChallenge" | "aiUsageRequest" | "aiUsagePolicy";
export function isOptionalDeletionMetadata(model: string): model is Model {
  return (
    model === "householdProfileLinkChallenge" ||
    model === "aiUsageRequest" ||
    model === "aiUsagePolicy"
  );
}

/** Only for the already authorized, locked whole-household deletion. Fixed SQL
 * keeps additive-table cleanup usable with old generated clients and rollback
 * databases. A missing table is skipped; query/delete failures must abort. */
export async function deleteOptionalHouseholdMetadataInTx(
  tx: Tx,
  familyId: string,
  model: Model,
) {
  if (model === "householdProfileLinkChallenge") {
    const rows = await tx.$queryRaw<
      Array<{ present: boolean }>
    >`SELECT to_regclass('public."HouseholdProfileLinkChallenge"') IS NOT NULL AS present`;
    if (rows[0]?.present === true)
      await tx.$executeRaw`DELETE FROM "HouseholdProfileLinkChallenge" WHERE "family_id" = ${familyId}`;
  } else if (model === "aiUsageRequest") {
    const rows = await tx.$queryRaw<
      Array<{ present: boolean }>
    >`SELECT to_regclass('public."AiUsageRequest"') IS NOT NULL AS present`;
    if (rows[0]?.present === true)
      await tx.$executeRaw`DELETE FROM "AiUsageRequest" WHERE "family_id" = ${familyId}`;
  } else {
    const rows = await tx.$queryRaw<
      Array<{ present: boolean }>
    >`SELECT to_regclass('public."AiUsagePolicy"') IS NOT NULL AS present`;
    if (rows[0]?.present === true)
      await tx.$executeRaw`DELETE FROM "AiUsagePolicy" WHERE "family_id" = ${familyId}`;
  }
}
