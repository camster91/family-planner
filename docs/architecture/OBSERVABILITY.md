# Observability Contract

Family Planner must be operable without exposing private household content.

## Structured request context
Target fields:
- request/trace ID;
- release/build identity;
- route/domain;
- status/error code;
- latency;
- pseudonymous actor/device/family identifier only where operationally necessary;
- retry/idempotency outcome where relevant.

Do not log message bodies, child names, exact addresses, medical/finance descriptions, tokens/secrets, arbitrary event text, grocery/food notes or full AI prompts.

## Metrics
Track by domain/release:
- request count/error rate/latency percentiles;
- DB connection/slow-query/timeout signals;
- background queue depth/retry/dead-letter where implemented;
- offline mutation replay/conflict/failure;
- notification provider outcome;
- AI latency/cost/schema/error outcome without prompt content;
- Android crash/ANR/build version;
- backup freshness/restore verification.

## Alerts
Alert on user impact and error budgets, not every transient exception. Define ownership/runbook link and recovery signal for each alert.

## Release markers
Dashboards/logs should make it possible to correlate a regression with exact server/client release identity.

## Privacy review
Every new telemetry field must answer why it is needed, retention, cardinality/cost risk and whether it contains private content. Analytics and operational telemetry have different purposes but share the same data-minimization rule.

## Scale
Observability should reveal objective extraction/scaling triggers from ADR-0001 rather than assume them.

## Implemented foundation (#161)

What exists in code today. Everything below is self-hosted: JSON lines on the container's stdout, no monitoring vendor.

### Request ID
- `src/middleware.ts` puts `X-Request-Id` on every response it handles (API routes, pages, CSRF 403s, auth redirects). The matcher skips `/_next/static`, `/_next/image` and `favicon.ico`.
- A well-formed inbound `X-Request-Id` (letters, digits, `-`, `_`; 8-64 characters) is kept so a proxy or client can correlate; anything else is replaced by a random UUID (`src/lib/request-id.ts`). The strict charset keeps the value safe in JSON logs and headers and too short to carry free text. It is correlation only: not a secret, not an authenticator, not guaranteed unique when a caller chose it.
- The middleware forwards the same id to route handlers as the `x-request-id` request header; handlers read it with `getRequestId(request)`, which falls back to one generated id per request object when the middleware did not run (unit tests).

### Build identity
`GET /api/version` returns exactly `{ version, commit, builtAt }` (`src/lib/build-info.ts`), `Cache-Control: no-store`, public like `/api/health`:
- `version`: `package.json` `version`, bundled at build time.
- `commit`: the `RELEASE_SHA` runtime variable, already wired before #161: `release.yml` passes `--build-arg RELEASE_SHA=${GITHUB_SHA}`, the Dockerfile runner stage bakes it in, and `deploy-vps.sh` sets it again on `docker run` after stripping the old container's value. Anything that is not 7-40 hex characters reads `"unknown"`. The same value is already public in the `X-Release-Commit` header of `/api/health`.
- `builtAt`: `FP_BUILT_AT`, inlined by `next.config.js` (`env`) when `next build` runs, so it is part of the bundle and a deploy cannot inherit an older value from the previous container's environment. `next dev` reports the dev-server start time. Missing or malformed reads `"unknown"`.

No environment dump, hostname, database, feature flag or secret is returned. No Dockerfile, workflow or deploy-script change was needed.

A support or test report quotes the `X-Request-Id` of the failing response (also `requestId` in adopted error bodies) and the `GET /api/version` body.

### Error envelope
`src/lib/api-error.ts`:
- `apiError(status, code, message, { requestId, shape?, headers?, retryable? })`.
  - `flat` (default) for routes whose clients read `error` as a string: `{ error: message, code, requestId }`. `error` keeps its meaning; `code` and `requestId` are additive.
  - `nested` for routes already on the API_CONTRACTS.md target shape: `{ error: { code, message, requestId, retryable? } }`.
  - `code` is UPPER_SNAKE_CASE (a malformed code becomes `INTERNAL_ERROR`). `message` is a fixed sentence written by the route, never exception text. The response also carries `X-Request-Id`.
- `logRouteError(route, error, requestId)` writes one line `{ event: 'route.error', route, requestId, errorName, errorCode? }` through `src/lib/logger.ts`. `errorName` is the exception class name when it is a plain identifier; `errorCode` is a short machine code such as Prisma `P2002` or Node `ECONNREFUSED`. The exception message, stack, Prisma `meta`, request body, URL, query string and any user/household id are never logged (Prisma and pg messages can quote column values).

