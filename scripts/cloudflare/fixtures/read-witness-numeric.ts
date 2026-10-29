import { captureD1Reads } from '../../../src/lib/cloudflare/read-witness'
import type { NativeD1 } from '../../../src/lib/cloudflare/read-client'
import type { D1Store } from '../../../src/lib/cloudflare/database'

function check(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message)
}

async function refused(operation: () => Promise<unknown>, message: string) {
  try { await operation() } catch (error) {
    check(error instanceof Error && error.message.includes('herewoven_d1_write_precondition'), message)
    return
  }
  throw new Error(message)
}

/**
 * Regression fixture for D1 JSON witnesses. It exercises the real SQLite/D1
 * adapter rather than a JavaScript-only serializer: integral REALs, exponent
 * notation, high-precision doubles, text/NULL types, ordering and empty
 * windows must compare exactly while a nearby double must refuse atomically.
 * The main native fixture worker owns route registration.
 */
export async function testReadWitnessNumbers(db: D1Store) {
  const native = db as unknown as NativeD1
  await db.batch([
    db.prepare(`INSERT INTO "Family"(id,name,invite_code) VALUES ('witness-numeric-family','Witness Numeric','witness-numeric')`),
    db.prepare(`INSERT INTO "User"(id,email,name,role,family_id) VALUES ('witness-numeric-user','witness-numeric@example.test','Witness','parent','witness-numeric-family')`),
    db.prepare(`INSERT INTO "InventoryItem"(id,family_id,name,amount,category,added_by) VALUES
      ('witness-01','witness-numeric-family','Integral',1.0,NULL,'witness-numeric-user'),
      ('witness-02','witness-numeric-family','Exponent',1.0e-7,'1','witness-numeric-user'),
      ('witness-03','witness-numeric-family','Precision',1.2345678901234567,'text','witness-numeric-user')`),
  ])
  const read = () => captureD1Reads(client => client.inventoryItem.findMany({
    where: { family_id: 'witness-numeric-family' },
    select: { id: true, name: true, amount: true, category: true },
    orderBy: { id: 'asc' },
  }), native)
  const first = await read()
  check(first.value.length === 3 && first.value[0]?.amount === 1 && first.value[1]?.amount === 1e-7, 'native numeric projection')
  await db.batch(first.checks(db))
  const unchanged = await read()
  await db.batch(unchanged.checks(db))
  await db.prepare(`UPDATE "InventoryItem" SET amount=?1 WHERE id='witness-03'`).bind(1.2345678901234569).run()
  await refused(() => db.batch(first.checks(db)), 'nearby high-precision REAL mutation is refused')
  await db.prepare(`UPDATE "InventoryItem" SET amount=?1 WHERE id='witness-03'`).bind(1.2345678901234567).run()
  const restored = await read()
  await db.batch(restored.checks(db))
  await db.prepare(`UPDATE "InventoryItem" SET category='1' WHERE id='witness-01'`).run()
  await refused(() => db.batch(restored.checks(db)), 'NULL to text mutation is refused')
  await db.prepare(`UPDATE "InventoryItem" SET category=NULL WHERE id='witness-01'`).run()
  const ordered = await captureD1Reads(client => client.inventoryItem.findMany({
    where: { family_id: 'witness-numeric-family' },
    select: { name: true, amount: true },
    orderBy: { category: 'asc' },
  }), native)
  await db.batch(ordered.checks(db))
  await db.batch([
    db.prepare(`UPDATE "InventoryItem" SET category='1' WHERE id='witness-01'`),
    db.prepare(`UPDATE "InventoryItem" SET category=NULL WHERE id='witness-02'`),
  ])
  await refused(() => db.batch(ordered.checks(db)), 'changed ordering is refused')
  await db.batch([
    db.prepare(`UPDATE "InventoryItem" SET category=NULL WHERE id='witness-01'`),
    db.prepare(`UPDATE "InventoryItem" SET category='1' WHERE id='witness-02'`),
  ])
  const empty = await captureD1Reads(client => client.inventoryItem.findMany({
    where: { id: 'witness-empty' },
    select: { id: true, amount: true },
  }), native)
  check(empty.value.length === 0, 'empty projection')
  await db.batch(empty.checks(db))
  await db.prepare(`INSERT INTO "InventoryItem"(id,family_id,name,amount,added_by) VALUES ('witness-empty','witness-numeric-family','Inserted',2.5,'witness-numeric-user')`).run()
  await refused(() => db.batch(empty.checks(db)), 'empty-to-row mutation is refused')
  return { integral: true, exponent: true, highPrecision: true, changedDoubleRefused: true, textNullTypes: true, orderRefused: true, emptyWindow: true }
}
