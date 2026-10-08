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
- `logRouteError(route, error, requestId)` writes one line `{ event: 'route.error', route, requestId, errorName, errorCode?, errorStatus? }` through `src/lib/logger.ts`. `errorName` is the exception class name when it is a plain identifier; `errorCode` is a short machine code such as Prisma `P2002`, Node `ECONNREFUSED` or an HTTP client's `ERR_BAD_RESPONSE`; `errorStatus` is an HTTP status number (100-599) from the error's `status`, `statusCode` or `response.status`. The exception message, stack, Prisma `meta`, request body, URL, query string and any user/household id are never logged (Prisma and pg messages can quote column values).

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
| `errorName`, `errorCode`, `errorStatus` | `route.error`, `route.warn`, any `log.*` line given a thrown value | Classify failures (DB timeout, constraint, provider status, code bug) | No: class name, machine code and HTTP status only | Small | Log rotation |
| `statement` | `db.slow_query` (dev/test only) | Find slow query shapes | No: SQL with literals masked, no params | Bounded by query shapes | Local only |

No actor, device or household identifier is logged by these helpers or by `log.*` calls. Add one only with a written reason under "Privacy review" above.

### Logger field rules
`src/lib/logger.ts` (`log.debug/info/warn/error`) is content-free by construction, in production (JSON) and development (text) format alike:
- A thrown value (the second argument of `log.error(event, error, context?)`, or any non-primitive context value) is written only as `errorName`, `errorCode` and `errorStatus` (`describeError`, exported from the logger and re-exported by `api-error.ts`). Its message, stack, `cause`, Prisma `meta`, HTTP response body/headers/config and every other field are never written. A thrown string or `null` is `errorName: "unknown"`.
- Context values must be strings, numbers, booleans or null; an object, array or Error in context is reduced as above. Keys `message`, `stack` and `cause` are dropped.
- `log.error(event, x)` with a plain object `x` and no third argument reads `x` as context (the `route.error` line). Where the thrown value could be a plain object, pass a context, even `{}`: `log.error('device.resolve_failed', error, {})`.
- Callers pass fixed event names and safe values: counts, durations, sizes, sniffed MIME types, enums (`kind`, audit `type`, calendar `provider`, account `role`), machine codes and upstream HTTP statuses. Never request values, names, emails, labels, filenames, tokens, IP addresses, free text or user/household/device/connection ids. To log a caught error on a warn line, spread `describeError(error)`.
- `src/lib/__tests__/logger.test.ts` proves no message or stack is written for an `Error`, Prisma-like, Axios-like, Node-like, `cause`-carrying, plain-object, string and null throw, in both formats. `src/app/api/__tests__/route-error-logs.test.ts` also parses every `log.*` call under `src` (no `.message`/`.stack`, no template literal, no caught exception except as `log.error`'s second argument or through `describeError`/`.name`/`.code`/`.status`, no id or free-text key) and every `console.*` call under `src/lib` (no `.message`/`.stack`, no caught exception beyond its identity).

### Prohibited in any log line, header or telemetry field
Message bodies, child or member names, email addresses, exact addresses, medical/finance descriptions, tokens/secrets/cookies/passwords, free-form event/chore/list/note text, search queries, grocery/food notes, AI prompts and outputs, raw URLs with ids or query strings, request/response bodies, and exception messages or stacks from database errors. `docs/product/DATA_INVENTORY.md` lists the data classes.

### Incremental adoption plan
1. **Done (#161):** middleware request id; `GET /api/version`; `apiError`/`logRouteError`/`withRouteTelemetry` in `GET /api/audit`, `GET /api/search`, `GET`/`PATCH /api/users/preferences` and `GET /api/version`. Success bodies and status codes unchanged. `/api/health` keeps its `{ status }` body and `X-Release-Commit` header (the release workflow's post-deploy check reads them) and gets `X-Request-Id` from the middleware.
2. **Shared helpers next:** `src/lib/api-auth.ts` (401/403/400 no household), `src/lib/idempotency.ts`, `src/lib/feature-gate-server.ts` and rate-limit responses return `{ error }` without `code`/`requestId`. Adding the additive flat fields there covers most routes in one change; keep the existing `error` string.
3. **Done (route logging, #161 follow-up):** every `console.*` under `src/app/api/**` that logged a caught exception, its `.message`/`.stack` or interpolated request values now calls `logRouteError(route, error, getRequestId(request))`, or `logRouteWarning` (same fields, `event: 'route.warn'`) where the route recovers (an optional email or notification that did not send). A secondary failure inside a handler names itself in the route string, e.g. `POST /api/chores/create (assignment notification)`. Shared helpers with no request in scope pass a stable name and no request id (`idempotency.store`, `notification-service.send`, `list-item-update.section-tick`); the line then has no `requestId` field. `src/lib/prisma.ts`, `rate-limit-db.ts`, `capture.ts` (no provider error body, which can echo the prompt) and the browser reminder/notification helpers log a fixed string plus the error class name or HTTP status. Statuses, bodies and headers did not change. `src/app/api/__tests__/route-error-logs.test.ts` parses every route source and fails when a `console.*` call receives a caught exception (a `catch` variable or `.catch` callback parameter), any `.message`/`.stack`, or a template literal with substitutions; its reviewed allowlist is empty.
   **Done (logger, #161 follow-up):** `src/lib/logger.ts` no longer writes an error's message or stack (see "Logger field rules"). `/api/auth/login` and `/api/upload` call `logRouteError`; `/api/family/devices` prune failures call `logRouteWarning`; `device-audit.ts`, `device-session.ts`, `account-deletion.ts`, `weather/board-weather.ts` and the `/device/today` page log a fixed event with `describeError` fields. The client IP (`auth.login`), user ids (`upload.photo`, `inventory.scan`, `event.import*`), upload filenames, device ids (`device.token_reuse_detected`; the audit row keeps it) and calendar connection ids (`account_deletion.calendar_revoke_failed`, now `provider` plus the error identity) are no longer logged. `src/lib/mail.ts` prints the whole email only in development without `MAILGUN_API_KEY` (production throws instead) and is left as a local-development aid.
4. **New routes** use `apiError` from the start: `nested` for new mobile/shared-device contracts (the API_CONTRACTS.md target), `flat` only where an existing client reads `error` as a string.
5. **Flat to nested** for an existing route is a breaking change for installed Android bundles: only with the API_CONTRACTS.md compatibility plan (old-client behaviour, window, rollout order, rollback).
6. **Device routes** (`src/lib/device-http.ts`, nested `{ error: { code, message, retryable } }`) add `requestId` inside the object in a separate change. Done: `deviceInternalError(where, error, requestId?)` logs through `logRouteError` (`route` is the stable name such as `device.chore_complete`, plus the request id every device route now passes) with its 500 response unchanged.
7. **Metrics/alerts:** once `ROUTE_TIMING_LOG` is on in an environment, p50/p95 and 5xx rate per `route` can be computed from the JSON lines with `jq` or a self-hosted log tool. Alert thresholds wait for real production baselines; no paid vendor.

### Product analytics: page views (#136, #140)
The app records no page views, screen views or clicks. Before this change `src/lib/analytics.ts` POSTed every route change (and landing-page button clicks) to `POST /api/analytics/event`, which wrote an `Activity` row per signed-in member with the raw browser path (record ids, and whatever the query string held) and client-supplied metadata. No feature used those rows (the activity feed hid them, no dashboard counted them, beta measurement uses `src/lib/beta-metrics.ts` only, decision D-6), so collection stopped instead of being trimmed:
- `src/lib/analytics.ts` and its provider are removed; the web app (which the Android shell loads from the server) sends nothing.
- `POST /api/analytics/event` stays for pages still open from an older bundle. It never reads `path` or `metadata`, ignores unknown fields and stores nothing. Responses keep their status codes: 400 for invalid JSON or a missing/non-string `event`, 200 otherwise (`{ success: true, skipped: true, reason: 'anonymous' | 'no_family' | 'not_stored' }`; the old success body had an `id`, which no client read), 500 on a server failure. CSRF still applies to signed-in callers.
- Existing rows (`Activity.type` = `event_` + event name, excluding the real `event_created` feed type) are kept at most 90 days (`LEGACY_ANALYTICS_RETENTION_DAYS`, `src/lib/legacy-analytics.ts`). A signed-in request to `POST /api/analytics/event` or `GET /api/activity` deletes that household's older rows: one statement on the `Activity(family_id, created_at)` index, scoped to the caller's household, never failing the request (a failure logs the error class only). No scheduled job. The `_` in the prefix is escaped because Prisma's `startsWith` is an unescaped LIKE (`event_` would otherwise also match `events_imported`).
- `GET /api/analytics` leaves these rows out of its recent-activity list. Until pruned they stay in the member's own account export and are deleted with the member or the household (`HOUSEHOLD_DELETION_PLAN` already covers `Activity`).
- A future product event needs its own reviewed design first (fixed event names, route templates such as `/dashboard/lists/[id]` rather than paths, no free-form metadata, a retention and a row in `docs/product/DATA_INVENTORY.md`), per "Privacy review" above.
- Optional PostHog client (`src/components/providers/posthog-provider.tsx`) only starts when `NEXT_PUBLIC_POSTHOG_KEY` is set at build time. The release workflow and `Dockerfile` do not set it, so CI-built images ship with it off; see `docs/product/THIRD_PARTY_PROCESSORS.md`.

Tests: `src/app/api/analytics/__tests__/event.test.ts` (status codes, nothing stored, prune scope and cutoff, dashboard exclusion), `src/lib/__tests__/legacy-analytics.test.ts`, and `src/lib/__tests__/legacy-analytics.integration.test.ts` (the prune filter against Postgres).

### Core dashboard query audit
The Today board (`/dashboard/today`, `GET /api/family/board-version` polled every 25 s while visible, `GET /api/device/today[/version]`) runs `loadTodayBoard` (`src/app/dashboard/today/board-snapshot.ts`, `today-board-data.ts`):

| Query | Bound | Index |
|---|---|---|
| `family.findUnique` (settings) | 1 row | primary key |
| `user.findMany` members | household size | `User(family_id)` |
| `event.findMany` not finished, starting before window end | `take: MAX_EVENTS` | `Event(family_id, start_time)` |
| `chore.findMany` due in window | `take: MAX_CHORES` | `Chore(family_id, due_date)` (added in #306, decision O-19) |
| `familyMeal.findMany` dinners in window (meals on) | window days | `FamilyMeal(family_id, date)` |
| `listItem.findMany` + `count` open shopping items | `take: 5` + count | `ListItem(list_id, checked)` via `List(family_id, type)` |
| use-soon inventory (inventory on) | `limit` | see `src/lib/inventory.ts` |
| `calendarSubscription.findMany` names | ids from the page | primary key + `family_id` |
| `upload.findMany` ambient photos | `MAX_AMBIENT_PHOTOS` | primary key |

Findings, not fixed here:
- `GET /api/chores` supports opt-in `?limit=1..200&cursor=` paging (#307, decision O-19); without `limit` it still returns every chore of the household so installed clients keep working, and the web chores page now pages only older verified chores ("Load more" under All; open and recent chores still load in full on the server). Moving the Android client and the other web callers (chore edit, travel) onto paging is the remaining step. `GET /api/lists` returns one row per list (with item counts), which stays small per household, so it has no paging (O-19).
- The Today-board and `GET /api/chores` queries filter `family_id` and order by `due_date`; the `Chore(family_id, due_date)` index (expand-only, #306) serves both. With fixture data every table is small enough that Postgres may still scan sequentially; confirm with the slow-query hook or `EXPLAIN` on a realistic household.
- `board-version` recomputes the whole board to hash it on every poll (rate limit 1200/hour per member). It is the hottest path; watch its p95 in `docs/testing/PERFORMANCE_BASELINE.md` before adding tiles.

Plan: run `npm run perf:baseline` against a local server started with `PRISMA_QUERY_TIMING=1 PRISMA_SLOW_QUERY_MS=0` on the fixtures (and later a larger synthetic household), record the slowest statements, `EXPLAIN (ANALYZE, BUFFERS)` them on a disposable database, and propose indexes or limits in the domain's own issue. No polling or background job is added for this.
### Local offline queue reports (#135)

The support projection and exact semantics are in `OFFLINE_SYNC.md` → Local sync support diagnostics.
Purpose: explain pending/replay problems without copying household content. Fields are fixed counts,
booleans and null-or-numeric rates (no string cardinality). Retention: queue-instance memory only, reset
on clear/auth loss/disposal; no database, storage, log or remote sink. Collection: internal local
counters, with deliberate user viewing/copying in Help. No analytics consent/disclosure or provider
boundary is widened. Fleet collection needs a separately reviewed transmission/consent/retention design.
