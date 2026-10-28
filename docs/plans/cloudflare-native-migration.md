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

Next implementation decision: move the existing middleware protections into a
Workers-compatible execution boundary, preserving runtime secret access,
session generation checks, redirects and CSRF rejection. Validate that boundary
before treating this adapter as the migration runtime. If it cannot preserve
these guarantees, evaluate the documented Cloudflare framework alternative;
do not patch generated artifacts or weaken authentication to get a green page.

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

## Cutover and rollback

The currently working app remains available until the Cloudflare replacement
passes. PR #603 records the old route and restored-backup evidence. A rollback
before new writes may restore that route. After the Cloudflare database accepts
new household writes, reverting to an older database can lose data: freeze
writes and restore/reconcile the correct state instead.

Current status: inventory and runtime scaffold authored; migration incomplete.
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
