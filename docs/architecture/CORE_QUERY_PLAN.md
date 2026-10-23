# Core collection query and compatibility plan — #134

Source checkpoint2026-10-22. This is an execution plan and source inventory,
not measured SQL counts, an N+1 pass, a capacity result or production acceptance.
Use together with OBSERVABILITY.md, API_CONTRACTS.md, SLO_AND_PERFORMANCE.md,
the accepted modular-monolith ADR and the current web handoff. No new service,
provider, scheduler, index, infrastructure or destructive migration is authorized.

## Current web query boundaries

| Flow | Current source / returned-row boundary | Required consolidated evidence |
| --- | --- | --- |
| Calendar | events GET range limit+1 and continuation; legacy read takes100 | Count actual relation SQL and inspect range/source overlap plans; prove range/timezone/foreign/cursor behavior |
| Chores | current query caps, separate50-row history; API optional paging | Inspect subject/rotation/member helper fanout and query plans; do not infer they are bounded from the chore cap |
| List overview | readListOverview100+1 summaries, at most6 fixed type groups and100 checked-count groups | Same-snapshot counts/auth renewal, no item hydration, stable ties and every type/continued page |
| List detail | readListDetailPage100+1 rows and page-only section inputs; optional item/version API continuation | Row/ingredient/adder/checker SQL strategy, scoped hash parity, pending operations outside page, Back/offline/old clients |
| Meal week | meal GET optional limit+1; web requests only explicit page depth | Range/family positions, refresh/Undo loaded-depth, duplicate slots and truthful partial weeks |
| Today dinner | at most6 UTC-day queries, each2 dinner previews; at most201 ingredient lines per linked recipe | Count actual relation SQL, day/timezone edges, more-dinner signals, incomplete ingredient count withheld, shared omissions and cache/version parity |
| Recipes and inventory | canonical list GET limit+1/offset | Offset churn, filters, nested detail reads, stable fallback and inventory completeness before ingredient claims |
| Grounded planning | bounded canonical source loaders and explicit incomplete/unknown holds | All-source coverage, locks/versions, allocations/timing, no model-invented identities, exact atomic outcomes/recovery |
| AI reporting | reservation-before-dispatch, fixed content-free usage fields and bounded reports | Reservation concurrency/cost uncertainty, current authority, opt-out/erasure/export; real provider observations remain separate |

A returned-row bound is not a bound on scanned rows, SQL round trips, relation
queries, lock waits, memory in unrelated helpers or request duration. Prisma may
issue multiple statements for relations. Fixed six-day dinner fanout is independent
of household meal count but still needs measurement on board-version polling.
Do not call the full N+1 audit complete from this inventory.

## Preserved compatibility exceptions

No-limit meal/list/item/version clients retain their prior complete contract.
Do not fix their unbounded behavior by truncating data without continuation, or
change old response shapes/ordering to manufacture a bound. New web callers use
the bounded paths above; installed-client evidence must identify which versions
still use each legacy path. Future default changes require the existing native
compatibility/version policy, an explicit advertised continuation contract and a
measured deployment/rollback matrix. Retain the unbounded exceptions in #134
until that migration is actually accepted.

## Index and retention work

Use existing family/date/list/checked indexes as source facts in schema.prisma,
not proof of a chosen query plan. Capture complete source SQL with fabricated
parameters on the guarded disposable database. Compare EXPLAIN (ANALYZE, BUFFERS)
for first/deep pages, dense equal timestamps, skewed households and filters before
proposing compound indexes for meal date/created/id, list created/id or item
position/created/id. Existing broad family/list indexes may suffice for small
households; no production index is implied by this plan. Any later index DDL must
have additive compatibility, lock/build time and rollback evidence.

Household-owned events/tasks/lists/meals/recipes/inventory follow their canonical
explicit deletion/export contracts; do not invent time-based pruning of family
content. Receipt and offline operation lifetimes stay action-specific under
OFFLINE_SYNC.md; AI usage retention/erasure stays AI_USAGE_CONTROLS.md. Historical
facts/linked provenance must survive or redact according to their own lifecycle,
never a generic collection cleanup. Proposed high-volume audit/notification/
media/integration retention changes require DATA_INVENTORY.md reconciliation and
existing erasure/recovery/export contracts. No cron or background work is added.

## Fabricated load model and acceptance record

Later QA uses two isolated households at minimum, then separate ordinary and
skewed fixtures (many lists, many rows in one list, many meals in a single slot,
long histories and dense equal dates). Include parent/teen/child and shared-device
reads, not just one privileged session. Exercise concurrent calendar updates,
grocery ticks/creates, inventory adjustments, task completion/review, explicit
meal continuation and AI reservation/refusal traffic. Use fixed fabricated text;
no real family/provider data or paid dispatch is needed for database load work.

Record source SHA, schema/client/fixture versions, household sizes, concurrency,
query/route counts, rows scanned/returned, database lock waits, p50/p95/p99 and
errors. Separate cold/warm cache and first/deep pages. Version polling must share
its rendered data boundary; background/hidden clients must stop according to the
existing sync policy. Baseline uninstrumented optimized builds; use opt-in dev
SQL hooks only for shape diagnosis. No guessed timing or throughput is a result.

Codex owns this evidence and fixes within the web release scope. Cameron/operator
owns any separately approved infrastructure/provider/production policy change.
Keep every source gap, compatibility exception and failed/unrun check visible in
#134 and the web QA report. Architecture acceptance remains open until that exact
record supports the original criteria.
