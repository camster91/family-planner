# SLOs and performance budgets (beta)

Issues: #137 (reliability) and #134 (API contracts). Scope: the design-partner beta of about 5 households on the one VPS.

This page says how fast and how reliable the app should be during the beta, what we can measure today, and what we cannot measure yet. It adds no new servers, services, cron jobs or schedulers.

**Status: targets, not results.** No number on this page has been measured in production. The only recorded numbers are the local dev-server baseline in [`docs/testing/PERFORMANCE_BASELINE.md`](../testing/PERFORMANCE_BASELINE.md).

## Words used here

- **SLO** (service level objective): a goal we hold ourselves to, like "sign-in works 99% of the time".
- **Availability**: the share of requests (or minutes) that worked. A request "worked" if the server did not answer with a 5xx status and did not time out. A 4xx (wrong password, no access) counts as working: the server did its job.
- **p95 latency**: 95 out of 100 requests are this fast or faster. We use p95 because a few slow requests matter, but one freak request should not.
- **Server time**: from the request reaching the app to the response leaving it. It does not include the phone's network.
- **Error budget**: how much failure the SLO allows. A 99% goal allows 1% bad. While budget is left, we ship features. When it runs out, we fix reliability first.

## Beta SLOs

Measured over a rolling 30 days. Beta size: about 5 households, one VPS, one container, one Postgres.

### Availability

| What      | Routes                                                                                                                                                                              | Goal  | Allowed bad time per 30 days |
| --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----- | ---------------------------- |
| Sign-in   | `POST /api/auth/login`, `GET /api/auth/me`                                                                                                                                          | 99.0% | about 7 hours 12 minutes     |
| Core API  | `GET /api/chores`, `GET /api/events`, `GET /api/lists`, `GET /api/family/board-version`, `GET /api/device/today` and `/version`, and their common writes (create, update, complete) | 99.0% | about 7 hours 12 minutes     |
| Readiness | `GET /api/health` returns 200                                                                                                                                                       | 99.0% | about 7 hours 12 minutes     |

Why 99.0% and not higher: there is one server, one database and a deploy that swaps containers. A single bad deploy or a VPS reboot can eat hours. 99.0% is honest for that setup. Raise it only after we have real numbers and a second instance or faster rollback.

### Latency (server time, p95)

| Route                                                            |                                      p95 goal | Dev-server baseline p95 (2026-09-29, fixtures) |
| ---------------------------------------------------------------- | --------------------------------------------: | ---------------------------------------------: |
| `GET /api/chores`                                                |                                        300 ms |                                        27.1 ms |
| `GET /api/events`                                                |                                        300 ms |                                        38.8 ms |
| `GET /api/lists`                                                 |                                        300 ms |                                        33.4 ms |
| `GET /api/family/board-version` (Today board poll, every ~25 s)  |                                        300 ms |                                        35.8 ms |
| `GET /dashboard/today` (server-rendered page)                    |                                        800 ms |                                       136.0 ms |
| `POST /api/auth/login`                                           | 1000 ms (password hashing is slow on purpose) |                                   not measured |
| Common writes (create/complete chore, tick list item, add event) |                                       1000 ms |                                   not measured |
| `GET /api/health`                                                |                                        200 ms |                                        17.1 ms |

The baseline is a dev server on tiny fixture households, so it is a floor, not a promise. The goals leave room for real households, a production VPS and cold caches.

These sit under the product targets in [`FRIDGE_TABLET_PROGRAM.md`](../FRIDGE_TABLET_PROGRAM.md) §22 (for example "server-confirmed common mutations in <=2 seconds p95", which includes the network).

## Error budget for a 5-household beta

- **Goal 99.0%** means 1 in 100 requests (or about 7.2 hours a month) may fail.
- **Rough traffic:** a Today board left open polls about 144 times an hour. Five households with one open board for 12 hours a day, plus normal use, is roughly 10,000 to 20,000 requests a day, or 300,000 to 600,000 a month. 1% of that is 3,000 to 6,000 failed requests.
- **What spends it fast:** a 30-minute outage uses about 7% of the month's budget. A deploy that serves 5xx for 2 hours uses about 28%.

What we do with it:

