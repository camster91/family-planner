#!/usr/bin/env node
// Builds the machine-readable report and the markdown summary for
// scripts/recovery-rehearsal.sh (#288). Called by the rehearsal's EXIT trap,
// before the work directory is deleted; all inputs come from the environment
// and files the rehearsal wrote there. Contains no credentials or row data:
// only table names, counts and md5 checksums.

import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const env = process.env
const work = env.REHEARSAL_WORK_DIR
const reportDir = env.REHEARSAL_OUT_DIR

const read = (name) => {
  const path = join(work, name)
  return existsSync(path) ? readFileSync(path, 'utf8').trim() : null
}

function parseTables(name) {
  const text = read(name)
  if (text === null) return null
  const tables = {}
  for (const line of text.split('\n').filter(Boolean)) {
    const [table, rows, md5] = line.split('|')
    tables[table] = { rows: Number(rows), md5 }
  }
  return tables
}

const steps = (read('steps.tsv') ?? '')
  .split('\n')
  .filter(Boolean)
  .map((line) => {
    const [id, status, seconds, detail] = line.split('\t')
    return { id, status, seconds: Number(seconds), detail }
  })
if (env.FAILED_STEP && !steps.some((s) => s.id === env.FAILED_STEP)) {
  steps.push({ id: env.FAILED_STEP, status: 'fail', seconds: null, detail: 'interrupted' })
}

const source = parseTables('source.tables')
const restored = parseTables('restored.tables')
const remigrated = parseTables('remigrated.tables')

const tableNames = [...new Set([...Object.keys(source ?? {}), ...Object.keys(restored ?? {})])].sort()
const tables = tableNames.map((table) => {
  const s = source?.[table]
  const r = restored?.[table]
  const m = remigrated?.[table]
  return {
    table,
    sourceRows: s?.rows ?? null,
    restoredRows: r?.rows ?? null,
    sourceMd5: s?.md5 ?? null,
    restoredMd5: r?.md5 ?? null,
    match: Boolean(s && r && s.rows === r.rows && s.md5 === r.md5),
    unchangedAfterRemigrate: remigrated ? Boolean(r && m && r.rows === m.rows && r.md5 === m.md5) : null,
  }
})

const smokeText = read('smoke.json')
const report = {
  schema: 'family-planner/recovery-rehearsal@1',
  issue: 288,
  status: env.STATUS,
  failedStep: env.STATUS === 'pass' ? null : env.FAILED_STEP || null,
  gitSha: env.GIT_SHA,
  startedAt: env.STARTED_AT,
  finishedAt: env.FINISHED_AT,
  durationSeconds: Number(env.DURATION),
  backupTransport: env.MODE === 'docker' ? 'docker exec into the CI database container' : 'local docker-exec shim',
  databases: { source: env.SOURCE_DB, restored: env.RESTORE_DB, droppedOnExit: env.CLEANUP_OK === 'true' },
  dump: {
    bytes: read('dump.bytes') === null ? null : Number(read('dump.bytes')),
    sha256: read('dump.sha256'),
    deletedOnExit: true,
  },
  steps,
  totals: {
    tables: tables.length,
    tablesMatching: tables.filter((t) => t.match).length,
    tablesWithRows: tables.filter((t) => (t.sourceRows ?? 0) > 0).length,
    sourceRows: tables.reduce((n, t) => n + (t.sourceRows ?? 0), 0),
    restoredRows: tables.reduce((n, t) => n + (t.restoredRows ?? 0), 0),
  },
  schemaFingerprint: {
    source: read('source.schema'),
    restored: read('restored.schema'),
    afterRemigrate: read('remigrated.schema'),
  },
  smoke: smokeText ? JSON.parse(smokeText) : null,
  tables,
}

writeFileSync(join(reportDir, 'recovery-rehearsal.json'), JSON.stringify(report, null, 2) + '\n')

const mark = (ok) => (ok ? 'pass' : 'FAIL')
const lines = [
  `# Recovery rehearsal: ${report.status.toUpperCase()}`,
  '',
  `- Commit: \`${report.gitSha}\``,
  `- Finished: ${report.finishedAt} (${report.durationSeconds}s)`,
  `- Databases: \`${env.SOURCE_DB}\` -> \`${env.RESTORE_DB}\` (both dropped on exit)`,
  `- Dump: ${report.dump.bytes ?? 'n/a'} bytes, sha256 \`${report.dump.sha256 ?? 'n/a'}\` (deleted on exit)`,
  `- Backup transport: ${report.backupTransport}`,
  `- Tables: ${report.totals.tablesMatching}/${report.totals.tables} identical (counts and md5), ${report.totals.tablesWithRows} with rows, ${report.totals.sourceRows} source rows / ${report.totals.restoredRows} restored rows`,
  `- Schema fingerprint: source \`${report.schemaFingerprint.source ?? 'n/a'}\`, restored \`${report.schemaFingerprint.restored ?? 'n/a'}\`, after re-migrate \`${report.schemaFingerprint.afterRemigrate ?? 'n/a'}\``,
  '',
  '| Step | Result | Seconds | Detail |',
  '| --- | --- | --- | --- |',
  ...steps.map((s) => `| ${s.id} | ${mark(s.status === 'pass')} | ${s.seconds ?? ''} | ${s.detail} |`),
  '',
]
if (report.smoke) {
  lines.push('| Smoke check | Result |', '| --- | --- |')
  for (const c of report.smoke.checks) lines.push(`| ${c.name} | ${mark(c.ok)} |`)
  lines.push('')
}
const mismatched = tables.filter((t) => !t.match)
if (restored && mismatched.length > 0) {
  lines.push('Mismatched tables:', '', ...mismatched.map((t) => `- ${t.table}: ${t.sourceRows} -> ${t.restoredRows}`), '')
}
lines.push('Full per-table evidence: `recovery-rehearsal.json`. Step logs: `logs/`.', '')
writeFileSync(join(reportDir, 'SUMMARY.md'), lines.join('\n'))
