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
The generated schema/client are ignored build outputs and are not applied or
db-pushed at deployment. Explicit reviewed SQL is the D1 migration authority.

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

## Display preferences follow-through — 2026-10-28

`GET/PATCH /api/users/display-preferences` and
`GET/PATCH /api/family/display-defaults` now select the D1 repository on D1.
The existing strict body/schema, paired-device refusal, error shape and no-store
headers remain. A single joined query reads a consistent own-account/defaults
snapshot and validates current generation/membership/role before serialization.
Personal and parent-default writes use conditional revision/session/role/household
updates plus a committed snapshot read in one atomic D1 batch. No interactive
transaction emulation or provider scheduler is introduced.

- The actual-source local workerd smoke passes eight simultaneous personal saves
  and eight defaults saves (one winner in each), inheritance/reset, child-safe
  favorites, no-household onboarding preferences, unsupported-version refusal,
  foreign-household refusal and authority changes between preflight and write.
  Injected storage failure rolls the preference update back.
- The rebuilt app Worker HTTP checks pass no-household read/save, stale-revision
  409, strict-body 400, parent defaults, child inheritance, unaffected second
  household, child favorites, demoted-parent 403 and revoked-session 401.
- Phone 390x844 and desktop 1366x768 onboarding render HTTP 200 without overflow,
  page exceptions or failed requests. Screenshots were inspected. This fixes the
  preference-request 500 observed at the preceding read-client milestone.
- OpenNext build, TypeScript and scoped ESLint pass. Evidence is under
  `/tmp/herewoven-d1-preferences-{build,smoke,http,typecheck,lint}.log`,
  `/tmp/herewoven-d1-preferences-http-results.json`, rendered JSON and PNGs.

Other settings and feature domains, complete household flows, production mail,
private R2 and cutover remain incomplete. Production is unchanged.

## Household settings and Recent changes — 2026-10-28

The modern/legacy household rename routes, feature switches, beta-metrics switch
and Recent changes API now use direct D1 repositories when D1 is selected.
Rename keeps strict base-name conflicts, convergent uncertain retries, the safe
five-field projection and the legacy billing-only no-op. Feature writes merge
only requested keys with a JSON compare-and-set/retry; concurrent parents cannot
silently overwrite unrelated toggles. Every changed feature's canonical audit
entry commits in the same SQLite batch. No-op requests add no duplicate history.
Beta opt-out atomically disables collection, erases only the household's counts
and records an actual change. All writes bind current parent authority, session
generation and membership inside SQL, beyond the route's initial authentication.

Recent changes reads/prunes only the authorized parent's household, with the
existing cursor/timestamp ordering and retention policy. An actor's name is
included only while that actor still belongs to the same household. No scheduler
or PostgreSQL fallback is introduced.

Evidence:

- Actual-source local workerd/D1 smoke passes eight concurrent strict renames,
  eight unrelated feature merges, no-op audit behavior, audit-failure rollback,
  scoped metrics erasure, child/current-generation refusals and changes of
  authority between preflight and the atomic batch. Audit pagination has no
  duplicates, retains all expected rows, hides foreign actor names and prunes
  only the authorized household's expired history.
- Rebuilt app Worker HTTP checks pass strict rename 409, safe fields, billing
  no-op, foreign rename 403, four concurrent feature merges, child read/write
  rules, core-feature refusal, metrics erasure, audit pagination/validation,
  demoted-parent 403 and revoked-session 401.
- At 390x844 and 1366x768, actual browser feature toggles save through the API
  and appear in Recent changes. Both views have no horizontal overflow, page
  exceptions or failed requests. Representative screenshots were inspected.
- OpenNext build, TypeScript, scoped ESLint and 81 affected Jest tests pass.
  Evidence: `/tmp/herewoven-d1-settings-{build,smoke,http,tests,lint,typecheck}.log`,
  HTTP-results/rendered JSON and feature/activity PNGs.

Member/profile management, other settings, wider feature data/SSR, R2, full
household acceptance and production cutover remain unfinished. No production
resources, subscriptions, data or VPS services changed.

## Complete model-table foundation — 2026-10-28

`0005_domain_tables.sql` adds the remaining 73 canonical model tables and missing
canonical indexes, preserving the existing 11 tables and their stronger guards.
The canonical Prisma model/relationship definitions were used for a one-time
SQLite DDL candidate, then reviewed and corrected as explicit SQL. The source
schema SHA-256 is recorded in the SQL. Dates become integer milliseconds,
booleans 0/1 and JSON/arrays JSON TEXT. Empty-array defaults are quoted JSON;
database-generated identities use valid UUID-v4 strings. The explicit SQL files
remain authoritative; there is no automatic schema push or generated migration
application in production.

`0006_profile_subject_guards.sql` ports profile household immutability and
archived same-household erasure ownership/one-way transfer guards. The composite
user FK on profile mappings/links is deferred, matching the canonical lifecycle:
family deletion clears user membership and cascades profiles/links together.
No profile editing/linking/routine writer is activated by this schema work.

Evidence:

- `npm run cloudflare:test:schema`: actual local D1 applies all six migrations;
  all 84 models, 963 scalar columns/types/nullability, 153 primary/unique keys
  and 208 canonical relationships match. Foreign-key checks pass. Actual inserts
  prove same-household account-link refusal, shared receipt-key uniqueness,
  millisecond/UUID/array defaults and JSON/boolean/date guards.
- Profile moves, foreign/unarchived erasure assignment and erasure-owner clearing
  are refused. Valid linked family deletion succeeds without a foreign-key error.
  workerd reports deferred-FK commit refusal with an opaque internal error;
  the check verifies no row committed and subsequent valid operations still work.
- Existing identity smoke and actual-source read/preferences/settings Worker
  smoke pass against the expanded schema. The latter also applies it through
  local Wrangler migrations. Scoped script ESLint passes. No application-code
  build was repeated for these SQL/script-only changes.
- Evidence: `/tmp/herewoven-d1-schema-{smoke,identity,reads,lint}.log`.

Still required before feature writers/cutover: port the remaining custom SQL
checks/triggers from `database/migration-*.sql`, including chore subject guards,
routine protocols, preparation/responsibility epochs and retirement, food source
versions, reward notification identity and terminal recipient decisions. Native
PostgreSQL length/decimal/range constraints also need explicit domain review;
Wishlist decimal precision/rounding is not yet accepted. The ignored food source
columns remain absent until their triggers can be installed together, as required
by `scripts/migrate.js`. Structural parity does not prove these invariants or
feature-flow parity. Data/API/SSR conversion, private R2 and deployment remain
unfinished; production has not changed.

