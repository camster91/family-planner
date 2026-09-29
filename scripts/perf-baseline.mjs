#!/usr/bin/env node
// Local performance baseline for core dashboard/API paths (#161).
//
//   PERF_BASE_URL=http://localhost:3000 npm run perf:baseline
//
// Signs in as the Family A parent fixture (public FAKE password, seeded by
// `npm run fixtures:seed`), then requests each endpoint sequentially
// PERF_WARMUP + PERF_ITERATIONS times and prints p50/p95/max per endpoint as a
// Markdown table, plus the server build from GET /api/version.
//
// Refuses any target that is not http(s) on a loopback host, and
// NODE_ENV=production (src/lib/perf-target.ts). Reads only response status and
// timing; response bodies are discarded (never printed or stored).
// See docs/testing/PERFORMANCE_BASELINE.md.

const lib = new URL('../src/lib/', import.meta.url)
const { assertLocalPerfTarget, percentile, PerfTargetRefusedError } = await import(new URL('perf-target.ts', lib).href)
const { FIXTURE_EMAILS, FIXTURE_PASSWORD } = await import(new URL('fixtures/dataset.ts', lib).href)

let origin
try {
  origin = assertLocalPerfTarget(process.env.PERF_BASE_URL, process.env)
} catch (err) {
  if (err instanceof PerfTargetRefusedError) {
    console.error(err.message)
    process.exit(1)
  }
  throw err
}

function intFromEnv(name, fallback, max) {
  const n = Number(process.env[name] ?? fallback)
  return Number.isInteger(n) && n >= 0 && n <= max ? n : fallback
}
const ITERATIONS = Math.max(1, intFromEnv('PERF_ITERATIONS', 30, 500))
const WARMUP = intFromEnv('PERF_WARMUP', 3, 50)

// Core dashboard/API paths. Route templates only; the query values are fixed
// synthetic strings. board-version is the polled Today-board path (25 s).
const ENDPOINTS = [
  { name: 'GET /api/version', path: '/api/version', auth: false },
  { name: 'GET /api/health', path: '/api/health', auth: false },
  { name: 'GET /dashboard/today (page)', path: '/dashboard/today', auth: true },
  { name: 'GET /api/family/board-version', path: '/api/family/board-version', auth: true },
  { name: 'GET /api/chores', path: '/api/chores', auth: true },
  { name: 'GET /api/events', path: '/api/events', auth: true },
  { name: 'GET /api/lists', path: '/api/lists', auth: true },
  { name: 'GET /api/search?q=', path: '/api/search?q=Fixture', auth: true },
  { name: 'GET /api/audit', path: '/api/audit', auth: true },
  { name: 'GET /api/users/preferences', path: '/api/users/preferences', auth: true },
]

async function signIn() {
  const res = await fetch(`${origin}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ email: FIXTURE_EMAILS.familyA.parent, password: FIXTURE_PASSWORD }),
    redirect: 'manual',
  })
  await res.arrayBuffer()
  if (res.status !== 200) {
    throw new Error(`fixture sign-in returned ${res.status}; run npm run fixtures:seed against this server's database`)
  }
  const cookies = res.headers.getSetCookie().map((c) => c.split(';')[0])
  const session = cookies.find((c) => c.startsWith('session_token='))
  if (!session) throw new Error('fixture sign-in set no session cookie')
  return cookies.join('; ')
}

async function timeOnce(url, cookie) {
  const started = performance.now()
  const res = await fetch(url, {
    headers: { Accept: 'application/json, text/html', ...(cookie ? { Cookie: cookie } : {}) },
    redirect: 'manual',
  })
  await res.arrayBuffer() // include body transfer in the timing; the bytes are discarded
  return { ms: performance.now() - started, status: res.status }
}

const fmt = (n) => (Number.isFinite(n) ? n.toFixed(1) : '-')

const version = await fetch(`${origin}/api/version`).then(
  async (r) => (r.ok ? r.json() : { status: r.status }),
  () => null
)
if (!version) {
  console.error(`perf:baseline: no server answering at ${origin}`)
  process.exit(1)
}

const cookie = await signIn()
const rows = []
for (const ep of ENDPOINTS) {
  const url = `${origin}${ep.path}`
  const auth = ep.auth ? cookie : undefined
  for (let i = 0; i < WARMUP; i++) await timeOnce(url, auth)
  const samples = []
  const statuses = new Map()
  for (let i = 0; i < ITERATIONS; i++) {
    const { ms, status } = await timeOnce(url, auth)
    samples.push(ms)
    statuses.set(status, (statuses.get(status) ?? 0) + 1)
  }
  rows.push({
    name: ep.name,
    statuses: [...statuses.entries()].map(([s, n]) => `${s}×${n}`).join(' '),
    p50: percentile(samples, 50),
    p95: percentile(samples, 95),
    max: Math.max(...samples),
  })
}

console.log(`Target: ${origin}  (loopback only)`)
console.log(`Server build: ${JSON.stringify(version)}`)
console.log(`Node ${process.version}, ${ITERATIONS} timed requests per endpoint after ${WARMUP} warm-up, sequential`)
console.log('')
console.log('| Endpoint | Status | p50 ms | p95 ms | max ms |')
console.log('|---|---|---:|---:|---:|')
for (const r of rows) console.log(`| ${r.name} | ${r.statuses} | ${fmt(r.p50)} | ${fmt(r.p95)} | ${fmt(r.max)} |`)
