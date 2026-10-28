import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises'
import { createWriteStream } from 'node:fs'
import { spawn, execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import path from 'node:path'
import net from 'node:net'
import { fileURLToPath } from 'node:url'
import assert from 'node:assert/strict'

// Real workerd/D1 + the application's actual read factory, without provider
// credentials, production routes, account cookies or persistent household data.
const root = fileURLToPath(new URL('../../', import.meta.url))
const scratch = await mkdtemp(path.join(tmpdir(), 'herewoven-read-smoke-'))
const configPath = path.join(root, `.wrangler-read-smoke-${process.pid}.json`)
const state = path.join(scratch, 'state')
const wrangler = path.join(root, 'node_modules/wrangler/bin/wrangler.js')
const env = { ...process.env, WRANGLER_SEND_METRICS: 'false' }
const logPath = path.join(scratch, 'worker.log')
let worker
const run = args => execFileSync(process.execPath, [wrangler, ...args], { cwd: root, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
try {
  await writeFile(configPath, JSON.stringify({
    name: 'herewoven-local-read-smoke', main: path.join(root, 'scripts/cloudflare/fixtures/read-worker.ts'),
    tsconfig: 'tsconfig.json', compatibility_date: '2026-10-13', compatibility_flags: ['nodejs_compat'],
    workers_dev: false, preview_urls: false,
    d1_databases: [{ binding: 'DB', database_name: 'local-read-smoke', database_id: '00000000-0000-0000-0000-000000000001', migrations_dir: path.join(root, 'database/cloudflare') }],
  }))
  const databaseArgs = ['DB', '--local', '--config', configPath, '--persist-to', state]
  run(['d1', 'migrations', 'apply', ...databaseArgs])
  const fixture = path.join(scratch, 'fixture.sql')
  await writeFile(fixture, `INSERT INTO Family (id,name,invite_code,ambient_photo_ids) VALUES ('read-family-a','Fabricated A','local-a','["fixture-photo"]'),('read-family-b','Fabricated B','local-b','[]');
INSERT INTO User (id,email,name,family_id,email_verified,created_at) VALUES
('read-a','a@example.test','Fabricated A','read-family-a',1,1760000000000),
('read-b','b@example.test','Fabricated B','read-family-a',0,1760000000000),
('read-c','c@example.test','Fabricated C','read-family-b',1,1760000000000);`)
  run(['d1', 'execute', ...databaseArgs, '--file', fixture])
  const server = net.createServer()
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const port = server.address().port
  await new Promise(resolve => server.close(resolve))
  const log = createWriteStream(logPath)
  worker = spawn(process.execPath, [wrangler, 'dev', '--local', '--config', configPath, '--persist-to', state, '--port', String(port)], { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'] })
  worker.stdout.pipe(log); worker.stderr.pipe(log)
  const url = `http://127.0.0.1:${port}/probe`
  let response
  for (let attempt = 0; attempt < 120; attempt++) {
    if (worker.exitCode !== null || worker.signalCode !== null) throw new Error('Local Worker exited before ready')
    try { response = await fetch(url); break } catch { await new Promise(resolve => setTimeout(resolve, 250)) }
  }
  assert.ok(response, 'Local Worker did not become ready')
  const first = await response.json()
  assert.equal(response.status, 200, JSON.stringify(first))
  assert.equal(first.refused.length, 11)
  // Fresh clients/primary sessions must work on concurrent Worker requests.
  await Promise.all(Array.from({ length: 12 }, async () => {
    const result = await fetch(url)
    assert.equal(result.status, 200, await result.text())
  }))
  const preferences = await fetch(`http://127.0.0.1:${port}/preferences`)
  const preferenceResult = await preferences.json()
  assert.equal(preferences.status, 200, JSON.stringify(preferenceResult))
  const settings = await fetch(`http://127.0.0.1:${port}/family-settings`)
  const settingsResult = await settings.json()
  assert.equal(settings.status, 200, JSON.stringify(settingsResult))
  const profiles = await fetch(`http://127.0.0.1:${port}/profiles`)
  const profileResult = await profiles.json()
  assert.equal(profiles.status, 200, JSON.stringify(profileResult))
  console.log(JSON.stringify({ ...first, concurrentRequests: 12, preferences: preferenceResult, settings: settingsResult, profiles: profileResult }))
} catch (error) {
  let output = ''
  try { output = await readFile(logPath, 'utf8') } catch { /* startup may fail before the log exists */ }
  console.error(output.slice(-6000))
  throw error
} finally {
  if (worker && worker.exitCode === null && worker.signalCode === null) {
    const stopped = new Promise(resolve => worker.once('exit', resolve))
    worker.kill('SIGTERM')
    await stopped
  }
  await rm(configPath, { force: true })
  await rm(scratch, { recursive: true, force: true })
}
