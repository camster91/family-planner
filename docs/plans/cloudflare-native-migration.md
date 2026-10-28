# Herewoven: Cloudflare-native migration

Execution issue: [#604](https://github.com/camster91/family-planner/issues/604).
Source baseline: `df80c65e2ed61175fc41279244047ad520162d37`.
Decision date: 2026-10-28.

Cameron requested that Herewoven run completely on Cloudflare and explicitly
allowed a fresh data start. This authorizes a replacement deployment and
removal of this app's old VPS resources after successful cutover. It does not
authorize deleting the shared VPS or other sites, changing unrelated accounts,
or silently enabling paid subscriptions. No production data has been wiped.

## Simple delivery plan

One existing application, one D1 database, one private R2 bucket. Keep the
current UI and API contracts. A fresh database removes the old-data import
work, not the need for reliable writes and household permissions.

1. **Make the app run:** fix Workers middleware compatibility, then move the
   existing data and upload paths to D1 and R2. Start with identity/households,
   then convert the existing feature domains through the same backend.
2. **Check the complete flows:** use fabricated households to verify sign-in,
   permissions, concurrent writes, uploads and the existing user journeys.
3. **Switch hosting:** deploy, verify herewoven.com, then retire only this app's
   VPS resources after the new service works and recovery is available.

These stages group the detailed checklist below; they do not waive its checks.
No new features, parallel backend, separate mobile API, cache service, scheduler
or coordination service is part of the initial implementation. Consider an
additional service only when a concrete operation cannot be implemented safely
with D1's atomic operations. Do not remove safeguards to reduce service count.

## Target

- Workers serves the existing web UI, route handlers and authentication.
- D1 holds persistent relational state, with explicit atomic write batches and
  conditional ownership/version checks. Where a workflow cannot be expressed
  safely this way, choose and verify a Durable Object coordination boundary
  before converting it. A lock in a Worker process is not a database lock.
- Private R2 holds uploads; existing authenticated file routes continue to check
  household ownership before returning bytes. No public bucket or public URLs.
- The canonical application origin becomes `https://herewoven.com`; old links
  need intentional redirects and client/session reset behavior.
- No VPS database, mounted VPS directory, tunnel-to-VPS, or externally hosted
  PostgreSQL remains in the target. Existing mail/AI/calendar APIs are separate
  provider integrations, not an excuse to retain the VPS backend.

## Observed blockers

`npm run cloudflare:inventory -- --summary` inspects TypeScript AST nodes rather
than counting references inside comments. Initial baseline:

| Area | Sites | Files |
| --- | ---: | ---: |
| Prisma transaction calls | 244 | 152 |
| Raw SQL calls/templates | 319 | 125 |
| SQL row-lock string sites | 119 | 77 |
| Advisory-lock string sites | 9 | 7 |
| Filesystem imports | 13 | 7 |

The schema defines 84 models and six scalar-array fields. These counts are
migration indicators, not effort estimates, executed-query counts, or proof of
completeness. Dynamic SQL, indirect dependencies, script migrations, triggers,
provider libraries and generated clients require separate inspection. Full
file/line inventory: `npm run cloudflare:inventory`.

Critical examples:

- `src/lib/household-lock.ts`: join/upload/deletion ordering depends on
  PostgreSQL advisory locks. Removing the lock can leave orphaned accounts,
  grants or files after deletion.
- `src/lib/person-list-item-authority.ts`: actor generation and household
  authority must be rechecked in the same atomic write boundary.
- `src/lib/prisma.ts`: singleton PostgreSQL adapter is not a D1 binding.
- `src/lib/safe-fetch.ts`: DNS-pinned undici connections protect recipe/calendar
  URL fetching. Workers migration must preserve redirect validation and SSRF
  protection; simply replacing this with unrestricted fetch is not acceptable.
- `src/lib/message-attachments.ts`: disk quarantine/link/rename behavior needs
  an object-store publication/recovery protocol, not just an upload SDK change.
- Schema defaults/triggers and ignored generation/epoch fields in SQL migrations
  are not fully represented by Prisma. Generating SQLite from schema alone
  loses important constraints and concurrency behavior.

Prisma's D1 connector does not provide the existing transaction semantics.
Do not wrap callbacks in a fake `$transaction` that executes sequential writes
without rollback. Do not replace `FOR UPDATE`/advisory locks with no-ops.
Cloudflare Container disk is ephemeral; putting the current Postgres data
folder there is not a supported persistence migration. R2 FUSE is not a drop-in
transactional database filesystem.

## Runtime build foundation

Pinned `@opennextjs/cloudflare` 1.20.13 supports the repository's Next 16.4.2
through its published peer dependency range. `wrangler` 4.148.0 is pinned.
The current Cloudflare guide recommends beta vinext; OpenNext is used for this
compatibility spike to preserve the existing Next build and minimize simultaneous
framework changes. This choice must be judged by actual Workers execution.

- `npm run cloudflare:build` creates a local worker artifact.
- `open-next.config.ts` deliberately enables no shared household-data cache.
- `wrangler.jsonc` has no production routes, no remote data bindings, no account
  secrets, and no workers.dev/preview publication. It is a build foundation,
  **not a deployable replacement app**.
- `.open-next`, `.wrangler` and `.dev.vars*` are ignored; generated code is
  excluded from the regular TypeScript source check.
- Existing Next/Docker commands remain intact during the migration.

## Local verification: 2026-10-28

- Node 22, `NODE_OPTIONS=--max-old-space-size=4096`: `npm run
  cloudflare:build` passed compilation, type checking and Worker bundling.
- `wrangler deploy --dry-run` passed; artifact upload is 39,214.97 KiB
  uncompressed. This does not establish runtime correctness or a billing plan.
- Local workerd supports compatibility date `2026-10-13`; the configuration
  uses that tested runtime date.
- Local `/login` returned HTTP 500 in OpenNext's Node middleware loader:
  `Method Promise.prototype.then called on incompatible receiver #<Promise>`.
  Cloudflare's official OpenNext support table currently marks Node middleware
  unsupported. Existing middleware performs session/role/CSRF checks, so
  disabling it is not an acceptable workaround. Runtime compatibility remains
  an explicit release blocker, ahead of any production cutover.
- The probe used a random local secret and deliberately unreachable local
  database address; no production credentials or household data were used.
  The local preview was stopped and its temporary `.dev.vars` removed.
- Production remains on the existing host. No migration was deployed.

### Follow-through: middleware startup fixed locally

The initial loader crash is resolved by isolating device cookie/flag helpers
from the database-backed token module and loading the session resolver only
inside the existing protected-route validation boundary. Existing imports of
cookie helpers retain compatibility through re-exports. No authority check,
CSRF check, cookie attribute or role gate was removed.

Observed on the rebuilt local Worker:

- `/login`: 200, CSRF cookie set.
- Anonymous `/dashboard/today`: 307 to login with return path.
- Mutation without CSRF token: 403; cross-site login POST: 403.
- Fabricated signed token with unavailable session authority: 307 to login.
- Playwright login at 390×844 and 1366×768: 200, no horizontal overflow,
  password input present, no page errors; screenshots visually inspected.
- 125 focused tests passed across middleware, device sessions and module-load
  failure coverage. Scoped ESLint and the OpenNext production build passed.

The session authority probe exposes the next blocker: the existing Prisma
PostgreSQL engine attempts runtime Wasm compilation that workerd rejects.
Signed-in database flows are **not working or verified**. Replace this layer
with D1-compatible storage as already planned; do not bypass the lookup.
OpenNext's broader Node middleware support remains experimental, so these
observations cover only the routes/cases listed above.

Local evidence: `/tmp/herewoven-workers-http-smoke.json`,
`/tmp/herewoven-workers-smoke/`, `/tmp/herewoven-middleware-tests.log`,
`/tmp/herewoven-middleware-loading-tests.log` and
`/tmp/herewoven-cloudflare-lazy-build.log`. No production change.

### D1 session-authority slice

`HEREWOVEN_STORAGE=d1` now selects a direct D1 reader for the existing session
API. The request binding is `DB`; it reads the canonical `User` table's
`token_version`, `role` and `family_id` using bound parameters. Every authority
read starts a `first-primary` D1 session so a stale read replica cannot admit a
revoked session or old household role. No authority is cached across requests.

Default storage remains PostgreSQL. Unknown explicit backend values throw.
When D1 is selected, the old Prisma export is unavailable even if a PostgreSQL
URL or cached client exists, preventing mixed-backend authorization. Missing
D1 bindings and failed reads propagate to existing fail-closed callers.

This is a **session-read slice**, not a completed account migration. The
production schema, signup/login writers, rate limits, household membership
mutations and domain APIs still need conversion. The committed Wrangler config
does not enable D1 or provision a database. The existing startup environment
checks are retained until the remaining PostgreSQL callers are converted.

Verification on 2026-10-28:

- 131 focused tests passed; TypeScript, scoped ESLint and OpenNext build passed.
- Local Miniflare D1 with two fabricated households verified bound SQL,
  current generation/role/household after updates and null after account deletion.
- Rebuilt app running in local workerd with a real local D1 binding: a current
  parent cookie on `/login` redirects to `/dashboard`; a child carrying a stale
  parent claim is redirected away from `/dashboard/budget`; revoked and missing
  accounts are redirected to login. No PostgreSQL service was available.
- The local database used only a four-column session fixture, **not a production
  migration**. These probes do not establish login-form submission, dashboard
  rendering, write concurrency, or complete household isolation.
- Evidence: `/tmp/herewoven-d1-runtime-results.json`,
  `/tmp/herewoven-d1-smoke.log`, `/tmp/herewoven-d1-session-tests.log`,
  `/tmp/herewoven-d1-typecheck.log`, `/tmp/herewoven-d1-build.log`.
- Temporary secret/config files removed and local Worker stopped. No remote
  resources, subscription, deployment, or production data were changed.

Next: define the fresh D1 identity/household schema and atomic registration,
verification, rate-limit and membership operations before enabling real signup.

### Fresh identity schema, household create and rate limits

`database/cloudflare/0001_identity.sql` now creates the fresh `Family`, `User`,
`FamilyInvite`, `RateLimitEntry` and `AuditLog` tables. Scalar columns match the
current Prisma models, excluding ignored food-source metadata. Dates use Unix
milliseconds, booleans use checked 0/1 integers, JSON/arrays use checked JSON
text, and foreign-key actions and relevant indexes are explicit. This is the
first migration, **not the full 84-model schema**. Food-source generation/epoch
columns and their non-resettable continuity behavior still need a subsequent
migration and reader/writer conversion before any real feature rollout.

The existing POST `/api/family` now uses D1 when selected. A single atomic batch
conditionally creates the household for an existing, current-generation,
unattached account and attaches that account. Missing/revoked accounts and
concurrent second creates insert nothing. Invite-code collisions are retried
without retaining an orphan family. Response booleans, JSON, dates and the
renewed session cookie preserve the existing HTTP contract.

All rate-limit helpers now have direct D1 paths. Window increment/reset is one
SQLite upsert, failure-only reads use primary, success reset and expired-row
cleanup use D1. Missing storage refuses attempts; it does not grant a fresh
per-Worker memory allowance. No scheduler was added or enabled.

Observed validation:

- `cloudflare:test:identity` executes the actual repository SQL/functions in
  ephemeral local workerd/D1. Passed scalar-column parity, 12 concurrent create
  attempts with exactly one winner, deleted/revoked account rejection, forced
  post-insert rollback, invite-code collision rollback, two-household separation,
  and concurrent rate-limit increments/window resets/failure-only reads.
- Wrangler `d1 migrations apply --local` applied `0001_identity.sql` successfully.
- 51 affected Jest tests passed; TypeScript, scoped ESLint, diff check and the
  OpenNext Workers build passed.
- Actual Worker + migrated local D1 + fabricated account: POST `/api/family`
  returned 200 with the expected response types/features and a renewed session
  cookie; the repeat returned 400. No PostgreSQL service was available.
- Evidence: `/tmp/herewoven-d1-identity-smoke.log`,
  `/tmp/herewoven-d1-identity-migration.log`, `/tmp/herewoven-d1-family-http.json`,
  `/tmp/herewoven-d1-identity-tests.log`, `/tmp/herewoven-d1-identity-build.log`.
- Worker stopped and temporary secrets/config removed. No remote D1 database,
  deployment, paid service, production write or wipe occurred.

Next: convert registration/invite consumption, verification/login/password
writes, shared-device authority and the remaining membership/account APIs. Full
onboarding and dashboard rendering remain incomplete in the D1 candidate.

### Registration, email verification and login on D1

The existing registration/login HTTP endpoints now select direct D1 account
repositories when D1 is enabled. Normal registrations remain unverified and
receive no session. Invited registration rechecks the live invite's email,
expiry, role and household inside the same batch that creates the account,
claims the invite and writes the household audit. A failed audit rolls back
both account and claim; duplicate-email races return the existing 409 contract.
Account projections exclude ignored continuity metadata, and login selects only
its existing allowed fields plus server-side password/session generation.

Verification tokens are still random plaintext in mail links and SHA-256 hashes
in storage. D1 issuance, atomic expiry-checked consume, and already-used lookup
are wired through the existing token helpers. Password reset and resend-recovery
paths are **not yet converted**. Login retains bcrypt, failure counters, the
verification gate, secure cookie flags and conditional gamification visibility.

`0002_identity_followthrough.sql` adds the verification lookup index and
`BetaMetricDaily`. The canonical post-commit beta recorder now has a D1 path
that rechecks household opt-in and updates/prunes counts in one batch. Strict
transactional feedback and the other metrics/settings paths remain to port;
no scheduler or provider was activated.

Observed validation:

- Local D1 smoke executes the actual account repositories: normal registration,
  duplicate-email rejection, typed dates/booleans, private login projection,
  one verification winner under eight simultaneous claims, expiry/replay,
  wrong-address invite rejection, eight competing invite registrations with one
  winner, audit failure rollback, and current stored role after an invite change.
- Existing affected auth/device-guard/verification/token/beta tests: 66 passed.
  TypeScript, scoped ESLint, diff checks and the OpenNext build passed.
- Both migrations applied through Wrangler locally. Actual Worker HTTP checks
  passed normal registration (no session/private fields), refusal before email
  verification, rejection of a submitted stored hash, single-use verification,
  wrong-password rejection, mixed-case verified login, authenticated family
  creation, invited-child registration, audit and opt-in usage count.
- Email delivery was deliberately unconfigured. The HTTP test replaced the
  local verification hash with a known fabricated token to exercise the
  confirmation endpoint; this is **not evidence of delivered mail** or a real
  email-link journey. No real household or production credential was used.
- Evidence: `/tmp/herewoven-d1-accounts-smoke.log`,
  `/tmp/herewoven-d1-accounts-tests.log`, `/tmp/herewoven-d1-accounts-build.log`,
  `/tmp/herewoven-d1-accounts-migrations.log`,
  `/tmp/herewoven-d1-account-http-results.json`.
- Local Worker stopped, temporary secrets/config removed; no deployment or
  production change. Full dashboard rendering and complete household journeys
  remain unfinished.

Next: password recovery/resend verification, account/profile reads, current
shared-device authority and the remaining membership APIs; then domain storage.

### Password recovery, profiles and paired-device refusal

The existing forgot/reset/change-password and resend-verification endpoints
now use D1. Reset token hashes are unique; the single-use claim, password write,
session-generation increment and PIN deletion share one batch. Failure rolls
all of them back. The canonical device-audit helper records PIN clearing after
commit with its existing best-effort behavior. Password changes recheck both
the current generation and the verified old password hash in the write itself;
concurrent revocation/change cannot overwrite a newer password snapshot.

A failed D1 verification resend restores its previous challenge only if the
failed issue is still current and unverified; it cannot overwrite a newer issue
or undo a completed claim. This preserves the existing best-effort resend
contract; arbitrary overlapping provider successes/failures and real mail
transport still need final recovery acceptance.

User GET/PATCH and shared authenticated-user reads now use explicit D1
projections. Profile updates accept only the existing name/age fields and check
the current session generation. Live paired-device access/refresh presence
checks now use primary D1 reads with the existing expiry, rotation grace,
revocation and device/household-match rules. Full pairing, refresh rotation,
elevation and device-management writes are **not yet converted**.

`0003_credential_devices.sql` adds five complete scalar models needed here:
HouseholdMember, HouseholdDevice, DeviceSession, ParentElevationPin and
DeviceAuditEvent. Foreign keys include scoped member audit subjects; reset and
verification token hashes gain unique indexes. `0004_device_audit_erasure.sql`
preserves one-way audit-subject erasure. These tables are foundations, not a
claim that profile linking/device functionality has all been ported. The local
smoke now uses Wrangler's own SQL splitter so it also executes trigger bodies.

Observed validation:

- Actual local D1 repository checks passed reset races, PIN/token/password
  rollback after an injected failure, generation/password compare-and-set,
  private profile projections, rejection of stale profile edits, restoration
  guards, device expiry/revocation/rotation/household mismatch and scoped audit
  subject/one-way erasure constraints.
- 88 affected Jest tests passed; six existing integration cases were skipped.
  TypeScript, scoped ESLint, diff check and Workers build passed. Four migrations
  (11 tables) applied through Wrangler locally.
- Actual Worker HTTP passed failed-mail resend restoration/generic responses,
  safe typed profile GET/PATCH, change-password session renewal/revocation,
  reset single-use behavior and stored-hash replay rejection, PIN deletion and
  audit, post-reset password/session rejection, and paired login/register/API
  refusal with `SHARED_DEVICE_ENABLED=true`. A revoked device cookie no longer
  refused a valid person session, matching the existing policy.
- Mail remained unconfigured and verification/reset were driven by fabricated
  local tokens. No delivered-mail or complete dashboard/native claim is made.
- Evidence: `/tmp/herewoven-d1-recovery-smoke.log`,
  `/tmp/herewoven-d1-recovery-tests.log`, `/tmp/herewoven-d1-recovery-build.log`,
  `/tmp/herewoven-d1-recovery-migrations.log`,
  `/tmp/herewoven-d1-recovery-http-results.json`.
- Local Worker stopped and temporary secret/config files removed. No remote
  resource, deployment, paid subscription or production data was changed.

Next: household/member reads and writes, email-free profile identity/linking,
full device operations, and feature domains. R2 and verified cutover remain.

### Membership joins, family reads and invitation controls

Existing family GET, member GET, code lookup, invite preview/list/create/revoke,
code rotation and join endpoints now have D1 paths. Family reads and member
emails recheck actor generation/membership/role in their SQL projections; a
stale parent claim cannot expose parent-only values. Code joins retain teens
and otherwise grant child; email joins use only the live stored invite's role,
address and household. Join admission, audit and invite claim share one batch.
SQLite `changes()` gates follow-through on the winning statement; the local D1
checks verify it across concurrent batches. Name snapshot conflicts return a
retryable 409 rather than write an inaccurate audit summary.

Invite replacement/revoke and code rotation include their audit in the same
transaction. Mail-failure compensation targets only the exact unaccepted issue,
retaining accepted invitations. No mail was actually sent. D1 join/create HTTP
branches now await delegated handlers so async failures retain the existing
logged JSON error contract.

Validation: local D1 repository race/rollback/privacy/replacement/collision
checks passed; 62 affected Jest tests passed and 12 integration cases skipped.
TypeScript, scoped ESLint, diff check and the rebuilt Worker passed. Actual
Worker HTTP passed code and email joins, rejected address/household switching,
parent/child/teen projections, foreign-invite 404, cancellation, missing-mail
503 compensation, code retirement, stale-role refusal, and injected audit
failure with full membership rollback and a JSON 500 response.
Evidence: `/tmp/herewoven-d1-membership-smoke.log`,
`/tmp/herewoven-d1-membership-tests.log`, `/tmp/herewoven-d1-membership-build.log`,
`/tmp/herewoven-d1-membership-http-results.json`. Local preview stopped and its
temporary secrets/config removed. No production or paid-provider change.

Remaining: rename/settings, removal/deletion and full profile/member identity,
full device operations, feature domains/SSR, R2, complete acceptance and cutover.
A supported Prisma-D1 read adapter may reduce remaining read-query rewrites,
but it must first pass real Worker/date/JSON/array/isolation checks and cannot
replace the required explicit transaction/raw-SQL conversions.

## Execution order

1. Complete worker artifact and runtime compatibility (middleware/auth, Node
   imports, SSRF-safe external fetch, response streaming, resource limits).
2. Establish fresh D1 schema and atomic-operation conventions. Convert money,
   date/time, arrays/JSON, native defaults, constraints and epoch triggers with
   explicit mappings. Keep the external API shapes stable.
3. Migrate identity, sessions, household membership, roles, profiles, invitations
   and deletion first. Prove two-household isolation and concurrent changes.
4. Migrate calendar/chores/routines/lists/meals and their receipts/Undo, then
   the remaining data domains. Inventory each old transaction's replacement;
   no silent feature removal or PostgreSQL fallback.
5. Wire private R2 uploads, metadata, reads, quarantine, deletion and recovery.
6. Verify complete fabricated-household flows on Workers with fresh persistent
   state, including restart, rollback, concurrent writes and lost responses.
7. Provision approved Cloudflare resources and secrets using minimum privileges.
   Verify billing plan/access first. The connected OAuth app cannot read
   account billing subscriptions (403); this is not evidence of a free plan.
8. Deploy candidate, verify exact source and health, then change domain routing.
   Fresh state means users create accounts/families again; stale sessions,
   invites, device credentials and queued actions must not target new owners.
9. Verify production and recovery. Disable this app's Coolify auto-deploy and
   remove only verified Herewoven application/database/upload resources. Keep
   other VPS services intact. Record backup retention/disposal explicitly.

## Read client and signed-in shell — 2026-10-28

A separate generated SQLite client now provides ordinary typed D1 reads. It is
request-scoped, starts with a primary D1 session and disconnects in `finally`.
The PostgreSQL client remains unavailable when `HEREWOVEN_STORAGE=d1`; this does
not provide a fallback or silently route existing writers through Prisma/D1.
The canonical schema generates all 84 read delegates, while the reviewed SQL
migrations still define only the currently ported tables. Array fields are JSON
in the read schema; PostgreSQL array predicates still need explicit conversion.
The generated schema/client are ignored build outputs and never migration input.

Prisma/D1 7.10.1 does not enforce interactive transactions. A runtime read-only
facade therefore exposes only model read methods, before callbacks can run;
query-extension and adapter guards add further protection. All writes continue
to require explicit atomic D1 SQL. Integer-millisecond date parameters are
preserved instead of the adapter's default ISO-text binding. Next's narrow Wasm
external uses an ESM import of the native binary so OpenNext/Wrangler can bundle
it statically; CommonJS and absolute `?module` imports failed actual Worker
probes and were corrected in source. No generated bundle was patched.

Evidence from this source candidate:

- `npm run cloudflare:test:reads` passes actual workerd/D1 reads using the actual
  factory: integer dates/ranges, booleans, JSON arrays, nested relations/counts,
  scoped household predicates, grouping, all 11 mutation/raw/transaction refusals,
  unchanged fixture rows and 12 concurrent requests. Disposable local state only.
- OpenNext build, TypeScript and scoped ESLint pass; 17 affected shell/navigation/
  middleware Jest tests pass. Dry-run Worker upload is 43,896.81 KiB uncompressed
  (10,559.16 KiB gzip). This is a local bundle check, not provider deployment.
- The built Worker renders signed-in `/dashboard` onboarding from D1 at 390x844
  and 1366x768: HTTP 200, no horizontal overflow or page exceptions. Screenshots
  were inspected. `/api/users/display-preferences` returns 500 in both views;
  this remaining backend path must be converted. Household Today/child domain
  queries, wider APIs and complete household acceptance are still unfinished.
- Local evidence: `/tmp/herewoven-d1-read-{build,smoke,tests,lint,typecheck,dryrun}.log`,
  `/tmp/herewoven-d1-read-rendered.json` and corresponding phone/desktop PNGs.

No production resource, subscription, data or VPS change occurred.

## Cutover and rollback

The currently working app remains available until the Cloudflare replacement
passes. PR #603 records the old route and restored-backup evidence. A rollback
before new writes may restore that route. After the Cloudflare database accepts
new household writes, reverting to an older database can lose data: freeze
writes and restore/reconcile the correct state instead.

Current status: local Workers account/session/invitation reads and selected
registration, verification, login, recovery/profile, membership/invitation,
household-create and rate-limit paths verified;
the full data/storage migration and production cutover remain incomplete.
No D1/R2 production resources created, no Cloudflare application deployed, no
subscription changed, no data deletion, no VPS removal.

## Sources checked 2026-10-28

- [Cloudflare Next.js deployment](https://developers.cloudflare.com/workers/framework-guides/web-apps/nextjs/)
- [OpenNext existing-app setup](https://opennext.js.org/cloudflare/get-started)
- [Prisma SQLite / D1 considerations](https://docs.prisma.io/docs/orm/core-concepts/supported-databases/sqlite)
- [Cloudflare Prisma/D1 setup](https://developers.cloudflare.com/d1/tutorials/d1-and-prisma-orm/)
- [Container persistence](https://developers.cloudflare.com/containers/faq/)
- [Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/)

- [OpenNext feature support](https://developers.cloudflare.com/workers/framework-guides/web-apps/opennext/)