| Budget used this month | Action                                                                                                                     |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Under 50%              | Normal. Ship features.                                                                                                     |
| 50% to 100%            | Next PRs that touch the failing area need a fix or a test for the cause first. Write a short note in the incident runbook. |
| Over 100%              | Stop feature releases. Only reliability fixes ship until the 30-day window is back under goal. Tell Cameron.               |

Some failures are never "budget". A data leak between households, a lost write, or private data on the shared tablet is a release blocker, even if it happened once (`AGENTS.md`, "Security and privacy").

## What is measured today, and how

| Signal                 | How it works                                                                                                                                                                                            | Where to see it                               | Gaps                                                                                                                                                                     |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Container health       | Docker `HEALTHCHECK` calls `/api/health` every 30 s (`Dockerfile`). `/api/health` runs `SELECT 1` and returns 200 `healthy` or 503 `degraded`.                                                          | `docker ps` (healthy / unhealthy) on the VPS  | Nobody is alerted. Docker does not restart on "unhealthy" by itself.                                                                                                     |
| Deploy gate            | `deploy-vps.sh` waits for the new container to be healthy before stopping the old one. The release workflow then checks the public `/api/health` returns 200 and the `X-Release-Commit` of the release. | GitHub Actions run log                        | Only checked at deploy time, not between deploys.                                                                                                                        |
| Request ids            | Every response through `src/middleware.ts` has `X-Request-Id` (`src/lib/request-id.ts`). Adopted error bodies repeat it as `requestId`.                                                                 | Browser dev tools, bug reports                | None for this purpose.                                                                                                                                                   |
| Server errors          | Unexpected route failures write one JSON line `{ event: 'route.error', route, requestId, errorName, ... }` (`logRouteError`, `src/lib/api-error.ts`). No private content.                               | `docker logs` on the VPS                      | Logs rotate at 3 x 10 MB, so they cover days, not 30 days. No counts are kept.                                                                                           |
| Route timing           | `withRouteTelemetry` writes `{ event: 'http.request', route, status, durationMs, ... }` when `ROUTE_TIMING_LOG=1`.                                                                                      | `docker logs`                                 | Off by default. Only on 4 routes today: `/api/audit`, `/api/search`, `/api/users/preferences`, `/api/version`. **Not** on chores, events, lists, board-version or login. |
| Local latency baseline | `npm run perf:baseline` times 10 endpoints against a local server on fixture data and prints p50/p95/max.                                                                                               | Terminal; record in `PERFORMANCE_BASELINE.md` | Local only (it refuses non-loopback targets). No production-build numbers yet.                                                                                           |
| Slow queries           | `PRISMA_QUERY_TIMING=1` logs slow SQL shapes.                                                                                                                                                           | Local terminal                                | Ignored in production by design.                                                                                                                                         |
| Beta product metrics   | `npm run beta:scorecard` reads daily counts per household.                                                                                                                                              | Terminal                                      | Product use, not reliability.                                                                                                                                            |

### Not measured yet

- **Uptime between deploys.** Nothing outside the VPS checks `/api/health`. If the site goes down at night, nobody knows until a family says so.
- **Availability numbers.** We have no count of good vs. bad requests over 30 days. The SLO tables above cannot be scored yet.
- **Latency of the key routes in production.** `GET /api/chores`, `/api/events`, `/api/lists`, `board-version`, `/dashboard/today` and login are not wrapped with `withRouteTelemetry`.
- **Client-side speed.** No Web Vitals (time to first paint, interaction delay) from real phones or the fridge tablet.
- **Android crashes and ANRs** (app not responding).
- **Web bundle size.** No size budget is checked in CI.
- **Log history.** Logs rotate after about 30 MB, so a month of history does not exist.

## Web client performance budgets

Targets only. None of these is checked automatically yet.

