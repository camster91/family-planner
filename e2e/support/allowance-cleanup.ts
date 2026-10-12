import pg from "pg";
import { assertFixtureTargetAllowed } from "../../src/lib/fixtures/guard";
import { expect } from "./test";

/**
 * Remove only receipts and allowance rows proven to belong to this test.
 * Callers must first read the rows through the real API and pass those exact
 * ids/keys; this helper refuses a family/actor/reason mismatch before delete.
 */
export async function removeOwnedAllowanceArtifacts({
  familyId,
  fromUserId,
  toUserId,
  reason,
  allowanceIds,
  idempotencyKeys,
}: {
  familyId: string;
  fromUserId: string;
  toUserId: string;
  reason: string;
  allowanceIds: string[];
  idempotencyKeys: string[];
}) {
  assertFixtureTargetAllowed(process.env);
  const ids = [...new Set(allowanceIds)];
  const keys = [...new Set(idempotencyKeys)];
  const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();
  try {
    if (ids.length) {
      const rows = await db.query<{
        id: string;
        family_id: string;
        from_user_id: string;
        to_user_id: string;
        reason: string | null;
      }>(
        `SELECT id, family_id, from_user_id, to_user_id, reason
         FROM "Allowance" WHERE id = ANY($1::text[])`,
        [ids],
      );
      expect(rows.rows).toHaveLength(ids.length);
      for (const row of rows.rows) {
        expect(row).toMatchObject({
          family_id: familyId,
          from_user_id: fromUserId,
          to_user_id: toUserId,
          reason,
        });
      }
      const deleted = await db.query<{ id: string }>(
        `DELETE FROM "Allowance"
         WHERE id = ANY($1::text[]) AND family_id = $2
           AND from_user_id = $3 AND reason = $4 AND to_user_id = $5
         RETURNING id`,
        [ids, familyId, fromUserId, reason, toUserId],
      );
      expect(deleted.rows.map((row) => row.id).sort()).toEqual([...ids].sort());
    }

    if (keys.length) {
      const receipts = await db.query<{
        id: string;
        key: string;
        family_id: string;
        user_id: string | null;
        action: string;
      }>(
        `SELECT id, key, family_id, user_id, action
         FROM "IdempotencyRecord"
         WHERE family_id = $1 AND user_id = $2
           AND key = ANY($3::text[]) AND action = 'allowance.create'`,
        [familyId, fromUserId, keys],
      );
      expect(receipts.rows.map((row) => row.key).sort()).toEqual(
        [...keys].sort(),
      );
      for (const row of receipts.rows) {
        expect(row).toMatchObject({
          family_id: familyId,
          user_id: fromUserId,
          action: "allowance.create",
        });
      }
      const deleted = await db.query<{ id: string }>(
        `DELETE FROM "IdempotencyRecord"
         WHERE id = ANY($1::text[]) AND family_id = $2
           AND user_id = $3 AND key = ANY($4::text[])
           AND action = 'allowance.create'
         RETURNING id`,
        [receipts.rows.map((row) => row.id), familyId, fromUserId, keys],
      );
      expect(deleted.rows).toHaveLength(receipts.rows.length);
    }
  } finally {
    await db.end();
  }
}
