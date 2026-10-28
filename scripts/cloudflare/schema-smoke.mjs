#!/usr/bin/env node
/** Structural D1 foundation check; does not claim PostgreSQL trigger parity. */
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { Miniflare, convertV4MiniflareOptions } from 'miniflare'
import { unstable_splitSqlQuery as splitSqlQuery } from 'wrangler'
const root = fileURLToPath(new URL('../../', import.meta.url))
const source = await fs.readFile(path.join(root, 'prisma/schema.prisma'), 'utf8')
const models = [...source.matchAll(/^model (\w+) \{\n([\s\S]*?)\n\}/gm)]
const mf = new Miniflare(convertV4MiniflareOptions({
  name: 'schema-fixture', modules: true, compatibilityDate: '2026-10-13',
  script: 'export default { fetch() { return new Response("local schema fixture") } }',
  d1Databases: { DB: 'herewoven-schema-smoke' }, d1Persist: false,
}))
try {
  const db = await mf.getD1Database('DB')
  for (const file of (await fs.readdir(path.join(root, 'database/cloudflare'))).filter(f => f.endsWith('.sql')).sort()) {
    for (const statement of splitSqlQuery(await fs.readFile(path.join(root, 'database/cloudflare', file), 'utf8'))) await db.prepare(statement).run()
  }
  let uniqueKeys = 0, relations = 0, columns = 0
  for (const [, name, body] of models) {
    const fields = body.split('\n').filter(line => !line.includes('@ignore')).map(line => {
      const match = line.match(/^\s*(\w+)\s+(String|Int|BigInt|Boolean|DateTime|Float|Decimal|Json)(\?|\[\])?(?:\s|$)/)
      return match ? { name: match[1], type: match[2], array: match[3] === '[]', optional: match[3] === '?', line } : null
    }).filter(Boolean)
    const actual = (await db.prepare(`PRAGMA table_info("${name}")`).all()).results
    assert.deepEqual(actual.map(c => c.name).sort(), fields.map(f => f.name).sort(), `${name}: canonical scalar fields`)
    columns += fields.length
    for (const field of fields) {
      const type = name === 'BetaMetricDaily' && field.name === 'day' ? 'TEXT'
        : field.array || ['String', 'Json'].includes(field.type) ? 'TEXT' : field.type === 'Float' ? 'REAL' : field.type === 'Decimal' ? 'DECIMAL' : 'INTEGER'
      assert.equal(actual.find(c => c.name === field.name).type, type, `${name}.${field.name}: D1 storage type`)
      assert.equal(actual.find(c => c.name === field.name).notnull, field.optional ? 0 : 1, `${name}.${field.name}: nullability`)
    }
    // Every canonical primary/unique key must exist, including composite
    // household identities used as foreign-key parents and retry locks.
    const expectedKeys = fields.filter(f => /@(?:id|unique)\b/.test(f.line)).map(f => [f.name])
    for (const key of body.matchAll(/@@(?:id|unique)\(\[([^\]]+)\]/g)) expectedKeys.push(key[1].split(',').map(f => f.trim()))
    const actualKeys = []
    for (const index of (await db.prepare(`PRAGMA index_list("${name}")`).all()).results) {
      if (!index.unique || index.partial) continue
      actualKeys.push((await db.prepare(`PRAGMA index_info("${index.name}")`).all()).results.map(c => c.name))
    }
    const primary = actual.filter(c => c.pk > 0).sort((a, b) => a.pk - b.pk).map(c => c.name)
    if (primary.length) actualKeys.push(primary)
    for (const key of expectedKeys) {
      assert.ok(actualKeys.some(k => JSON.stringify(k) === JSON.stringify(key)), `${name}: missing unique ${key.join(',')}`)
      uniqueKeys++
    }
    const actualForeign = new Map()
    for (const fk of (await db.prepare(`PRAGMA foreign_key_list("${name}")`).all()).results) {
      if (!actualForeign.has(fk.id)) actualForeign.set(fk.id, [])
      actualForeign.get(fk.id).push(fk)
    }
    for (const relation of body.matchAll(/^\s*\w+\s+(\w+)(?:\?|\[\])?\s+@relation\(([\s\S]*?)\)/gm)) {
      const from = relation[2].match(/fields:\s*\[([^\]]+)\]/)?.[1].split(',').map(c => c.trim())
      const to = relation[2].match(/references:\s*\[([^\]]+)\]/)?.[1].split(',').map(c => c.trim())
      if (!from || !to) continue
      assert.ok([...actualForeign.values()].some(rows => {
        rows.sort((a, b) => a.seq - b.seq)
        return rows[0].table === relation[1] && from.every((column, i) => rows[i]?.from === column && rows[i]?.to === to[i])
      }), `${name}: missing relationship ${from.join(',')} -> ${relation[1]}`)
      relations++
    }
  }
  assert.equal(models.length, 84)
  assert.ok(relations > 150, 'relationship parser must cover the full schema')
  assert.deepEqual((await db.prepare('PRAGMA foreign_key_check').all()).results, [], 'all referenced parent keys are valid')
  // Actual new tables enforce shared retry and same-household profile identity.
  await db.prepare(`INSERT INTO "Family" (id,name,invite_code) VALUES ('schema-a','Fabricated A','schema-a'),('schema-b','Fabricated B','schema-b')`).run()
  await db.prepare(`INSERT INTO "User" (id,email,name,family_id) VALUES ('schema-user','schema@example.test','Fabricated parent','schema-a')`).run()
  await db.prepare(`INSERT INTO "HouseholdMember" (id,family_id,name) VALUES ('schema-member','schema-b','Fabricated child')`).run()
  await assert.rejects(db.prepare(`INSERT INTO "HouseholdMemberAccountLink" (member_id,user_id,family_id,verified_at) VALUES ('schema-member','schema-user','schema-b',1)`).run())
  // workerd currently reports deferred-FK commit failures as an internal error;
  // verify rollback and a healthy follow-up read instead of matching its text.
  assert.equal((await db.prepare('SELECT count(*) AS n FROM "HouseholdMemberAccountLink"').first()).n, 0)
  const insertReceipt = () => db.prepare(`INSERT INTO "IdempotencyRecord" (id,scope,key,family_id,user_id,action,request_hash,expires_at) VALUES (?1,'user:schema-user','fixture-key','schema-a','schema-user','fixture','fixture',1)`).bind(crypto.randomUUID()).run()
  await insertReceipt()
  await assert.rejects(insertReceipt(), /UNIQUE/)
  const receipt = await db.prepare('SELECT created_at FROM "IdempotencyRecord"').first()
  assert.ok(Number.isSafeInteger(receipt.created_at) && receipt.created_at > 1_000_000_000_000, 'new-table default dates use milliseconds')
  await db.prepare(`INSERT INTO "Chore" (id,family_id,title,due_date,created_by,assigned_to) VALUES ('schema-chore','schema-a','Fabricated chore',1,'schema-user','schema-user')`).run()
  const chore = await db.prepare(`SELECT responsibility_generation,rotation_member_ids,weekly_days FROM "Chore" WHERE id='schema-chore'`).first()
  assert.match(chore.responsibility_generation, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
  assert.equal(chore.rotation_member_ids, '[]')
  assert.equal(chore.weekly_days, '[]')
  await assert.rejects(db.prepare(`UPDATE "Chore" SET weekly_days='invalid JSON' WHERE id='schema-chore'`).run(), /CHECK/)
  await assert.rejects(db.prepare(`UPDATE "Chore" SET photo_verified=2 WHERE id='schema-chore'`).run(), /CHECK/)
  await assert.rejects(db.prepare(`UPDATE "Chore" SET due_date='2026-10-28' WHERE id='schema-chore'`).run(), /CHECK/)
  await assert.rejects(db.prepare(`UPDATE "HouseholdMember" SET family_id='schema-a' WHERE id='schema-member'`).run(), /immutable/)
  await assert.rejects(db.prepare(`UPDATE "HouseholdMember" SET erasure_user_id='schema-user',archived_at=1 WHERE id='schema-member'`).run(), /Erasure ownership/)
  await db.prepare(`INSERT INTO "HouseholdMember" (id,family_id,name) VALUES ('schema-own','schema-a','Fabricated own child')`).run()
  await assert.rejects(db.prepare(`UPDATE "HouseholdMember" SET erasure_user_id='schema-user' WHERE id='schema-own'`).run(), /Erasure ownership/)
  await db.prepare(`UPDATE "HouseholdMember" SET erasure_user_id='schema-user',archived_at=1 WHERE id='schema-own'`).run()
  await assert.rejects(db.prepare(`UPDATE "HouseholdMember" SET erasure_user_id=NULL WHERE id='schema-own'`).run(), /Erasure ownership/)
  await db.prepare(`INSERT INTO "HouseholdMember" (id,family_id,name) VALUES ('schema-linked','schema-a','Fabricated linked child')`).run()
  await db.prepare(`INSERT INTO "HouseholdMemberAccountLink" (member_id,user_id,family_id,verified_at) VALUES ('schema-linked','schema-user','schema-a',1)`).run()
  // The composite user FK must be deferred: deleting a family both clears its
  // users' memberships and cascades linked profiles in the same transaction.
  await db.prepare(`DELETE FROM "Family" WHERE id='schema-a'`).run()
  assert.equal((await db.prepare(`SELECT count(*) AS n FROM "HouseholdMemberAccountLink"`).first()).n, 0)
  assert.equal((await db.prepare(`SELECT family_id FROM "User" WHERE id='schema-user'`).first()).family_id, null)
  assert.deepEqual((await db.prepare('PRAGMA foreign_key_check').all()).results, [])
  console.log(JSON.stringify({ models: models.length, columns, uniqueKeys, relations, foreignKeysValid: true, crossHouseholdLinkRefused: true, retryKeyUnique: true, millisecondDefaults: true, arrayDefaults: true, uuidDefaults: true, typedChecks: true, immutableProfile: true, erasureGuard: true, linkedFamilyDeletion: true, remaining: 'PostgreSQL-only custom checks/triggers and feature writers still require conversion' }))
} finally { await mf.dispose() }