| Budget                                                            | Target                                                                  | Why                                                                                |
| ----------------------------------------------------------------- | ----------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| JavaScript for `/dashboard/today` (first load, compressed)        | 250 KB or less                                                          | The fridge tablet is a mid-range Android device that keeps this page open all day. |
| JavaScript for any other dashboard route (first load, compressed) | 300 KB or less                                                          | Phones on mobile data.                                                             |
| Cached Today board visible after warm launch                      | 2 s or less                                                             | `FRIDGE_TABLET_PROGRAM.md` §22                                                     |
| Today board interactive on normal Wi-Fi                           | 3 s or less                                                             | `FRIDGE_TABLET_PROGRAM.md` §22                                                     |
| Tap feedback (local toggle)                                       | 100 ms or less                                                          | `FRIDGE_TABLET_PROGRAM.md` §22                                                     |
| Board polling                                                     | One small version check about every 25 s, only while visible and online | Already built (`src/lib/board-sync.ts`). Do not add more polling.                  |
| Images                                                            | Sized for their slot; lazy outside the first screen                     | `FRIDGE_TABLET_PROGRAM.md` §22                                                     |

New big dependencies (charts, editors, date libraries) on a dashboard route should say in the PR how much JS they add.

## How to check

All of these use tools already in the repo or on the VPS. None changes production.

**Is the site up, and which build is it?** (public, read-only)

```bash
curl -sS -D - -o /dev/null https://family.ashbi.ca/api/health | grep -iE '^HTTP|^x-release-commit'
curl -sS https://family.ashbi.ca/api/version
```

**How fast are the key routes?** (local, on fixtures; steps in `docs/testing/PERFORMANCE_BASELINE.md`)

```bash
PERF_BASE_URL=http://localhost:3161 npm run perf:baseline
```

Compare p95 with the latency table above. Compare dev numbers only with dev numbers.

**What failed on the server?** (on the VPS, read-only; the container is named `family-planner-<tag>`)

```bash
C="$(docker ps --format '{{.Names}}' | grep '^family-planner-' | head -n1)"
docker inspect --format '{{.State.Health.Status}}' "$C"
docker logs "$C" 2>&1 | jq -R -c 'fromjson? | select(.event == "route.error") | .route' | sort | uniq -c | sort -rn
```

Look up one report by its request id:

```bash
docker logs "$C" 2>&1 | grep '"requestId":"<id from the report>"'
```

**p95 for a timed route** (only when `ROUTE_TIMING_LOG=1` is set; turning it on in production is an environment change that needs Cameron's approval):

```bash
docker logs "$C" 2>&1 | jq -R 'fromjson? | select(.event == "http.request" and .route == "/api/search") | .durationMs' \
  | sort -n | awk '{a[NR]=$1} END { if (NR) print "p95:", a[int(NR*0.95 + 0.999)] }'
```

**Do API errors keep the `{ error }` shape?**

```bash
npx jest src/app/api/__tests__/error-envelope.test.ts --ci
```

**Bundle size:** after a CI or local `npm run build`, open `/dashboard/today` in Chrome with the cache disabled and read the JS total in the Network tab (filter "JS"). Write the number in the PR when a change adds a large dependency.

## Follow-ups (not done here)

Each needs its own issue. None adds a cron job.

1. Wrap `GET /api/chores`, `/api/events`, `/api/lists`, `/api/family/board-version`, `POST /api/auth/login` and the device board routes with `withRouteTelemetry`, so their p95 can be read from logs. Small, additive.
2. Ask Cameron whether to turn on `ROUTE_TIMING_LOG=1` (maybe with `ROUTE_TIMING_SAMPLE_RATE=0.2`) in production. Environment change: needs approval.
3. An outside uptime check of `/api/health` with an alert. Needs Cameron's approval for the provider (a free self-hosted or hosted pinger) and where alerts go.
4. Keep more log history (larger rotation, or ship JSON lines to a self-hosted store) so a 30-day SLO can be scored.
5. Record a production-build baseline in `PERFORMANCE_BASELINE.md` on the CI runner.
6. A small script that sums `.next/static` JS per route after `npm run build` and fails over budget. Run it in CI next to the build.
7. Client Web Vitals from the fridge tablet and phones, content-free, after a privacy review (`OBSERVABILITY.md` "Privacy review").
8. API errors: add the flat `code` and `requestId` fields to the shared helpers (`src/lib/api-auth.ts`, `feature-gate-server.ts`, rate-limit responses), as planned in `OBSERVABILITY.md` "Incremental adoption plan" step 2. The new error-envelope test only checks bodies written inline in route files; bodies built by helpers or with a computed status are not checked.