### Route timing
`withRouteTelemetry(routeTemplate, handler)` (`src/lib/route-telemetry.ts`) wraps a handler. It ensures `X-Request-Id` on the response and, only when `ROUTE_TIMING_LOG=1`, writes one line per request:

```json
{"ts":"…","level":"info","event":"http.request","method":"GET","route":"/api/audit","status":200,"durationMs":12.7,"requestId":"…","release":"3ab5ecfb8b98"}
```

`route` is the fixed template given in code, never the raw URL, path ids or query. `ROUTE_TIMING_SAMPLE_RATE` (0-1, default 1) samples non-5xx lines; 5xx lines are always written while logging is on. Off by default, so production log volume does not change until an operator turns it on.

### Slow-query audit hook
`PRISMA_QUERY_TIMING=1` (optional `PRISMA_SLOW_QUERY_MS`, default 100; `0` logs every query) makes `src/lib/prisma.ts` subscribe to Prisma query events (`src/lib/db-query-timing.ts`) and write `{ event: 'db.slow_query', durationMs, statement }` for queries at or above the threshold. `statement` is the parameterised SQL with literals masked to `?`, cut to 300 characters; bound parameters are never read. Ignored when `NODE_ENV=production`: this is a development/test tool, not production telemetry.

### Fields and purposes

| Field | Where | Purpose | Private content? | Cardinality / cost | Retention |
|---|---|---|---|---|---|
| `requestId` | `X-Request-Id` header, adopted error bodies, `route.error`, `http.request` | Join a user/support report to server log lines | No: random UUID or a caller-chosen `[A-Za-z0-9_-]{8,64}` token | One per request; never a metric label | Container log rotation (`max-size=10m`, `max-file=3` in `deploy-vps.sh`) |
| `version`, `commit`, `builtAt` | `GET /api/version` | Name the exact server build in a report | No: public repository facts | Constant per build | Not stored |
| `release` | `http.request` | Correlate latency/errors with a release | No: first 12 hex of the public commit | One per deploy | Log rotation |
| `route` | `route.error`, `http.request` | Group by endpoint | No: fixed template in code | Bounded by the route count | Log rotation |
| `method`, `status` | `http.request` | Error rate by endpoint | No | Small fixed sets | Log rotation |
| `durationMs` | `http.request`, `db.slow_query` | Latency percentiles, slow paths | No | Numeric | Log rotation |
| `errorName`, `errorCode` | `route.error` | Classify failures (DB timeout, constraint, code bug) | No: class name and machine code only | Small | Log rotation |
| `statement` | `db.slow_query` (dev/test only) | Find slow query shapes | No: SQL with literals masked, no params | Bounded by query shapes | Local only |

No actor, device or household identifier is logged by these helpers. Add one only with a written reason under "Privacy review" above.

### Prohibited in any log line, header or telemetry field
Message bodies, child or member names, email addresses, exact addresses, medical/finance descriptions, tokens/secrets/cookies/passwords, free-form event/chore/list/note text, search queries, grocery/food notes, AI prompts and outputs, raw URLs with ids or query strings, request/response bodies, and exception messages or stacks from database errors. `docs/product/DATA_INVENTORY.md` lists the data classes.

