# Coolify Deploy Runbook

**Status:** immutable-image Coolify handoff is being prepared under #145. Today production is still promoted by `release.yml` (`Release to VPS`, see `DEPLOYMENT.md` and `docs/engineering/CI_AND_RELEASE.md`). The consolidation target is the saved image checked by CI, including its imported-image household tests, rather than a new build on the VPS. The registry publisher is implemented behind the initially disabled `FP_IMMUTABLE_RELEASE_ENABLED` flag. Actual publication, registry access, resource/data/uploads adoption and production handoff remain outstanding.

This runbook does not authorize anything. Creating the Coolify application, setting production secrets, pointing DNS, moving data, turning on scheduled backups and every deploy or rollback are owner actions that need Cameron's explicit approval (`AGENTS.md`, approval boundaries).

Facts here come from the source on `main` (Dockerfile, `docker-entrypoint.sh`, `scripts/migrate.js`, `src/app/api/health/route.ts`, `src/lib/client-ip.ts`, the env reads under `src/`). Coolify UI labels move between versions. Where a label is named below, look for the closest match in your version.

## 1. Decisions before you start

1. **One owner for production.** Do not run `release.yml` `Release to VPS` and Coolify against the same hostname. Pick one. If Coolify takes over, stop dispatching `Release to VPS` (it would also fail: it looks for the old Traefik-labelled container). Update `DEPLOYMENT.md` and `CI_AND_RELEASE.md` in the same change that switches.
2. **Consume the checked image.** Use the immutable GHCR digest recorded by the checked default-branch publisher when that path is activated. Prerequisites: the repository variable `FP_IMMUTABLE_RELEASE_ENABLED=true` (owner action) and a push to the default branch (`main` since 2026-10-01; the job compares against `github.event.repository.default_branch`, so a rename needs no workflow change). Publication must load and verify the existing CI archive, never rebuild it. The publisher saves a source/run/attempt-bound draft receipt asset and refetches it to verify identical bytes. The Dockerfile instructions below remain reference material for a separate source-build setup; they are not the selected automatic deployment path.
3. **One proxy owner.** The current VPS already has Traefik serving ports80/443 and a Coolify installation. Keep the existing proxy owner until the reviewed routing handoff; do not start a competing proxy. Resource configuration, data/uploads adoption, private acceptance and rollback must precede public routing changes.

## 2. Reference source-build setup: Dockerfile

For a separately approved source-build setup: **Dockerfile** build pack, file `/Dockerfile`, base directory `/`. For the consolidation handoff, prepare the checked registry image path described above instead.

Why, from this repo:

- `Dockerfile` is the one CI builds and smoke-tests on every PR (`release.yml` "Build container image" and "Smoke test container readiness"). Coolify would run the same recipe.
- It already runs migrations on start, has a `HEALTHCHECK` on `/api/health`, runs as non-root uid 1001, and listens on port 3000.
- `docker-compose.yml` is a local, self-contained stack. It starts its own Postgres with a fixed `container_name`, publishes port 3000 on the host, has no uploads volume and requires `POSTGRES_PASSWORD`/`DATABASE_URL` from a `.env`. Coolify's compose mode would need all of that reworked, and a database inside the app's compose stack is harder to back up and upgrade than a Coolify-managed database.
- A separate Coolify-managed Postgres gives you its own lifecycle, backups UI and upgrades, independent of app deploys.

