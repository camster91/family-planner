import pg from "pg";
import { assertFixtureTargetAllowed } from "../../src/lib/fixtures/guard";
import { expect } from "./test";

export type OwnedLocation = {
  id: string;
  label: string;
  address: string | null;
};

/**
 * Delete only location rows and create receipts proven by one E2E intent.
 *
 * Callers discover rows through the authenticated API first, then pass the
 * exact returned ids and canonical label/address. This deliberately has no
 * prefix or family-wide cleanup fallback.
 */
export async function removeOwnedLocations({
  familyId,
  userId,
  locations,
  idempotencyKeys,
}: {
  familyId: string;
  userId: string;
  locations: readonly OwnedLocation[];
  idempotencyKeys: readonly string[];
}) {
  assertFixtureTargetAllowed(process.env);
  const ids = [...new Set(locations.map((location) => location.id))];
  const keys = [...new Set(idempotencyKeys)];
  const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();
  try {
    if (ids.length) {
      const selected = await db.query<
        OwnedLocation & {
          family_id: string;
          user_id: string;
        }
      >(
        `SELECT id, family_id, user_id, label, address
         FROM "FamilyLocation" WHERE id = ANY($1::text[])`,
        [ids],
      );
      expect(selected.rows).toHaveLength(ids.length);
      const expectedById = new Map(
        locations.map((location) => [location.id, location]),
      );
      for (const row of selected.rows) {
        expect(row.family_id).toBe(familyId);
        expect(row.user_id).toBe(userId);
        expect(row.label).toBe(expectedById.get(row.id)?.label);
        expect(row.address).toBe(expectedById.get(row.id)?.address);
      }
      const deleted = await db.query<{ id: string }>(
        `DELETE FROM "FamilyLocation"
         WHERE id = ANY($1::text[]) AND family_id = $2 AND user_id = $3
         RETURNING id`,
        [ids, familyId, userId],
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
         WHERE family_id = $1 AND user_id = $2 AND key = ANY($3::text[])
           AND action = 'location.create'`,
        [familyId, userId, keys],
      );
      expect(receipts.rows.map((row) => row.key).sort()).toEqual(
        [...keys].sort(),
      );
      const deleted = await db.query<{ id: string }>(
        `DELETE FROM "IdempotencyRecord"
         WHERE id = ANY($1::text[]) AND family_id = $2 AND user_id = $3
           AND key = ANY($4::text[]) AND action = 'location.create'
         RETURNING id`,
        [receipts.rows.map((row) => row.id), familyId, userId, keys],
      );
      expect(deleted.rows).toHaveLength(receipts.rows.length);
    }
  } finally {
    await db.end();
  }
}