## Atomic email-free profiles and routine lifecycle — 2026-10-28

The existing profile routes now select D1 for list/create/edit/archive, retaining
parent/person-only authentication, the setup gate, strict body/role/age rules,
required idempotency keys, stable deterministic create IDs, response projections,
revision conflicts, replay headers and seven-day receipts. No account, email,
invitation or new authority is created by a presentation profile. Account-link
commands and the wider chore/routine writers remain separate and unfinished.

The profile command computes a plan from primary reads, then checks current
person authority, receipt state, profile revision/ownership and exact future
root/stack snapshots inside one native D1 batch. The profile update, supported
future-subject invalidation, stack version/fingerprint changes and completed
receipt commit together. A concurrent routine edit aborts the stale plan and is
preserved when it is re-read. Bulk SQL keeps the statement count independent of
how many future roots are affected. Current occurrence ownership/title/dates are
preserved, as in the canonical PostgreSQL command.

`_D1WriteCheck` is an internal empty assertion table: successful predicates insert
no rows; a false/NULL predicate violates a named CHECK and D1 rolls the whole
batch back. This is explicit SQL precondition checking, not an interactive
Prisma transaction shim or application-level compensation. The actual Worker
fixture proves rollback of an earlier write and that no check rows persist.
See [Cloudflare's native batch guarantee](https://developers.cloudflare.com/d1/worker-api/d1-database/).

`0007_profile_routine_guards.sql` ports the latest profile-only chore expansion,
account/profile reconciliation, sticky erasure, active role/age and routine
protocol/duration guards. `0008_responsibility_lifecycle.sql` ports target epoch
advancement and participation retirement on account/profile/mapping/link identity
changes. Generation changes are rejected; material target changes advance epochs,
and profile archive/account role change retire old responsibility metadata.
Remaining responsibility metadata-shape checks and feature APIs are not accepted
by this milestone. The idempotency fingerprint implementation was extracted into
a pure Node leaf, preserving its canonical hash/re-export while avoiding Next HTTP
imports in repository-only Workers.

Evidence:

- Actual-source local workerd/D1 smoke passes eight simultaneous creates with one
  effect/seven replays, no account creation, key reuse/expiry, role/household scope,
  profile edit/archive and stale revision handling. Receipt failure rolls back
  profile, future root and stack; concurrent future edits survive retry. Sticky
  erasure, routine protocol/duration guards and native assertion rollback pass.
- Archive invalidates the primary/metadata/future-routine epochs and removes
  responsibility participation. Account role change similarly retires metadata
  and advances the canonical target epoch. Wider retirement/linking acceptance
  remains with those still-unconverted feature flows.
- Rebuilt app Worker HTTP passes create/replay, no mailbox/account, required-key
  400, key-reuse 422, child 403, foreign profile 404, edit/stale-revision 409,
  role-age 400, archive replay, demoted-parent 403 and revoked-session 401.
- The browser exposed an unconverted `/api/auth/me` read blocking Family. It now
  uses a scoped D1 read client with the verified cookie generation and retains
  the exact own-profile/family projection and gamification stripping. The browser
  checks confirm no password/reset-token/disabled XP fields in its response.
- At 390x844 and 1366x768, the actual Family dialog creates a three-year-old
  name-only profile and confirms success. Screenshots inspected; no horizontal
  overflow or page exceptions. `/api/family/profile-links` returns its expected
  gated 409 in both views; account linking is not claimed working.
- OpenNext build, TypeScript, scoped ESLint, 48 affected Jest tests and the native
  identity/schema smokes pass. Evidence:
  `/tmp/herewoven-d1-profiles-{build,smoke,http,tests,typecheck,lint,schema,identity}.log`,
  HTTP-results/rendered JSON and phone/desktop PNGs.

Setup was enabled only in the disposable local fixture. No production flag,
provider subscription, resource, data or VPS service changed. Remaining database
checks/triggers, profile linking, member removal/deletion, other feature data/SSR,
R2 and full household/deployment acceptance remain open.

## Provider/feed/travel settings and Settings SSR — 2026-10-28

D1 now backs parent-only feed-token creation/read/rotation, AI-provider settings
and travel settings. Concurrent feed creation converges on one token; rotation
retires the prior identity. AI values retain existing encryption/masking,
provider URL/body bounds, omitted-key preservation and explicit clearing. Only
source-whitelisted fields change. Travel keeps UTC date-only storage/response
semantics, partial-patch behavior and explicit clears. Current parent role,
household and cookie generation are checked inside each mutation's SQL batch;
travel's enabled flag is checked in the UPDATE too.

The shared server feature gate reads D1 through the guarded read client and
fails closed when the household is absent. The Settings server wrapper now uses
one scoped D1 seed: only parent joins can read household beta/PIN/key-presence
facts; raw PIN hashes and AI ciphertext are never selected into that seed. The
legacy PostgreSQL branch remains for the existing deployment.

Evidence:

- Actual-source local Worker smoke passes eight concurrent feed creates,
  rotation/empty-token replacement, AI key preservation/clearing, child/foreign
  refusals, four concurrent independent travel patches, date/clear semantics,
  flag/session changes immediately before writes and role-scoped Settings seeds.
- Rebuilt app Worker HTTP checks verify native crypto encrypted storage, masked
  AI responses, no full key return, omitted-key preservation, clear/short-key
  validation, feed races/rotation, child/foreign policies, travel feature gating,
  UTC date-only round trips and demoted/revoked cookies. No provider call made.
- Parent and teen Settings render HTTP 200 at 390x844 and 1366x768, with no
  horizontal overflow or page exceptions. Teen browsers make no AI/feed/beta
  requests. Screenshots inspected. **Not full Settings acceptance:** both roles
  still get 500 from `/api/users/preferences`; parents also get 500 from
  `/api/calendar/subscriptions`. Those unconverted paths are the next work.
- OpenNext build, TypeScript, scoped ESLint and 40 affected Jest tests pass.
  Evidence: `/tmp/herewoven-d1-preferences2-{build,smoke,http,tests,typecheck,lint}.log`,
  HTTP-results/rendered JSON and masked phone/desktop screenshots.

This milestone covers settings/credentials only, not the calendar feed consumer,
provider calls, calendar subscription writers or AI-usage accounting. The full
feature/storage migration and release acceptance remain open. No production
resources, data, subscriptions, DNS or VPS services changed.

## Notification preferences and exact retry receipts — 2026-10-28

Own notification categories, quiet hours and morning-summary settings now select
D1 in `/api/users/preferences`. The existing request schemas, any-person-role
policy, paired-device refusal, no-store responses and optional idempotency header
remain. Pure projection/patch helpers are shared with PostgreSQL. Quiet-hours
zone omission means UTC; morning-summary zone omission preserves its saved zone.
The last-sent summary day is never reset. No delivery scheduler/provider is added.

D1 uses current cookie generation/membership plus preference-snapshot assertions
in a native batch. Explicit changes and their exact completed receipt commit
together. Concurrent partial updates re-read without losing unrelated toggles.
A replay returns its historical result without reapplying the old preference.
Recent unfinished legacy receipts return retryable 409; abandoned ones can be
reclaimed, expired keys reused and cross-body/action/household key reuse refused.
No-household accounts keep the existing explicit-update/key-ignored behavior.
Bounded event-driven pruning retains the existing 5% sample/500-row cleanup rule;
it creates no timer or cron and housekeeping failure cannot fail the command.
Shared timeout/prune constants remain available through the legacy exports.

Evidence:

- Actual-source workerd/D1 checks pass independent concurrent toggles, eight
  same-key requests (one effect/seven replays), receipt-write rollback, exact
  replay without reapplying, legacy claim/reuse, quiet/morning zone behavior,
  last-sent-day preservation, child/foreign/unattached scope, revoked writer
  refusal and bounded expired-receipt cleanup with live receipts preserved.
- Built app Worker HTTP verifies strict other-member/quiet-time/zone rejection,
  replay/key reuse, own teen/child updates, isolation, no-household behavior,
  last-sent preservation and revoked cookies.
- At 390x844 and 1366x768, parent and teen browsers toggle Chores and rewards,
  reload Settings and observe the saved value. Screenshots inspected. The tested
  personal Settings flows have no overflow, page exceptions or failed requests.
  This fixes the prior `/api/users/preferences` 500. It does not establish full
  Family Settings acceptance: calendar subscription management is still pending.
- OpenNext build/TypeScript, scoped ESLint and 105 affected Jest tests pass. The
  notification-policy source scanner now excludes only the generated D1 client
  directory, whose type documentation contains Prisma write examples; actual
  application-source write checks remain enforced. The generated client remains
  read-only through the separately tested runtime facade.
- Evidence: `/tmp/herewoven-d1-notification-prefs-{build,smoke,http,tests,lint,typecheck}.log`,
  HTTP-results/rendered JSON and phone/desktop screenshots.

Notification creation/delivery/provider adoption and calendar subscription
reads/writes/refresh remain separate unfinished domains. No production resource,
data, subscription, deployment or VPS change occurred.

## Calendar subscription controls — 2026-10-28

The collection GET/POST and subscription PATCH/DELETE select explicit D1
repositories in D1 deployments. PostgreSQL keeps its existing transactions.
Each native primary batch checks the original account id, exact role, household,
session generation and existing Family; every statement repeats that authority
predicate. The response boundary renews it again and preserves held/unconfirmed
status codes and private no-store caching. The owner header contract is unchanged.

Create stores the existing encrypted URL envelope, uses a UUID and applies the
10-calendar cap inside the INSERT, rather than a separate count/create race.
HTTP bounded input, parent gates, rate limiting and public-address validation
are preserved. Updates write only supplied name/colour fields and updated_at;
the URL remains immutable. Removal atomically deletes the selected household's
imported events and subscription. A failing subscription delete restores the
prior event deletion through native batch rollback. Shared DTO and host-hint
helpers were extracted without changing PostgreSQL exports or client shapes;
teens never receive the URL hint or ciphertext.

Evidence:
- `npm run cloudflare:test:reads` passes the prior repositories and a new actual
  workerd/D1 fixture: 14 concurrent creates admit 10, foreign targets are
  concealed, teen/child management is refused, independent patches survive,
  explicit null clears colour, injected delete failure rolls back events, local
  and foreign events survive removal, revoked/moved/demoted actors cannot write.
- Typecheck, scoped ESLint, OpenNext build, 28 subscription-isolation tests and
  43 existing import fetch/sync tests pass. PostgreSQL integration/database tests
  were not run for this slice.
- Built Worker HTTP: public feed creation returns 201; own list, rename and
  removal return 200; teen URL privacy, child/teen restrictions, foreign 404s,
  private-address and immutable-URL 400s, imported deletion count, local-event
  preservation and revoked-cookie 401s pass.
- Playwright at 390x844 and 1366x768 opens Family Settings, loads subscribed
  calendars, renames and reloads the persisted result: no page errors, failed
  requests or horizontal overflow in that flow. Screenshot inspected.
- Evidence prefix `/tmp/herewoven-d1-calendar-management-`: build, typecheck,
  lint, smoke, tests, import-tests, HTTP and browser logs; HTTP/rendered JSON and
  parent screenshots. The first browser attempt failed because the harness had
  not opened Family Settings; the corrected flow passed. Initial preview startup
  hit disk exhaustion; disposable Wrangler and prior dry-run output was cleared
  and the retry passed. No app data or recovery backup was removed.

This is subscription management only. Refresh fetch/parse/reconciliation,
stale refresh, canonical Event views/writers and Google/Apple OAuth connections
still require conversion. The successful local public-URL POST is not evidence
that Node's DNS-pinned Undici fetch works in Workers. The next slice must verify
that boundary and retain SSRF protections; Cloudflare's strictly-public fetch
flag alone is not a DNS-pinning guarantee. Current official DNS documentation:
https://developers.cloudflare.com/workers/runtime-apis/nodejs/dns/ and fetch flag:
https://developers.cloudflare.com/workers/configuration/compatibility-flags/.
No production deployment, data wipe, resource creation or VPS change occurred.

## Calendar refresh and public Workers egress — 2026-10-28

Manual refresh now branches to the native D1 sync repository; its before/after
subscription reads and final response renewal use the original account role,
household and session generation. Subscription source capture is renewed after
network waits using immutable id/family/creator/created_at/encrypted URL checks.
A failed authority/source assertion aborts the native batch before event writes.
Error classification rereads only after rollback. No callback transaction shim
or compensating writes are used.

One batch reconciles the complete bounded feed and updates status/validators.
Existing matching occurrences keep their id, owner and insertion generation;
only changed material fields update. Missing in-window occurrences and malformed
identities are removed; valid older history, local events and other households
are preserved. Empty complete feeds reconcile normally; invalid/truncated feeds
record a safe error without deleting existing events. Not-modified responses
update status while keeping events and validators. Expansion data uses 100-row
JSON chunks, including chunked identity predicates, to avoid D1 value limits and
its compound-SELECT limit. All chunks still share the same atomic batch.

Migration 0009 preserves Event schedule insertion identity, integer/bounded and
monotonic schedule/preparation epochs, and increments schedule_epoch on the same
material fields as PostgreSQL. SQLite rejects attempted identity/counter rewinds
rather than silently rewriting NEW. The source-owned import does not attempt
those rewinds. Full preparation-plan lifecycle and other custom domain guards
still need their own ports. Stale selection is D1-scoped and bounded at ten;
existing persistent per-subscription rate-limit leases and event-driven refresh
remain, with no new scheduler.

Real networking exposed that Undici's Node TLS connector asks for unsupported
ALPN options in Workers. A literal-IP TLS connector was also tried locally, but
the platform refuses TCP access to HTTP services. Neither failed connector is
shipped. D1 safeFetch now requires the native Cloudflare-Workers runtime and uses
its public global outbound fetch, keeping HTTPS/credential/private-literal and
full DNS-address validation. Node deployments retain the existing DNS-pinned
Undici implementation. It cannot silently use unrestricted Node fetch in D1.
The deployment keeps global_fetch_strictly_public, with a regression assertion
against its removal or the private-origin flag. This relies on Workers' native
public-only network for connect-time DNS-rebinding protection, not on the flag
alone or on the earlier DNS check. No private/VPC binding is used by this path.

Primary runtime contract: [workerd public network and SSRF boundary](https://github.com/cloudflare/workerd/discussions/1523),
[Workers fetch routing flag](https://developers.cloudflare.com/workers/configuration/compatibility-flags/),
[TLS API](https://developers.cloudflare.com/workers/runtime-apis/nodejs/tls/).
Local evidence does not replace final edge smoke tests at production cutover.

Validation:
- Actual workerd/D1 source fixture passes initial/repeated/changed imports,
  stable identities, material epoch advancement, conditional 304, invalid and
  truncated feed preservation, status-write failure rollback, actor revocation
  during fetch, changed-source refusal, cross-household isolation, history/local
  event preservation, a 600-occurrence multi-megabyte expansion, stale selection,
  private-literal refusal and event identity/counter guards. The previous
  read/account/preferences/profile/subscription fixtures remain green.
- All nine D1 migrations apply locally; 84 models/963 columns/153 unique keys/208
  relations still pass the structural schema check. Remaining PG-only trigger
  parity is not claimed.
- 179 focused Jest tests pass across subscription isolation, import fetch/sync,
  safe-fetch and outbound URL guards. Scoped ESLint and TypeScript pass.
- Production Next compilation/typecheck completed. OpenNext packaging then hit
  local ENOSPC; after clearing disposable package/browser response/code caches,
  `opennextjs-cloudflare build --skipNextBuild` successfully packaged that exact
  compiled app. A prior attempt with a 3 GiB heap ran out of memory; the 4 GiB
  compile completed. Source, account/session files, app data and backups were
  preserved. No updater installation cache was removed.
- A standalone local native Worker downloaded the real Ontario holiday feed
  (HTTP200; 19,844 bytes). The built app HTTP flow created the subscription and
  refreshed it successfully, importing seven events; teen refresh returned200
  without URL hints, child403, foreign404 and revoked-cookie401 passed. The first
  built HTTP run exposed the old TLS issue and is not counted as a pass.
- Playwright at390x844 and1366x768 opened Family Settings, refreshed the real
  subscription and reloaded persisted ok status. No duplicate events were
  created, no failed requests/page errors/overflow occurred. Phone screenshot
  inspected. The initial harness incorrectly required status=ok on a valid304
  result; it now accepts both ok and not_modified, and both viewports passed.
- Evidence prefix `/tmp/herewoven-d1-calendar-sync-`: build, package, schema,
  smoke, typecheck, lint, tests, migrations, runtime, HTTP and browser logs;
  real-feed HTTP result is `http2-results.json`. Network probe evidence is
  `/tmp/herewoven-d1-calendar-network-probe.log`.

Canonical calendar Event views/writers, OAuth connections, the remaining feature
and account/device domains, private R2, whole-household validation and production
cutover remain unfinished. No production resources, DNS, paid plan, data wipe,
deployment or VPS removal occurred.

## Calendar Event reads and rendered owner views — 2026-10-28

`GET /api/events` now selects a scoped native D1 read repository for single,
range/cursor, recent and upcoming reads. One primary SQL query applies exact
original user/family/role/token authority and joins current creator/source names
inside the event's household. The API retains final authentication renewal,
owner comparison/header metadata and private no-store caching. Source hostnames,
ciphertext and private account metadata are not selected or serialized. Existing
scalar event history is retained; a creator who moved households has no current
name projection, and a foreign source reference gets only the historical generic
source label. Dates/booleans have the same API representation as PostgreSQL.

Ranges preserve overlapping-event inclusion, excluded end boundaries, stable
start/id cursors and limit+1 lookahead. Recent reads retain old recurring masters;
upcoming reads use start-from-now. Individual targets remain independent of the
list window. Calendar SSR checks the current viewer before and after its work.
Notification focus uses one authorized D1 query with the canonical calendar
feature gate; recurring masters, invalid/unrepresentable dates, zero-length or
foreign targets retain the neutral fallback. The UI continues to fetch its
viewer-local window rather than serializing a partial UTC event list.

Browser testing found two supporting GETs still on PostgreSQL. Review-document
context now uses the guarded read-only D1 client, preserving its historical
owner/feature/adoption contracts and final owner renewal. Capture configuration
status also uses that client and renews the same account before returning the
existing configured/model/allowed/role/namespace shape. Keys remain server-only.
This does not port review-document writes or AI capture execution.

Evidence:
- Actual workerd/D1 fixtures pass overlap/tied-time cursor paging, date/boolean
  projection, current creator/source privacy, foreign targets, recurring/recent
  and upcoming windows, exact focus, disabled-calendar focus, invalid dates and
  original role/session/household changes. Prior read-domain fixtures still pass.
- Typecheck, scoped ESLint, complete OpenNext build and112 focused Jest tests
  pass across Event reads/isolation/import guards/focus, recipe preview/context
  and capture routes/isolation. The first build caught a fixture owner literal
  widened to string; its explicit CalendarReadOwner annotation fixed that error.
- Built Worker HTTP passes range paging, source/creator DTOs, a single target,
  ISO dates, cross-household cursor400, foreign404, invalid400, owner-mismatch409,
  teen reads, no-store and revoked-cookie401. Latest-build readback confirms
  parent/teen capture/recipe context200 with their own account/family roles.
- Playwright at390x844 and1366x768 for parent and teen renders the calendar,
  opens imported read-only details, checks parent-only local edit-link presence,
  and loads an exact From notification card. No page errors, failed requests or
  overflow in the final tested journey; phone screenshot inspected. The initial
  harness used Edit instead of the actual Edit event label; the corrected run
  then exposed the context/capture GET failures above. Those failures were fixed
  and all four final journeys passed without suppression.
- Evidence prefix `/tmp/herewoven-d1-calendar-events-`: build, typecheck, lint,
  tests, smoke, HTTP, readback, runtime and browser logs; HTTP/readback/rendered
  JSON and parent/teen screenshots. Fixtures are fabricated households in local
  D1. No PostgreSQL integration or whole-app/production acceptance is claimed.

Next: online Event PATCH with atomic current authority, schedule identity/version
preconditions, imported-event refusal and repeat-rule review semantics; then
create/delete receipt, activity, source-proof and replay parity. Their forms can
load D1 records now, but their writes remain unconverted. OAuth, remaining
feature/account/device domains, private R2 and full release/cutover remain open.
No production deployment, paid plan, data wipe, DNS or VPS change occurred.

## Atomic online Event editing — 2026-10-28

The canonical updatePersonEvent entry point now selects a native D1 writer in
D1 deployments, so the existing PATCH API and edit form keep their input/error
contracts. PostgreSQL keeps its current transaction. Four statements in one
primary native batch read authority/current event, apply the guarded absolute
update, then read its response. Current account generation, parent role, original
household and existing Family are required inside the batch; unauthorized event
rows are not projected. Decisions and effects cannot interleave with a concurrent
writer. No preflight plan/CAS loop or interactive transaction shim is necessary:
the SQL date/repeat/source predicates evaluate the same locked batch state that
produces the response, rather than relying on an earlier snapshot.

Only explicitly supplied fields change. A changed date bound is checked against
the current other bound; the existing zero-duration contract is retained. An
invalid date or changed reviewed repeat rule holds the entire patch. Ordinary
title/time edits leave even unsupported stored recurrence untouched. Imported
subscription events remain read-only. Material schedule epochs advance through
migration0009 in the same update; absolute retries do not duplicate that advance.
The response shares the existing date/boolean formatter and includes current
same-household creator names only, consistent with canonical Event reads; a
creator who moved households gets a null projection instead of a foreign name.
PATCH does not acquire creation/deletion receipts or add side effects that the
PostgreSQL PATCH never had.

Evidence:
- Actual workerd/D1 fixture passes three concurrent partial writes, current-bound
  validation, invalid dates, exact reviewed removal/mismatch, null metadata clears,
  zero-duration compatibility, imported409, foreign404 and teen403. It checks
  schedule identity/material epochs, absolute retry, forced trigger rollback of
  fields and epoch, response shape/dates/creator privacy, revoked/demoted/moved
  writers, and revocation/import-source/repeat-rule changes immediately before
  the native batch. Prior repository fixtures still pass.
- Typecheck, scoped ESLint, complete OpenNext build and74 focused Jest tests pass
  across the existing Event update authority/repeat rules, API isolation, imported
  safeguards and range contracts. No schema change is needed in this slice.
- Built Worker HTTP passes concurrent partial saves, unsupported recurrence
  preservation, imported409, foreign404, teen/child403, current-bound400,
  repeat-review409, reviewed removal200, no-store and revoked-cookie401.
- Playwright390x844 and1366x768 saves a title and45/90-minute duration in the
  existing form, navigates back, reloads and confirms persisted fields through
  the form and canonical GET. Unsupported recurrence remains unchanged. Imported
  event editing is read-only; no failed requests, page errors or horizontal
  overflow in the final tested flows. Phone screenshot inspected.
- Evidence prefix `/tmp/herewoven-d1-event-update-`: build, typecheck, lint,
  tests, smoke, runtime, HTTP and browser logs; HTTP/rendered JSON and screenshots.
  The first harness used the wrong Save Changes capitalization. A later preview
  reload stopped when read-client generation briefly replaced a watched Wasm
  file; generation completed and the owned preview was restarted, then both
  browser journeys passed. Do not regenerate the read client during a watched
  application preview. No application workaround or failed-request suppression
  was used.

Next: Event create and delete, including atomic receipts/replay, activity,
beta-metric and assistant source/delete-target proof semantics. OAuth, remaining
feature/account/device domains, private R2, full-household checks and production
cutover remain open. No production, paid-plan, DNS, data-wipe or VPS change.

## Manual Event creation/deletion and exact receipts — 2026-10-28

The existing Event POST/DELETE API now selects a native D1 mutation repository
for manual form actions. Successful Event creation, its Activity and exact
completed receipt share one atomic batch. Deletion, canonical FK cascades and
its receipt also commit together. A rollback restores the whole effect, including
cascaded preparation data. Creation records the existing consent-aware/nonfatal
beta metric only after a new effect commits, never on completed replay.

Receipts keep the canonical user namespace, action/body hash, seven-day expiry,
30-second incomplete-claim timeout, exact private response and replay header.
Concurrent same-key calls converge through native precondition checks and retry;
completed create replay does not reapply edits or resurrect a later deleted
record. Completed delete replay succeeds after the target is gone. Expired keys
can serve a different body/action; abandoned claims preserve their identity and
remaining TTL. Failed reclaimable effects release the key, allowing a corrected
request. Existing bounded probabilistic housekeeping is reused, without a job.

Current creation permissions retain the existing parent/teen/child API contract.
Deletion requires the original current parent/household/generation and enabled
calendar feature, including before completed replay. Imported events are refused;
foreign existing targets retain the existing DELETE403 and missing targets404.
Before deletion, insertion generation/material/preparation epochs and updated_at
are checked inside the effect batch, so intervening edits/source changes cannot
silently bypass the current eligibility read. Original person-role and household
checks precede every effect and private completed replay.

**Remaining AI parity:** source-proof-bearing creates and source/target-proof
bearing deletes currently return the existing ASSISTANT_SOURCE_REFUSED409 in D1.
They are never treated as manual actions or allowed to skip source verification.
This is an explicit temporary migration hold: valid AI confirmations, canonical
non-HTTP create/delete callsites and complete source/target proof parity remain
unfinished and block release. PostgreSQL keeps its existing proof implementation.
Next work is the D1 Today/reference loader and atomic source/delete-target snapshot
checks; the hold must be removed only with positive and stale-proof evidence.

Evidence:
- Actual workerd/D1 fixtures pass eight concurrent creates/deletes, exact replay,
  one Event/Activity, stable stored identity/date, action/body key reuse refusal,
  no resurrection, role/household isolation, imported protection, preparation
  cascade, pending/abandoned/expired receipts and error-key release. Forced receipt
  failure rolls back creation/Activity and deletion/cascades. Revocation or a new
  imported source immediately before the batch leaves effects/receipts unchanged.
  Disabled feature and changed account authority prevent private replay. Previous
  read/write fixtures remain green.
- Typecheck, scoped ESLint, complete OpenNext build and56 focused Jest tests pass
  across Event API isolation/imports, create authority, idempotency and canonical
  deletion. No migration/schema change or PG integration pass in this slice.
- Built Worker HTTP confirms eight same-key creates produce one Activity and beta
  count; eight deletes converge; key reuse422, invalid-key400, revoked replay401,
  teen/child creation, teen delete403, foreign delete403 and malformed assistant
  proof409 pass. Exact create replay after deletion does not restore the Event.
- Playwright390x844 and1366x768 uses the real form to create a30-minute event,
  loads it for editing, opens confirmation and deletes it; canonical GET then404.
  No failed page requests, page errors or overflow in the final flows. Stable
  phone confirmation screenshot inspected after waiting for its entry animation.
  The first harness attempt did not reach POST; the final run waits for the
  mounted form/network to settle and checks native form validity. No app
  validation or failed request was bypassed.
- Evidence prefix `/tmp/herewoven-d1-event-mutations-`: build, typecheck, lint,
  tests, smoke, runtime, HTTP and browser logs; HTTP/rendered JSON and screenshots.
  Data is fabricated in local D1. No paid plan, production resource, deployment,
  DNS, live data wipe or VPS removal occurred.

## AI Today/reference read projection — 2026-10-28

The source-owned Today loader now exposes only its selected read methods. Its
D1 adapter uses the runtime-enforced read-only client and the same bounded
projection as PostgreSQL, including current actor/role/family checks, feature
gates, nested dinner recipe/cook reads and opaque reference catalog inputs.
The compatibility cast is limited to these read projections; no write, raw SQL
or transaction method is exposed or emulated.

Actual local workerd/D1 fixtures cover events, two chore assignments, dinner,
groceries and inventory; all six reference entries have distinct opaque IDs.
Parent/teen projections, foreign-household exclusion, child/shared-device
refusal and disabled feature sections pass. Existing read/write fixtures pass,
as do 25 focused AI loader/context/capability/reference/source-proof unit tests,
typecheck, scoped ESLint and a complete OpenNext build. These are local runtime checks, not production or
complete assistant-flow acceptance.

AI confirmation writes remain explicitly refused in D1. Recurring-series
materialization is also still unported: a context request that requires it
returns unavailable rather than claiming an incomplete Today is current.
Read-only confirmation reloads explicitly request no materialization, as before.
Atomic source/target snapshot verification, valid AI write confirmations and
complete chat execution are the next unfinished boundary. No production,
subscription, DNS, live data or VPS resource changed.

Evidence prefix: `/tmp/herewoven-d1-assistant-context-` (native smoke, focused
unit tests, typecheck, lint and build logs). No schema migration in this slice.

## Atomic AI Event creation source guard — 2026-10-28

Signed Event POST now accepts a valid source proof in D1. The shared proof
format, current owner/role/generation, normalized feature digest, opaque catalog,
Today projection and 60-second/local-day lease are preserved. Completed receipts
renew current authority without requiring a fresh source or enabled AI gate.
First effects capture the exact source-owned native SELECT results used by the
read-only projection. The same SELECTs become assertions in the Event/Activity/
receipt batch, including empty windows, order, limits and nested recipe/cook/list
reads. A change before commit aborts the whole effect; it is never an ignored
interactive transaction or a preflight-only promise. An integer SQLite clock
assertion also bounds admission at expiry or local midnight.

The witness is request-local and bounded to 256 reads/1 MiB; unsupported values,
column shapes and operations fail closed. It only wraps native parameterized
SELECTs reached through the enforced model-read facade, and quotes captured
column identifiers. It receives no model/client SQL and grants no write methods.
Projected source windows are still bounded; this does not claim complete
household history. Comparisons cover the exact fetched sets, including new rows
that would change those windows, rather than only the prior positive row IDs.

Verification:
- Actual local workerd/D1 fixtures pass eight concurrent signed creates with one
  effect/Activity/receipt; stale events, chores, nested recipe/cook, groceries,
  inventory and feature changes refuse. Changes immediately before batch commit
  to groceries, recipe details and an empty chore window roll back the effect
  and receipt. Quoted/newline/Unicode values, newly inserted sources, expiry,
  historical replay, teen creation and current role/generation/family refusal pass.
  Existing schema-backed read/write fixture domains remain green.
- 41 focused AI/context/environment tests and 56 Event/idempotency/authority tests
  pass, plus scoped ESLint, standalone TypeScript and a full OpenNext build.
  The first build found an extra argument accidentally added to three test
  assertions; those assertions were corrected before the passing build.
- Built HTTP confirms one signed create and seven exact replays, one Activity and
  consent-aware beta count, private/no-store responses, expiry409, expired-proof
  completed replay, foreign/tampered proof409 and stale-source409 with no receipt.
- The first built HTTP run found production instrumentation still requiring a
  PostgreSQL URL in D1 mode. Environment validation now recognizes the selected
  storage backend, rejects unknown choices and preserves the PostgreSQL/JWT
  requirements. The final built Worker starts and passes without DATABASE_URL;
  no dummy PostgreSQL configuration or live account data was used.

**Remaining:** D1 AI deletes remain held in both the HTTP path and direct native
mutator until exact-target proofs are converted. Other AI effect writers,
recurring materialization, non-HTTP canonical mutation orchestration and the
complete assistant chat/capture flows remain unfinished. This is source guard
and Event POST progress, not full AI parity or production release acceptance.
No UI, schema, paid subscription, production resource, DNS, live data or VPS
change. Evidence prefix: `/tmp/herewoven-d1-source-` (smoke, unit/Event tests,
lint, typecheck, build, runtime and HTTP logs/results).

## Exact Event delete review and atomic target guard — 2026-10-28

The user-selected Event target-review endpoint and proof-bearing Event DELETE
now use D1. Source/authority reads and the complete event/preparation/step/link
snapshot are validated in native atomic batches. The delete effect, cascades,
calendar-link tombstone and completed receipt commit together. The proof remains
content-free and bound to owner, role, generation, action, ID and 60-second lease.
SDK dates are explicitly serialized before fingerprinting, so date-only changes
cannot canonicalize silently to empty objects. Child sets retain the 500-row and
1 MiB snapshot bounds. Source-bearing deletion requires the exact-target guard in
both HTTP and the native mutator; target-only proofs retain their existing path.

A same-key concurrency gap found in native verification is fixed: if a competing
request commits between receipt lookup and proof reads, the loser may see a
missing target or changed Today projection. It now looks for that exact completed
receipt and re-enters the normal current-authority replay path. Without a matching
committed receipt the stale proof still refuses. This also fixes signed Event
creation races when the first create changes the signed Today window.

Evidence:
- Actual workerd/D1 fixtures pass eight-way confirmed deletion, full canonical
  preview/date output, content-free tokens, date/content/plan/step/link changes,
  root/child/empty-child insertion races immediately before commit, missing target
  proof, expiry, replay with AI gates off, teen refusal, revoked replay, foreign
  targets/links and imported read-only targets. 501 dependent steps refuse review.
  Receipt failure restores the event, preparation and original link state; success
  retains the chore and nulls the link event ID as a tombstone. Existing native
  domains remain green, including eight signed Today creates/one effect/replays.
- 31 focused proof/Event/delete tests, scoped ESLint, standalone TypeScript and a
  complete OpenNext build pass. This is not a PostgreSQL integration run or a
  full assistant/user-journey acceptance claim.
- The built Worker HTTP endpoint returns the selected canonical title/ISO detail,
  a content-free target proof and private/no-store response. Eight deletes yield
  one effect/seven exact replays. Missing target proof409, changed target409 with
  the event preserved/no receipt and foreign target-review409 pass.
- Initial fixture attempts exposed an invalid async expression, a missing required
  due date in fabricated data and the real concurrent receipt gap above. Corrected
  fixtures and final runtime checks pass. The read-smoke startup fetch now has a
  bounded timeout so an initial Worker build error cannot hang a readiness probe.

**Remaining:** chore/list target-review and effect adapters, recurring-series
materialization, non-HTTP canonical mutation orchestration, complete chat/capture,
other feature domains, private R2, complete household/device verification and
cutover/VPS retirement. No UI/schema, paid subscription, production deployment,
resource/DNS/live data or VPS change. Evidence prefix:
`/tmp/herewoven-d1-delete-target-` (smoke, unit, lint, typecheck, build, runtime,
HTTP logs/results). Local preview bindings and fabricated key files are removed
when the owned preview is stopped.

## Native recurring-series materialization — 2026-10-28

D1 now has native recurring-series expansion, paged explicit all-series expansion,
and bounded foreground top-up. Legacy daily/weekly/monthly windows use a shared
pure date planner with PostgreSQL, retaining original month anchors, selected
weekdays, latest-occurrence continuation and rotation places. Canonical account
eligibility is extracted into a read-only projection reused under the existing
PG household lock and D1 atomic read witness. Profile assignment uses the existing
role/age/archive/erasure/link/gate projector; no login identity is synthesized.

Authored routine definitions retain stack consistency, current subject, reviewed
content, cue/duration snapshots and explicit once-only handover/checkpoint rules.
The separate once/repeating 100-root budgets and gated cyclic attempted-position
cursor are retained. Unknown/contradictory definitions hold rather than falling
back to historical fields. Each root's reads, copies and once checkpoint commit
in one native batch; conflicts replan and the series/date unique key remains the
final collision guard. No scheduler or rollout flag is enabled in production.

The default AI Today loader can now call the native foreground top-up after its
actor/family/role/feature checks. The source-confirmation loader still passes no
materializer and explicitly requests read-only context. A bounded visit does not
prove every household series is full; foreground failures retain existing rows
and emit fixed diagnostics, matching the existing availability model.

Evidence:
- Actual workerd/D1 fixtures pass eight concurrent daily expansions/one bounded
  window, selected weekdays, Jan 31/Feb 28/Mar 31 anchoring, no missed-day backfill,
  rotations skipping foreign/departed participants, email-free profiles,
  archive refusal and archive-at-commit race, authored/stack-linked routines,
  cue/duration snapshots, contradictory/unknown metadata holds, explicit once
  recovery/checkpoint and once-profile work with recurrence opt-in off.
- Mid-batch failure rolls back all generated rows; stop/edit/feature-off races
  prevent stale copies. The normal AI Today context can materialize native work.
  Fair traversal reaches 105 new series across visits rather than starving IDs
  beyond the first 100. Existing native domains remain green.
- 89 focused recurrence/UTC/routine/identity/AI tests pass, plus standalone
  TypeScript and scoped ESLint. Initial native attempts found a non-existent
  Chore timestamp column in the insert and a fixture trying to persist a protocol
  the schema correctly rejects. The insert uses the actual schema; the fixture
  now exercises an unrecognized shape within the supported stored protocol.
- The wide Chore row exposed a platform-specific witness requirement: D1 caps SQL
  functions at 32 arguments. Row comparison now constructs flat arrays in bounded
  chunks rather than calling json_array with every column at once. Native
  fixtures and the complete OpenNext build cover this final form.

**Remaining:** Chore API/SSR, creation/edit/completion/undo and routine command
writers, other feature domains, complete chat/capture, private R2, household/device
flows and cutover. Native local verification does not prove deployed-plan CPU or
per-invocation query budgets: high-volume foreground/rotation requests still need
edge-budget verification/optimization before release. No paid plan is approved or
activated. See [D1 platform limits](https://developers.cloudflare.com/d1/platform/limits/)
(checked 2026-10-28; batches count as one invocation query, individual reads count
separately). No UI/schema, production resource/deployment, DNS/live data or VPS
change. Evidence prefix: `/tmp/herewoven-d1-recurrence-` (native smoke, focused
unit tests, typecheck, lint and build). No rendered or full-household acceptance
claim is made for the still-unconverted Chore surfaces.

## Chore read APIs and role-specific screens — 2026-10-28

The canonical Chore list/detail API and parent board now use a narrow read scope.
D1 scalar arrays are validated before the PG-compatible read projection is used.
Public assignee/creator and profile relations are explicitly hydrated in bounded,
household-scoped queries. Native verification found that larger nested composite
relations make Prisma start an implicit transaction; no read-facade guard was
removed. Scalar reads plus explicit relation hydration avoid that transaction and
SQLite parameter overflow, including 61 profile relations on one page.

Native routine policy queries join the scoped root independently of the selected
occurrence dates. Keyset batches and bound JSON ID sets preserve hidden/inactive
filtering before visible caps, evidence-bearing history and scheduled-once action
policy. Profile history hydration retains archive/identity checks; streak queries
return only bounded seven-day markers. Owned notification focus validates current
role/family/generation, subject, feature and routine reads in a native batch.
Current account authority is renewed before private API/SSR responses. Chore JSON
now consistently sends private/no-store headers, including detail responses.
Assignee/creator names for people now in another household are removed.

Rendered verification exposed a distinct existing role path: teens are redirected
from the parent Chore board to their own `/dashboard` home. That home still had PG
reads. It now uses D1 for bounded own chores/catch-up work, shared event summaries,
optional rewards and minimal assigned-chore preparation cues. Paused routine work
is hidden, canonical native foreground top-up is available, future definitions
are stripped and disabled gamification remains omitted. The internal session
version is carried through final authority renewal and never serialized. Existing
child/teen route restrictions remain intact; no parent route is opened to them.

Evidence:
- Actual workerd/D1 fixtures pass visibility after 240 hidden occurrences,
  evidence retention, independent/date/household routine scope, 61-profile and
  composite-relation hydration, scheduled-once policy, streak markers, parent/teen
  focus, hidden/foreign refusal and authority change immediately before the focus
  validation batch. Own kid-home windows/catch-up/events/reward gating and exact
  assigned preparation cues pass. Existing native domains remain green.
- 102 focused API/paging/isolation/visibility/streak/board/kid-home tests,
  standalone TypeScript, scoped ESLint and a complete OpenNext build pass. Tests
  also pin private future-definition stripping from child-home props. This is not
  a PG integration run or acceptance of still-unconverted mutation controls.
- Built HTTP verifies a 64-row page containing 61 profile assignments, cursor
  continuation, exact profile detail, omitted points/private future metadata,
  foreign404, malformed query400, incompatible profile client409, teen reads,
  revoked401 and removal of foreign relation names. The final built readback
  confirms both list and detail are private/no-store.
- Playwright 390x844 and 1366x768 renders the parent board and owned notification
  focus, and the teen's distinct own-work home after its normal role redirect.
  No failed requests, page errors or horizontal overflow in the final runs. All
  four screenshots were inspected. Initial browser attempts exposed the separate
  kid-home PG path; that actual failure was fixed rather than relaxing the route
  gate. The fabricated fixture's duplicate series/date rows were also corrected
  before the passing native run.

**Remaining:** Chore creation/edit/delete/complete/undo/verification and routine
command adapters, other feature domains/SSR, complete AI/capture, private R2,
household/device flows, deployed-plan budgets and cutover/VPS retirement. Parent
preparation orchestration and other routine-editor reads still require their own
conversion. No UI redesign/schema, paid subscription, production deployment,
resource/DNS/live data or VPS change. Evidence prefix:
`/tmp/herewoven-d1-chore-reads-` (smoke, focused tests, lint, typecheck, build,
runtime, HTTP/readback, rendered JSON and screenshots). All data is fabricated;
owned preview bindings and key files are removed after stopping the preview.

## Atomic account chore completion and Undo — 2026-10-28

**Implemented locally:** `/api/chores/complete` and `/api/chores/uncomplete`
now branch into a closed, account-session D1 adapter. The native batch checks
current session generation, role, household, feature state, chore/photo reads
and recurrence sources before committing the status effect. It preserves D3:
any current household member may complete an account chore; Undo requires a
parent or the assignee. Profile-only work refuses this account protocol.

Completion, exact activity and generated series copies/checkpoints or a legacy
successor commit together. Undo removes only its recorded, still-pending legacy
successor; it cannot reopen a verified chore. No completion or Undo awards XP.
Opted-in beta counting remains nonfatal and runs only after a real completion.
The recurrence writer now exposes its captured checks and statements so all
checks precede every effect inside this same batch. PostgreSQL paths remain.

Migration `0010_chore_completion_epochs.sql` ports monotonic state/proof epochs,
separate from material responsibility epochs. It rejects invalid/rewinding
internal values and bumps the epoch for status/proof/successor changes. Other
EventPreparation lifecycle and step triggers remain unported.

**Verification:**

- Actual local D1 schema check passes all ten migrations, 84 model tables,
  963 scalar columns, 153 canonical unique keys and 208 relationships.
- Native fixture passes concurrent tick/Undo, exact successor deletion and
  re-completion, daily series top-up, inactive routine refusal, photo ownership,
  owner revocation, upload deletion, verification winning Undo and archived
  canonical assignee refusal. Forced activity failure rolls back status, epoch
  and every generated occurrence. Epoch rewind and foreign/profile work refuse;
  XP stays unchanged. Verification is simulated as a database winner here;
  the verification endpoint is not converted by this slice.
- Real HTTP: eight completions converge on one activity and one beta count;
  eight Undo requests converge on pending. Sibling Undo is forbidden; verified
  Undo conflicts; repeated verified completion is a no-op. Foreign, missing,
  invalid and revoked-session requests return 403/404/400/401. JSON is private,
  no-store.
- Local Playwright parent and teen journeys at 390px and 1366px tick through the
  rendered control, use the Undo toast and confirm D1 pending state through the
  authenticated API. No page errors, failed HTTP requests or horizontal overflow;
  phone-parent and desktop-teen screenshots inspected. The harness initially
  expected the teen mission to be a checkbox; its existing button semantics
  were used for the passing run. No product behavior was changed for the harness.
- 88 focused PostgreSQL-path/unit checks pass. Scoped lint, TypeScript and the
  OpenNext build pass. Full native read/mutation smoke passes, including prior
  recurrence and chore-read fixtures.

**Remaining:** Chore verification/XP, creation/edit/delete and dedicated
profile/device/routine commands; other data domains/SSR, complete AI execution,
private R2 and mail/household/device flows. Local workerd does not establish the
deployed plan's CPU/query budget. The full migration remains incomplete; no
production binding, deploy, paid plan, wipe, DNS or VPS change. Evidence prefix:
`/tmp/herewoven-d1-chore-state-` (schema, smoke, unit, lint/typecheck/build,
HTTP/readback, rendered results and screenshots). Preview keys/configuration are
removed after stopping the owned preview. All data is fabricated.

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
