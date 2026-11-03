#!/usr/bin/env node
// Disposable native D1 upgrade/export/restore rehearsal. No remote config or data.
import assert from 'node:assert/strict'
import { unstable_splitSqlQuery as splitSqlQuery } from 'wrangler'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtemp, mkdir, readFile, readdir, copyFile, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../../', import.meta.url))
const scratch = await mkdtemp(path.join(tmpdir(), 'herewoven-preparation-upgrade-'))
const migrations = path.join(scratch, 'migrations')
const cli = path.join(root, 'node_modules/wrangler/bin/wrangler.js')
const env = { ...process.env, WRANGLER_SEND_METRICS: 'false' }
const quote = value => `"${value.replaceAll('"', '""')}"`
const run = (directory, args) => execFileSync(process.execPath, [cli, ...args, '--config', path.join(directory, 'wrangler.json')],
  { cwd: directory, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 8 * 1024 * 1024 })
async function query(directory, sql) {
  const file = path.join(directory, 'query.sql')
  await writeFile(file, sql)
  return JSON.parse(run(directory, ['d1', 'execute', 'DB', '--local', '--file', file, '--json']))
}
async function snapshot(directory) {
  const result = await query(directory, `SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' AND name<>'d1_migrations' ORDER BY name`)
  const tables = result[0].results.map(row => row.name)
  const rows = await query(directory, tables.map(name => `SELECT * FROM ${quote(name)};`).join('\n'))
  return Object.fromEntries(tables.map((name, index) => [name, rows[index].results.map(row => JSON.stringify(row)).sort()]))
}
try {
  await mkdir(migrations)
  const names = (await readdir(path.join(root, 'database/cloudflare'))).filter(name => name.endsWith('.sql')).sort()
  const added = ['0017_event_preparation_lifecycle.sql', '0018_event_preparation_step_bounds.sql']
  assert.deepEqual(names.filter(name => name >= added[0]), added, 'Revisit rehearsal when another migration is added')
  for (const name of names.filter(name => name < added[0])) await copyFile(path.join(root, 'database/cloudflare', name), path.join(migrations, name))
  const upgraded = path.join(scratch, 'upgrade'), restored = path.join(scratch, 'restore')
  for (const directory of [upgraded, restored]) {
    await mkdir(directory)
    await writeFile(path.join(directory, 'wrangler.json'), JSON.stringify({ name: 'local-preparation-upgrade', compatibility_date: '2026-10-13',
      d1_databases: [{ binding: 'DB', database_name: 'local-preparation-upgrade', database_id: '00000000-0000-0000-0000-000000000017', migrations_dir: migrations }] }))
  }
  const migrate = directory => run(directory, ['d1', 'migrations', 'apply', 'DB', '--local'])
  migrate(upgraded)
  await query(upgraded, `INSERT INTO Family(id,name,invite_code) VALUES ('upgrade-a','Fabricated A','upgrade-a'),('upgrade-b','Fabricated B','upgrade-b');
    INSERT INTO User(id,email,name,family_id) VALUES ('upgrade-parent','upgrade@example.test','Fixture','upgrade-a');
    INSERT INTO Event(id,family_id,title,start_time,end_time,created_by) VALUES ('upgrade-event','upgrade-a','Fixture event',1,2,'upgrade-parent');
    INSERT INTO Chore(id,family_id,title,due_date,created_by,assigned_to) VALUES ('upgrade-task','upgrade-a','Fixture task',1,'upgrade-parent','upgrade-parent');
    INSERT INTO Chore(id,family_id,title,due_date,created_by,assigned_to) VALUES ('upgrade-legacy-task','upgrade-a','Legacy fixture task',1,'upgrade-parent','upgrade-parent');
    INSERT INTO EventPreparation(id,family_id,event_id,reviewed_event_source) VALUES ('upgrade-plan','upgrade-a','upgrade-event','${'a'.repeat(64)}');
    INSERT INTO EventPreparationStep(id,family_id,preparation_id,chore_id,position) VALUES ('upgrade-step','upgrade-a','upgrade-plan','upgrade-task',1);
    INSERT INTO EventPreparationStep(id,family_id,preparation_id,chore_id,position) VALUES ('upgrade-legacy-step','upgrade-a','upgrade-plan','upgrade-legacy-task',0);`)
  const schemaSql = "SELECT type,name,tbl_name,sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' AND name<>'d1_migrations' ORDER BY type,name"
  const beforeSchema = (await query(upgraded, schemaSql))[0].results
  const before = await snapshot(upgraded)
  const backup = path.join(scratch, 'before-upgrade.sql')
  run(upgraded, ['d1', 'export', 'DB', '--local', '--output', backup])
  const backupBytes = await readFile(backup)
  const backupHash = createHash('sha256').update(backupBytes).digest('hex')
  // D1's dump interleaves table data with later referenced tables. Also keep
  // lifecycle triggers out of the data-loading phase: restored history must not
  // generate fresh epochs. Preserve each exported statement without rewriting it.
  const schema = [], data = [], triggers = []
  for (const statement of splitSqlQuery(backupBytes.toString('utf8'))) {
    const sql = statement.trim()
    if (/^PRAGMA defer_foreign_keys\s*=\s*(?:TRUE|ON|1)\s*;?$/i.test(sql)) continue
    if (/^CREATE (?:TABLE|(?:UNIQUE )?INDEX) /i.test(sql)) schema.push(sql)
    else if (/^INSERT INTO /i.test(sql) || /^DELETE FROM sqlite_sequence$/i.test(sql)) data.push(sql)
    else if (/^CREATE TRIGGER /i.test(sql)) triggers.push(sql)
    else throw new Error(`Unsupported export statement: ${sql.slice(0, 50)}`)
  }
  const restoreFile = path.join(scratch, 'ordered-restore.sql')
  await writeFile(restoreFile, ['PRAGMA defer_foreign_keys=TRUE;', ...schema, ...data, ...triggers].map(sql => `${sql};`).join('\n'))
  for (const name of added) await copyFile(path.join(root, 'database/cloudflare', name), path.join(migrations, name))
  migrate(upgraded)
  assert.deepEqual(await snapshot(upgraded), before, 'Upgrade preserves every original application row')
  migrate(upgraded)
  assert.deepEqual(await snapshot(upgraded), before, 'Migration tracking prevents repeated application')
  assert.deepEqual((await query(upgraded, 'PRAGMA foreign_key_check'))[0].results, [])
  assert.throws(() => run(upgraded, ['d1', 'execute', 'DB', '--local', '--command', `UPDATE EventPreparationStep SET position=0 WHERE id='upgrade-step'`]), /Invalid preparation step position or cue/, 'New bounds are enforced')
  assert.deepEqual(await snapshot(upgraded), before, 'Refused invalid write leaves all rows unchanged')
  await query(upgraded, `UPDATE EventPreparationStep SET cue_anchor='start',cue_direction='before',cue_minutes=10 WHERE id='upgrade-step'`)
  assert.equal((await query(upgraded, `SELECT revision FROM EventPreparation WHERE id='upgrade-plan'`))[0].results[0].revision, 1, 'Valid writer advances lifecycle version')
  assert.throws(() => run(upgraded, ['d1', 'execute', 'DB', '--local', '--command', `UPDATE EventPreparationStep SET cue_anchor='start',cue_direction='before',cue_minutes=5 WHERE id='upgrade-legacy-step'`]), /Invalid preparation step position or cue/, 'Legacy invalid step cannot be edited without correcting its position')
  assert.equal((await query(upgraded, `SELECT position FROM EventPreparationStep WHERE id='upgrade-legacy-step'`))[0].results[0].position, 0, 'Legacy invalid row remains readable')
  await query(upgraded, `UPDATE EventPreparationStep SET position=2 WHERE id='upgrade-legacy-step'`)
  assert.equal((await query(upgraded, `SELECT revision FROM EventPreparation WHERE id='upgrade-plan'`))[0].results[0].revision, 2, 'Explicit legacy repair advances lifecycle version')
  // Restore the exact pre-upgrade SQL into an independent, empty local D1 DB.
  run(restored, ['d1', 'execute', 'DB', '--local', '--file', restoreFile])
  assert.deepEqual(await snapshot(restored), before, 'Export restores every original application row')
  assert.deepEqual((await query(restored, schemaSql))[0].results, beforeSchema, 'Export restores original schema, indexes and triggers')
  assert.deepEqual((await query(restored, 'PRAGMA foreign_key_check'))[0].results, [])
  const restoredMigrations = (await query(restored, 'SELECT name FROM d1_migrations ORDER BY name'))[0].results.map(row => row.name)
  assert.deepEqual(restoredMigrations, names.filter(name => name < added[0]), 'Backup restores the previous migration ledger')
  migrate(restored)
  assert.deepEqual(await snapshot(restored), before, 'Restored database can upgrade again without data changes')
  console.log(JSON.stringify({ previousMigration: '0016_food_source_guards.sql', upgrades: added, applicationTablesCompared: Object.keys(before).length,
    backupSha256: backupHash, upgradePreservesRows: true, repeatApply: true, invalidWriteRefused: true, validWriteVersioned: true,
    legacyRowsPreservedAndRepairable: true, independentRestore: true, schemaAndTriggersRestored: true, previousLedgerRestored: true, restoreThenUpgrade: true, foreignKeysValid: true,
    scope: 'Fabricated local D1 only; not production backup or installed-client acceptance' }))
} finally { await rm(scratch, { recursive: true, force: true }) }