### Incremental adoption plan
1. **Done (#161):** middleware request id; `GET /api/version`; `apiError`/`logRouteError`/`withRouteTelemetry` in `GET /api/audit`, `GET /api/search`, `GET`/`PATCH /api/users/preferences` and `GET /api/version`. Success bodies and status codes unchanged. `/api/health` keeps its `{ status }` body and `X-Release-Commit` header (the release workflow's post-deploy check reads them) and gets `X-Request-Id` from the middleware.
2. **Shared helpers next:** `src/lib/api-auth.ts` (401/403/400 no household), `src/lib/idempotency.ts`, `src/lib/feature-gate-server.ts` and rate-limit responses return `{ error }` without `code`/`requestId`. Adding the additive flat fields there covers most routes in one change; keep the existing `error` string.
3. **Done (route logging, #161 follow-up):** every `console.*` under `src/app/api/**` that logged a caught exception, its `.message`/`.stack` or interpolated request values now calls `logRouteError(route, error, getRequestId(request))`, or `logRouteWarning` (same fields, `event: 'route.warn'`) where the route recovers (an optional email or notification that did not send). A secondary failure inside a handler names itself in the route string, e.g. `POST /api/chores/create (assignment notification)`. Shared helpers with no request in scope pass a stable name and no request id (`idempotency.store`, `notification-service.send`, `list-item-update.section-tick`); the line then has no `requestId` field. `src/lib/prisma.ts`, `rate-limit-db.ts`, `capture.ts` (no provider error body, which can echo the prompt) and the browser reminder/notification helpers log a fixed string plus the error class name or HTTP status. Statuses, bodies and headers did not change. `src/app/api/__tests__/route-error-logs.test.ts` parses every route source and fails when a `console.*` call receives a caught exception (a `catch` variable or `.catch` callback parameter), any `.message`/`.stack`, or a template literal with substitutions; its reviewed allowlist is empty.
   Not yet converted: `log.error(event, error)` calls that pass an `Error` to `src/lib/logger.ts`, which serialises its message and stack (`/api/auth/login`, `/api/upload`, `device-http.ts` `deviceInternalError` (step 6), `device-audit.ts`, `device-session.ts`, `account-deletion.ts`), and `log.warn` lines with an error `message` (`/api/family/devices`, `device-session.ts`, `weather/board-weather.ts`). They move to `describeError`/`logRouteError` in a separate change. `src/lib/mail.ts` prints the whole email only in development without `MAILGUN_API_KEY` (production throws instead) and is left as a local-development aid.
4. **New routes** use `apiError` from the start: `nested` for new mobile/shared-device contracts (the API_CONTRACTS.md target), `flat` only where an existing client reads `error` as a string.
5. **Flat to nested** for an existing route is a breaking change for installed Android bundles: only with the API_CONTRACTS.md compatibility plan (old-client behaviour, window, rollout order, rollback).
6. **Device routes** (`src/lib/device-http.ts`, nested `{ error: { code, message, retryable } }`) add `requestId` inside the object in a separate change; `deviceInternalError` should switch to `logRouteError`.
7. **Metrics/alerts:** once `ROUTE_TIMING_LOG` is on in an environment, p50/p95 and 5xx rate per `route` can be computed from the JSON lines with `jq` or a self-hosted log tool. Alert thresholds wait for real production baselines; no paid vendor.

### Core dashboard query audit
The Today board (`/dashboard/today`, `GET /api/family/board-version` polled every 25 s while visible, `GET /api/device/today[/version]`) runs `loadTodayBoard` (`src/app/dashboard/today/board-snapshot.ts`, `today-board-data.ts`):

| Query | Bound | Index |
|---|---|---|
| `family.findUnique` (settings) | 1 row | primary key |
| `user.findMany` members | household size | `User(family_id)` |
| `event.findMany` not finished, starting before window end | `take: MAX_EVENTS` | `Event(family_id, start_time)` |
| `chore.findMany` due in window | `take: MAX_CHORES` | `Chore(family_id)`; no `(family_id, due_date)` composite |
| `familyMeal.findMany` dinners in window (meals on) | window days | `FamilyMeal(family_id, date)` |
| `listItem.findMany` + `count` open shopping items | `take: 5` + count | `ListItem(list_id, checked)` via `List(family_id, type)` |
| use-soon inventory (inventory on) | `limit` | see `src/lib/inventory.ts` |
| `calendarSubscription.findMany` names | ids from the page | primary key + `family_id` |
| `upload.findMany` ambient photos | `MAX_AMBIENT_PHOTOS` | primary key |

Findings, not fixed here:
- `GET /api/chores` and `GET /api/lists` return every row of the household with no `take`/pagination (API_CONTRACTS.md requires pagination for potentially unbounded collections). Chores grow with recurring series, so this is the first scale risk. Fix: an additive cursor/limit that installed clients can ignore.
- The Today-board chore query filters `family_id` + `due_date`; at scale a `Chore(family_id, due_date)` index would replace the `family_id` scan plus sort. Add it (expand-only migration) when the slow-query hook or `EXPLAIN` on a realistic household shows the need; with fixture data every table is small enough that Postgres scans sequentially.
- `board-version` recomputes the whole board to hash it on every poll (rate limit 1200/hour per member). It is the hottest path; watch its p95 in `docs/testing/PERFORMANCE_BASELINE.md` before adding tiles.

Plan: run `npm run perf:baseline` against a local server started with `PRISMA_QUERY_TIMING=1 PRISMA_SLOW_QUERY_MS=0` on the fixtures (and later a larger synthetic household), record the slowest statements, `EXPLAIN (ANALYZE, BUFFERS)` them on a disposable database, and propose indexes or limits in the domain's own issue. No polling or background job is added for this.