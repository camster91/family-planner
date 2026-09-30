# Performance baseline (#161)

A reproducible, local-only latency baseline for the core dashboard and API paths, on the synthetic fixture households (`TEST_DATA.md`). It is for spotting regressions between commits on the same machine, not a production SLO.

## How to reproduce

```bash
# 1. A disposable database the fixture guard accepts (loopback host)
export DATABASE_URL=postgresql://postgres:postgres@localhost:5432/fp_perf_local
createdb -h localhost -U postgres fp_perf_local
node scripts/migrate.js
# Anchor the fixtures at today so the Today board has today's events and chores
FIXTURES_ALLOW=1 FIXTURES_ANCHOR_DATE="$(date -u +%Y-%m-%dT12:00:00Z)" npm run fixtures:seed

# 2. A local server on that database (production build preferred; see "Environment")
export JWT_SECRET="$(openssl rand -hex 32)" NEXT_TELEMETRY_DISABLED=1 RELEASE_SHA="$(git rev-parse HEAD)"
npm run build && npx next start -p 3161      # or: npx next dev --webpack -p 3161

# 3. In another shell
PERF_BASE_URL=http://localhost:3161 npm run perf:baseline
# Options: PERF_ITERATIONS (default 30), PERF_WARMUP (default 3)
```

`scripts/perf-baseline.mjs` signs in once as the Family A parent fixture (public fake password), then requests each endpoint sequentially, `PERF_WARMUP` untimed then `PERF_ITERATIONS` timed, including body transfer, and prints a Markdown table with nearest-rank p50/p95 and the max. It prints the `GET /api/version` body so the table names the exact build. Response bodies are discarded, never printed or stored.

It refuses any target that is not http(s) on a loopback host (`localhost`, `127.x.x.x`, `::1`), URLs with credentials, and `NODE_ENV=production` (`src/lib/perf-target.ts`, unit-tested). It adds no polling, no background job and no server code path; it is a one-shot command.

To see which queries dominate, start the server with `PRISMA_QUERY_TIMING=1 PRISMA_SLOW_QUERY_MS=0` and/or `ROUTE_TIMING_LOG=1` (`architecture/OBSERVABILITY.md`). Record numbers with both **off**: the extra log lines add latency.

## Endpoints

| Endpoint | Why |
|---|---|
| `GET /api/version` | Framework + middleware floor (no database) |
| `GET /api/health` | Readiness probe (`SELECT 1`) |
| `GET /dashboard/today` (page) | The home/Today board, server-rendered |
| `GET /api/family/board-version` | The Today board's 25 s change poll: recomputes and hashes the board |
| `GET /api/chores`, `/api/events`, `/api/lists` | Core collection reads (chores and lists are unbounded, see OBSERVABILITY.md) |
| `GET /api/search?q=` | Household search (fixed synthetic query) |
| `GET /api/audit` | Household audit history, first page |
| `GET /api/users/preferences` | Small own-row read |

## Recorded baselines

### 2026-09-29 — development server (NOT a production build)

**Label: dev-server baseline.** `npm run build` was not run on this machine (about 1 GB of free disk), so these numbers come from `next dev --webpack`, which compiles on demand and adds dev-only overhead (React dev mode, source maps, no minification). Compare dev numbers only with dev numbers. A production-build baseline is **to be recorded on the CI runner or a machine with disk space** using the commands above.

- Commit `3ab5ecfb8b98121b3c3a4e2b7adc2f80ddaa1290` plus the uncommitted #161 working tree (the branch this doc was added on); `/api/version` reported `{"version":"0.1.0","commit":"3ab5ecfb…","builtAt":"2026-09-29T18:08:56.470Z"}`.
- Next.js 16.3.5 (`next dev --webpack`), Node v22.22.2, PostgreSQL 16.13 on the same host (loopback), 4 vCPU Intel Xeon @ 2.10 GHz, 15 GiB RAM, Linux container.
- Fixtures seeded with `FIXTURES_ANCHOR_DATE=2026-09-29T12:00:00Z`; signed in as `parent.a@example.test` (Family A, parent). `ROUTE_TIMING_LOG` and `PRISMA_QUERY_TIMING` off.
- 30 timed requests per endpoint after 3 warm-up, sequential, one client.

| Endpoint | Status | p50 ms | p95 ms | max ms |
|---|---|---:|---:|---:|
| GET /api/version | 200×30 | 12.3 | 16.5 | 17.8 |
| GET /api/health | 200×30 | 11.8 | 17.1 | 17.1 |
| GET /dashboard/today (page) | 200×30 | 114.2 | 136.0 | 137.0 |
| GET /api/family/board-version | 200×30 | 25.6 | 35.8 | 41.7 |
| GET /api/chores | 200×30 | 18.8 | 27.1 | 33.6 |
| GET /api/events | 200×30 | 22.5 | 38.8 | 39.1 |
| GET /api/lists | 200×30 | 23.3 | 33.4 | 38.4 |
| GET /api/search?q= | 200×30 | 22.6 | 31.0 | 31.4 |
| GET /api/audit | 200×30 | 18.5 | 24.6 | 24.9 |
| GET /api/users/preferences | 200×30 | 17.6 | 27.3 | 29.5 |

Reading it: the middleware/framework floor on this dev server is about 12 ms; single-household API reads add roughly 5-15 ms at fixture size; the server-rendered Today page is the most expensive path. Fixture households are tiny (a dozen chores and events), so these numbers say nothing about large households; the unbounded `GET /api/chores` and `GET /api/lists` are the first to grow.

### Production build

To be recorded on the CI runner (or a machine with enough disk) with `npm run build && npx next start`, using the commands above. Do not fill this in with estimates.
