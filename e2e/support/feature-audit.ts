/** Own only feature audit rows created by one serial, disposable-fixture test. */
import pg from "pg";
import { FIXTURE_IDS } from "../../src/lib/fixtures/dataset";
import { assertFixtureTargetAllowed } from "../../src/lib/fixtures/guard";
import { expect } from "./test";

type Row = { id: string; action: string; target_id: string };
export async function ownFeatureAudit(keys: string[]) {
  assertFixtureTargetAllowed(process.env);
  const fixture = FIXTURE_IDS.familyA;
  const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();
  const rows = async () =>
    (
      await db.query<Row>(
        `SELECT id, action, target_id FROM "AuditLog"
     WHERE family_id=$1 AND actor_user_id=$2 AND actor_kind='person'
       AND target_type='feature' AND target_id=ANY($3::text[])
       AND action IN ('feature.turned_on','feature.turned_off')`,
        [fixture.family, fixture.parent, keys],
      )
    ).rows;
  let baseline: Row[];
  try {
    baseline = await rows();
  } catch (error) {
    await db.end();
    throw error;
  }
  const priorIds = new Set(baseline.map((row) => row.id));
  return async () => {
    try {
      assertFixtureTargetAllowed(process.env);
      const current = await rows();
      const owned = current.filter((row) => !priorIds.has(row.id));
      // One enable and one restore per key. Fail closed if another writer has
      // changed this same fixture scope; never delete an ambiguous extra row.
      const pairs = owned.map((row) => `${row.target_id}:${row.action}`);
      expect(new Set(pairs).size).toBe(pairs.length);
      expect(owned.length).toBeLessThanOrEqual(keys.length * 2);
      if (owned.length) {
        const deleted = await db.query(
          `DELETE FROM "AuditLog" WHERE id=ANY($1::text[]) AND family_id=$2
           AND actor_user_id=$3 AND actor_kind='person' AND target_type='feature'
           AND target_id=ANY($4::text[]) AND action IN ('feature.turned_on','feature.turned_off')`,
          [owned.map((row) => row.id), fixture.family, fixture.parent, keys],
        );
        expect(deleted.rowCount).toBe(owned.length);
      }
      // Read back the complete scoped baseline: earlier history survives.
      expect((await rows()).map((row) => row.id).sort()).toEqual(
        [...priorIds].sort(),
      );
    } finally {
      await db.end();
    }
  };
}