`docker-compose.coolify-development.json` (#327) is the owner's Coolify **development** setup. It builds the same `Dockerfile`, reads `.env`, exposes port 3000 to Coolify's proxy only (no host port), joins the existing external `family-planner-internal` network to reach the retained database, and bind-mounts the existing host uploads directory `/opt/family-planner/uploads` to `/data/family-planner-uploads`. That host directory must be owned by `1001:1001` (section 7). It passes only `SOURCE_COMMIT` as a build argument, so `NEXT_PUBLIC_APP_URL` keeps the Dockerfile default `https://family.ashbi.ca` in email and invite links; on a different test hostname, add it as a build argument too (section 10). It is not a production cut-over; sections 1 and 12 still apply.

## 3. Reference: database for a new installation

The existing VPS production database is PostgreSQL16.14, inspected on October1,
2026. It must be backed up and adopted or copied for staging; this reference does
not authorize replacing it. CI exercises both PostgreSQL17 and the imported
runtime on PostgreSQL16. A major-version upgrade is a separate recovery and
compatibility decision.

1. In the same Coolify project and environment (and same server) as the app, add a **PostgreSQL** database. Use **Postgres 17** (`postgres:17-alpine`): CI and `docker-compose.yml` test against 17. 16 also works with the current SQL, but 17 is what is tested.
2. Set the database name to `family_planner` (any name matching `^[a-zA-Z0-9_]+$` works; `scripts/migrate.js` refuses other names).
3. Keep it **not publicly accessible**. The app reaches it over Coolify's internal Docker network.
4. Copy the **internal** connection URL. It looks like:

   ```text
   postgres://<user>:<password>@<database-container-name>:5432/family_planner
   ```

   `postgres://` and `postgresql://` both work (`src/lib/prisma.ts`). If the password has URL-special characters (`@ : / ? # %`), percent-encode them. No `sslmode` is needed on the internal network.

Migrations connect to the `postgres` maintenance database first to create the target database if it is missing. With Coolify's default superuser that works. If your role cannot reach `postgres`, set `MIGRATE_FALLBACK_DB` or create the database yourself; the migration then continues against the target database.

## 4. Create the application

1. New resource → **Public/Private Repository** (GitHub App) → `camster91/family-planner`, branch `main`.
2. Build pack: **Dockerfile**. Dockerfile location `/Dockerfile`.
3. **Ports Exposes:** `3000`.
4. **Ports Mappings:** leave empty. Publishing 3000 on the host lets clients bypass Traefik, which also breaks the client-IP trust model (section 8).
5. **Domain:** `https://family.ashbi.ca` (or a test hostname first). DNS changes are Cameron's action.
6. **Turn off Auto Deploy** (deploy on push). Every production deploy must be a deliberate, approved action, never a side effect of merging.
7. **Turn off Preview Deployments** (per-PR deploys). A preview would run unreviewed PR code with the production environment and database.
8. Turn on **include source commit in build** (Coolify passes `SOURCE_COMMIT` as a build argument only when this is on). See section 9.
9. Do not add a pre- or post-deployment command. Migrations already run in the container entrypoint.

## 5. Health check

Configure Coolify's health check to match the image's own `HEALTHCHECK`:

| Setting | Value |
| --- | --- |
| Enabled | yes |
| Method / scheme / host | `GET`, `http`, `localhost` |
| Port | `3000` |
| Path | `/api/health` |
| Expected status | `200` |
| Interval / timeout / retries | `30` s / `10` s / `3` |
| Start period | `60` s |

What `/api/health` does (`src/app/api/health/route.ts`): it runs `SELECT 1` through Prisma and checks that `DATABASE_URL` and `JWT_SECRET` are set. It returns `200 {"status":"healthy"}` only when all three pass, otherwise `503 {"status":"degraded"}`. It never returns error text or configuration. It sends `Cache-Control: no-store` and, when `RELEASE_SHA` is set, the `X-Release-Commit` header.

`/api/health/live` is a liveness-only probe (no database). Do not use it as the deploy health check: a container that cannot reach the database would pass.

With a passing health check, Coolify keeps the old container serving until the new one is healthy (rolling update). This needs no host port mapping and no custom container name.

The image has `wget` installed, which Coolify's health check can use.

## 6. Migrations on container start

Verified in source:

- `docker-entrypoint.sh` runs with `set -e`. When `DATABASE_URL` is set it runs `node /app/scripts/migrate.js`, then `exec node server.js`.
- `migrate.js` exits `1` and logs `Schema migration failed:` / `Migration script failed:` if the schema SQL, any `database/migration-*.sql` file or the post-feature SQL fails. With `set -e` the container then exits before the server starts, the health check never passes, and Coolify marks the deployment failed while the old container keeps serving.
- It also exits `1` if the database name in `DATABASE_URL` is not `^[a-zA-Z0-9_]+$`.
- Softer steps (warn and continue): if it cannot connect to the `postgres` maintenance database to check or create the target database, it logs a warning and continues. The next step then fails loudly if the target database really does not exist.
- If `DATABASE_URL` is empty, the entrypoint prints `WARNING: DATABASE_URL not set, skipping migration` and runs `node server.js`, but the server refuses to start: with `NODE_ENV=production` the startup check (`src/instrumentation.ts` → `assertProductionEnv` in `src/lib/env-check.ts`) logs `[env] FATAL: DATABASE_URL is not set.` and throws `Refusing to start: ...`. The same happens for a missing or short `JWT_SECRET`. No server answers, the health check never passes, and Coolify marks the deployment failed while the old container keeps serving. Look for `[env] FATAL:` in the deployment log.
- Migrations are forward-only and idempotent (CI runs them twice on every PR). There is no down-migration. During a rolling update the new container migrates while the old one still serves, so schema changes must stay expand/contract compatible (`AGENTS.md`, mobile/server compatibility).

Read the deployment log for the lines `Schema migration completed successfully` and `Post-feature schema migration completed successfully` before trusting a deploy.

## 7. Persistent storage

One path must persist across deploys:

| Container path | What | Needed |
| --- | --- | --- |
| `/data/family-planner-uploads` | Uploaded chore photos (`<dir>/chores/...`), served by `/api/files/**`, deleted by account deletion. Default of `UPLOAD_DIR` in `src/app/api/upload/route.ts`, `src/app/api/files/**` and `src/lib/account-deletion.ts`. | **Yes** |

Nothing else is written to disk at runtime (`/app/.next/cache` is a rebuildable cache).

In Coolify → Persistent Storage, add a **volume mount** with destination `/data/family-planner-uploads`. Leave `UPLOAD_DIR` unset so the app uses that path.

Ownership: the app runs as uid 1001 (`nextjs`). The Dockerfile creates `/data/family-planner-uploads` owned by uid 1001, so a new, empty named volume starts writable. If you use a host **directory/bind mount** instead, the host directory must be owned by `1001:1001` first.

After the first deploy, prove it is writable (Coolify terminal into the app container):

```sh
touch /data/family-planner-uploads/.write-probe && rm /data/family-planner-uploads/.write-probe && echo writable
```

Coolify database backups do not include this volume. Back it up separately (section 11).

## 8. TRUSTED_PROXY_HOPS and Coolify's Traefik

What the code does (`src/lib/client-ip.ts`): it splits `X-Forwarded-For`, and takes the entry `TRUSTED_PROXY_HOPS` places from the **right** (default and minimum `1`, meaning the last entry). That IP is used for rate limits (login, register, password reset, family join and invites, handoff share, device pairing). Entries further left are client-supplied and forgeable.

So the correct value is **the number of proxies you control that each append one address** between the internet and the app.

Coolify's proxy is Traefik. By default Traefik does not trust incoming `X-Forwarded-*` headers from clients: it drops the client's value and writes `X-Forwarded-For: <address that connected to Traefik>`. So:

| Setup | Header the app sees | Value |
| --- | --- | --- |
| Browser → Coolify Traefik → app (DNS-only, no CDN) | `<client>` | **`1`** (recommended) |
| Browser → Cloudflare proxy (orange cloud) → Traefik → app, Traefik **not** configured to trust Cloudflare | `<Cloudflare edge IP>` | `1` still picks the right-most entry, but every user shares Cloudflare's IPs and rate limits misfire. Fix Traefik first. |
| Browser → Cloudflare → Traefik with `forwardedHeaders.trustedIPs` set to Cloudflare's ranges | `<client>, <Cloudflare edge IP>` | `2` |

`1` is only correct when Traefik is the only proxy and the app port is not published on the host (section 4). A published port lets anyone connect directly and send a forged `X-Forwarded-For`, whose right-most value the app would then trust.

**The origin must only be reachable through the declared proxy chain.** Every client-address header is forgeable by anyone who can connect to the app container directly, so do not publish the app port on the host, do not expose it on a public network, and (if a CDN sits in front) restrict Traefik to the CDN's address ranges.

`X-Real-IP` is a fallback for requests with no `X-Forwarded-For`. It is read **only when `TRUSTED_PROXY_HOPS` is explicitly set** (a whole number of at least `1`), because then a declared proxy is expected to overwrite it. When the variable is unset, a request without `X-Forwarded-For` is rate-limited under the shared `unknown` key instead, so a direct caller cannot pick a fresh key per request by sending a new `X-Real-IP`.

How to confirm the hop count (owner action, on a throwaway hostname): deploy the `traefik/whoami` image behind the same Coolify proxy and DNS setup, open it from a phone on mobile data, and read the `X-Forwarded-For` line. Count the addresses added by proxies you run (not the one your client sent). Set `TRUSTED_PROXY_HOPS` to that count. Delete the whoami service afterwards.

## 9. Release commit, `/api/health` and `/api/version`

- `/api/health` sends `X-Release-Commit: <RELEASE_SHA>`; `/api/version` returns `{ version, commit, builtAt }`, where `commit` is `RELEASE_SHA` when it is 7 to 40 hex characters, otherwise `unknown` (`src/lib/build-info.ts`). `builtAt` is set automatically at `next build`.
- `release.yml` passes `--build-arg RELEASE_SHA=${GITHUB_SHA}`.
- For Coolify the Dockerfile also accepts `SOURCE_COMMIT` and uses it when `RELEASE_SHA` is empty: `ENV RELEASE_SHA=${RELEASE_SHA:-${SOURCE_COMMIT}}` in the final stage. Turn on Coolify's "include source commit in build" option so Coolify passes the commit it built.
- Fallback: if `RELEASE_SHA` is still empty at runtime and `SOURCE_COMMIT` is in the container environment, `docker-entrypoint.sh` copies it into `RELEASE_SHA`.
- Do **not** set `RELEASE_SHA` by hand in Coolify's environment: a stale value would make health verification lie.

Verify after each deploy (compare with the commit you approved):

```sh
curl -sS -D - -o /dev/null -H 'Cache-Control: no-cache' https://family.ashbi.ca/api/health | grep -i -E '^HTTP|x-release-commit'
curl -sS https://family.ashbi.ca/api/version
```

Expect `HTTP/2 200`, `x-release-commit: <full sha>` and the same `commit` in `/api/version`. If the header is missing or `commit` is `unknown`, the source-commit option is off; fix it before relying on health verification.

## 10. Environment variables

Set these in Coolify → Environment Variables. Mark only `NEXT_PUBLIC_APP_URL` as a **build** variable; everything else is **runtime only**. Never mark `DATABASE_URL` or any secret as build-time (the builder stage declares a placeholder `DATABASE_URL` build arg; a real value would land in the build cache on the host).

"Keep off" means: leave unset or empty until Cameron approves that feature for production.

### Required

| Variable | Default | What it does | Production value |
| --- | --- | --- | --- |
| `DATABASE_URL` | none | Postgres connection for the app (`src/lib/prisma.ts`) and for `migrate.js` on start. Without it the app is degraded and `/api/health` is 503. | Coolify internal URL from section 3. |
| `JWT_SECRET` | none (dev fallback only outside production) | Signs sessions (`src/lib/auth.ts`); also the key source for encrypted per-family AI keys (`src/lib/secret-box.ts`). Production refuses to start auth with a missing or shorter than 32 character value. | **When moving existing data, copy the current production value.** A new value signs everyone out and makes stored encrypted keys unreadable. For a brand-new install: `openssl rand -hex 32`. |
| `NEXT_PUBLIC_APP_URL` | `https://family.ashbi.ca` (Dockerfile build arg) | Public origin for email links, invite links, handoff links, verify-email redirects, calendar OAuth fallback. Inlined at **build** time. | `https://family.ashbi.ca` (or the test hostname). Build variable **and** runtime. Changing it needs a redeploy (rebuild). |

### Recommended

| Variable | Default | What it does | Production value |
| --- | --- | --- | --- |
| `TRUSTED_PROXY_HOPS` | `1` | Which `X-Forwarded-For` entry is the client IP for rate limits (section 8). | `1` for Coolify Traefik with no CDN in front. |
| `MAILGUN_API_KEY` | unset | Sends verification and password-reset email, and the opt-in morning summary (O-40). Unset in production: account sends fail (caught and logged), so users get no email; the morning summary is then in-app only. | Copy from current production. |
| `MAILGUN_DOMAIN` | `ashbi.ca` | Mailgun sending domain. | `ashbi.ca` |
| `MAILGUN_FROM` | `Family Planner <noreply@ashbi.ca>` | From address. | `Family Planner <noreply@ashbi.ca>` |
| `FROM_EMAIL` | unset | Older fallback for `MAILGUN_FROM`. | Leave unset. |

### Set by the image (do not override)

| Variable | Value | Notes |
| --- | --- | --- |
| `NODE_ENV` | `production` | Secure cookies, HSTS, strict `JWT_SECRET`, no dev fallbacks, design gallery off. |
| `PORT` / `HOSTNAME` / `HOST` | `3000` / `0.0.0.0` / `0.0.0.0` | Must match "Ports Exposes" `3000`. |
| `NEXT_TELEMETRY_DISABLED` | `1` | |
| `RELEASE_SHA` | build arg, or `SOURCE_COMMIT` | Section 9. Do not set by hand. |
| `FP_BUILT_AT` | set at `next build` | Not a runtime variable. |
| `SOURCE_COMMIT` | Coolify | Build arg (and possibly runtime); only used as the `RELEASE_SHA` fallback. |

### Optional operations

| Variable | Default | What it does | Production value |
| --- | --- | --- | --- |
| `UPLOAD_DIR` | `/data/family-planner-uploads` | Upload storage path. | Leave unset; mount the volume at the default (section 7). |
| `MIGRATE_FALLBACK_DB` | unset | Maintenance database `migrate.js` uses if `postgres` is unreachable. | Leave unset. |
| `LOG_LEVEL` | unset | `debug` prints debug log lines. | Leave unset. |
| `ROUTE_TIMING_LOG` / `ROUTE_TIMING_SAMPLE_RATE` | off / `1` | Opt-in per-request timing log lines (`src/lib/route-telemetry.ts`). | Leave unset unless investigating performance. |
| `TZ` | unset (UTC in the container) | Process time zone. The AI capture prompt falls back to `America/Toronto` when unset. | Match what current production has; if unsure, leave unset. |
| `CRON_SECRET` | unset | Shared secret (`x-cron-secret` header) for `POST /api/cron/recurring-chores` and `POST /api/cron/morning-summary` (O-40). Unset keeps both endpoints closed (500); a wrong or missing header is 401. Setting it schedules nothing by itself. | **Keep off** until Cameron sets up a schedule ("Scheduled tasks" below). Any scheduler calling these needs Cameron's approval (`AGENTS.md`). At least 32 random characters: `openssl rand -hex 32`. |
| `SHARED_DEVICE_ENABLED` | off | Shared fridge-tablet device routes. Off: every device route is 404. | `false`. **Keep off** until approved. |

### Keep off until Cameron approves (paid providers or data leaving the server)

| Variable | Default | What it turns on | Production value |
| --- | --- | --- | --- |
| `CAPTURE_AI_SETTINGS_ENABLED` | off | Shows the per-family "AI capture" key form in Settings (provider URL, model, key). Only `1`/`true` turns it on. Off: the form is hidden, except for a household that already saved a key (so it can remove it). The API and capture itself do not change. | `false` or unset. |
| `CAPTURE_AI_KEY` | unset | Deployment-wide AI capture fallback key (families can still add their own key in Settings). | **Unset.** |
| `CAPTURE_AI_BASE_URL` / `CAPTURE_AI_MODEL` | provider defaults in `src/lib/capture.ts` | Endpoint and model for the above. | **Unset.** |
| `INVENTORY_SCAN_ANTHROPIC_API_KEY` | unset | Fridge photo scan (`docs/runbooks/INVENTORY_SCAN.md`). | **Unset.** |
| `INVENTORY_SCAN_MODEL` / `INVENTORY_SCAN_DAILY_LIMIT` | code defaults / `20` | Scan model and daily household cap. | **Unset.** |
| `EVENT_IMPORT_ANTHROPIC_API_KEY` | unset | Event import from text, photo or PDF (`docs/runbooks/EVENT_IMPORT.md`). | **Unset.** |
| `EVENT_IMPORT_MODEL` / `EVENT_IMPORT_DAILY_LIMIT` | code defaults | Import model and daily cap. | **Unset.** |
| `WEATHER_ENABLED` | off | Open-Meteo weather tile and place search. Only `1`/`true` turns it on. | `false` or unset. |
| `APP_URL`, `CALENDAR_TOKEN_KEY`, `CALENDAR_TOKEN_KEY_PREVIOUS`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `MICROSOFT_CLIENT_ID`, `MICROSOFT_CLIENT_SECRET`, `MICROSOFT_TENANT` | unset | Two-way calendar sync (`docs/runbooks/CALENDAR_SYNC.md`). Dormant unless the token key, an https app URL and a provider's id and secret are all set. | **All unset.** |
| `NEXT_PUBLIC_POSTHOG_KEY` / `NEXT_PUBLIC_POSTHOG_HOST` | unset | Browser analytics. Build-time only, and the Dockerfile does not pass them as build args, so setting them in Coolify has no effect today. | **Unset.** |
| `DESIGN_GALLERY_ENABLED` | off in production | Exposes the `/dev/design-system` QA gallery. | **Unset.** |

Beta usage metrics have no environment switch. They are a per-household setting in the database (`beta_metrics_enabled`, default off). Leave them off.

### Never set in production

`SKIP_ENV_VALIDATION` (build-only), `FIXTURES_ALLOW`, `FIXTURES_ANCHOR_DATE`, `RUN_DB_INTEGRATION`, `PRISMA_QUERY_TIMING`, `PRISMA_SLOW_QUERY_MS`, `PERF_BASE_URL`, `PERF_ITERATIONS`, `PERF_WARMUP`, `E2E_*`, `REHEARSAL_*`, `CI`. These belong to tests, fixtures and local tooling; several are refused in production anyway.

### Scheduled tasks

The app runs **no scheduler of its own** (`AGENTS.md`). Work that should happen on a clock is a protected endpoint the owner calls on a schedule they create. Nothing below runs until Cameron sets it up.

**Morning summary (O-40).** One short daily message ("Today: 2 chores (Feed the cat, Make bed), Dentist at 3pm, Tacos for dinner.") by email and in-app, to members who turned on Settings → Notifications → Morning summary (off for everyone by default). It is **off** until **both** of these are true:

1. `CRON_SECRET` is set on the app (runtime variable, above). Without it the endpoint answers 500 and sends nothing.
2. A schedule calls the endpoint once a day.

Owner steps (Cameron's approval needed; a scheduler is a production change):

1. Generate a secret and set it as the runtime variable `CRON_SECRET` in Coolify → the application → Environment Variables. Do not mark it as a build variable. Redeploy or restart so the container reads it.
2. In Coolify → the application → **Scheduled Tasks** → Add: name `morning-summary`, frequency `45 6 * * *`, container: the app container, command:

   ```sh
   wget -q -O - --header="x-cron-secret: $CRON_SECRET" --post-data='' 'http://localhost:3000/api/cron/morning-summary?tz=America/Toronto'
   ```

   The image has `wget`; the task runs inside the app container, so `$CRON_SECRET` comes from its environment and is never typed into the task. Coolify reads the frequency in the **server's** time zone (often UTC); set the task's time zone to `America/Toronto` if your Coolify version offers it, otherwise convert 06:45 Toronto to server time (`45 10 * * *` in summer, `45 11 * * *` in winter UTC).
3. Or, from a host cron instead of Coolify (also a scheduler; same approval):

   `CRON_TZ` works with cronie; Debian/Ubuntu cron ignores it, so there write the time in the server's zone.

   ```sh
   # /etc/cron.d/family-planner-morning-summary — the secret lives in a root-only file, not in the crontab line
   CRON_TZ=America/Toronto
   45 6 * * * root curl -fsS -X POST -H "x-cron-secret: $(cat /etc/family-planner/cron-secret)" 'https://family.ashbi.ca/api/cron/morning-summary?tz=America/Toronto' >/dev/null
   ```

4. Check the first run: the response is JSON counts only, for example `{"success":true,"households":{"processed":1,"failed":0},"sent":{"inApp":2,"email":2},"skipped":{...},"failedRecipients":0,"truncated":false}`. Turn the switch on for your own account first and confirm the email and the in-app notification arrive.

What the endpoint guarantees (`src/lib/morning-summary-server.ts`):

- **Safe to retry.** Each person gets at most one summary per local day, so a retried, overlapping or doubled call sends nothing more.
- **Time zone.** Each person's "today" and event times use the browser zone saved when they turned the switch on; `?tz=` is only the fallback for anyone without one (else UTC). One run at about 06:45 household time suits a household in one zone.
- **Quiet hours.** Someone inside their quiet hours at run time is skipped for that run (not marked sent). With one run a day, they get no summary that day; a second, later run (for example `30 7 * * *`) would reach them.
- **Bounded.** At most 1000 summaries per call; if more are due the answer says `"truncated":true` and the next call continues.
- **Email** goes only to verified addresses and only when `MAILGUN_API_KEY` is set; otherwise the summary is in-app only.

**To turn it off at once:** delete or disable the scheduled task (or unset `CRON_SECRET`, which also closes `POST /api/cron/recurring-chores`).

`POST /api/cron/recurring-chores` uses the same secret but needs no schedule: recurring chores refill on use and on read (O-33).

## 11. Backups

- **Database:** Coolify's database resource can run scheduled `pg_dump` backups to local disk or S3-compatible storage. Turning on a schedule is a scheduler and an S3 bucket may cost money: both need Cameron's explicit approval (`AGENTS.md`). A manual "backup now" is fine once approved.
- `scripts/backup.sh` also works with a Coolify-managed database: set `DB_CONTAINER` to the database container name, `DB_USER` and `DB_NAME`. It runs `pg_dump` inside that container. Do not put it on a cron/timer without approval.
- **Uploads:** not covered by database backups. Back up the Coolify volume for `/data/family-planner-uploads` separately (for example `docker run --rm -v <volume>:/src:ro -v "$PWD":/out alpine tar czf /out/uploads.tgz -C /src .`).
- Before any risky data change, restore a real, current backup into an isolated database and record the result (`docs/engineering/CI_AND_RELEASE.md`, "Release limitations"). CI's recovery rehearsal proves the scripts, not your backups.

## 12. Moving existing production data (only if Coolify replaces the current VPS container)

Owner actions, each needing approval. Outline:

1. Take a fresh backup of the current database (`scripts/backup.sh`) and copy the uploads directory (`/opt/family-planner/uploads` on the current host).
2. Restore the dump into the Coolify database (`scripts/restore.sh` with `DB_CONTAINER` set to the Coolify database container) while the new app is stopped. The restore is all or nothing (`psql -v ON_ERROR_STOP=1 --single-transaction`): it must end with `Restore complete.` and exit code 0. On `ERROR: restore FAILED` nothing was changed; fix the cause and run it again. Do not start the app on a database whose restore did not finish.
3. Copy uploads into the new volume, then `chown -R 1001:1001` inside it.
4. Copy the current production environment values (`JWT_SECRET`, `MAILGUN_*`, and any others actually set there) into Coolify. Do not generate a new `JWT_SECRET`.
5. Deploy on a test hostname, verify (section 13), then switch DNS.

## 13. First deploy and every deploy

1. Confirm the target commit is on `main` and its `Build & Test` run passed.
2. Confirm the approval names that exact commit.
3. Confirm a recent database backup exists.
4. In Coolify, deploy that commit (Deploy, or redeploy a chosen commit).
5. Watch the deployment log: `Running database migration...`, `Schema migration completed successfully`, `Post-feature schema migration completed successfully`, `Starting Next.js server...`, then healthy.
6. Run the curl checks in section 9 and compare the commit.
7. Log in, open Today, a list and the calendar; upload one chore photo if uploads changed (then remove the test data).
8. Record the commit, time and result.

If the health check fails, Coolify leaves the previous container serving. Read the deployment and container logs in Coolify (keep them private; they can contain configuration details).

## 14. Rollback in Coolify

1. Coolify → the application → **Rollback**. It lists recent images still on the server (tagged by commit). Choose the last good commit and roll back. This redeploys that image; it does not rebuild.
2. Keep enough old images for this to work (Coolify's "images to keep" setting in the application's advanced settings; keep at least 3).
3. The rolled-back image still runs its own `migrate.js` on start. Migrations are additive and idempotent, so the older code runs against the newer, expanded schema. There is no schema down-migration. If data is damaged, restore a backup instead (approval needed).
4. Verify: `/api/health` must return 200 and `X-Release-Commit` must now show the rolled-back commit (the image baked its own commit at build time).
5. If an image is no longer on the server, deploy the old commit from Git instead (a rebuild).
6. Record what happened (`docs/runbooks/INCIDENT_RESPONSE.md`).

Halt and rollback triggers are the same as in `RELEASE_AND_ROLLBACK.md`.

## Uncertain or not verified

- Coolify option names (`include source commit in build`, Rollback tab, images to keep, build vs runtime variable checkboxes) are from Coolify v4 and can differ in your version.
- The Dockerfile `SOURCE_COMMIT` fallback and the uploads directory ownership were not built locally; CI's `Build container image` and smoke test are the check.
- Traefik's default handling of client-sent `X-Forwarded-For` should be confirmed with the whoami check in section 8 before relying on `TRUSTED_PROXY_HOPS=1`.
- Whether current production sets `TZ` or other optional variables is unknown here; copy what the running container actually has.
- Coolify scheduled tasks ("Scheduled tasks" in section 10): whether the command runs through a shell (so `$CRON_SECRET` expands) and whether a per-task time zone exists depend on the Coolify version. Check the first run's output in the task's log; if the variable is not expanded the answer is 401 and nothing is sent.
