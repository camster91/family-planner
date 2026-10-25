# Core collection query and compatibility plan — #134

Source checkpoint2026-10-24 (including unverified recovery-branch follow-through). This is an execution plan and source inventory,
not measured SQL counts, an N+1 pass, a capacity result or production acceptance.
Use together with OBSERVABILITY.md, API_CONTRACTS.md, SLO_AND_PERFORMANCE.md,
the accepted modular-monolith ADR and the current web handoff. No new service,
provider, scheduler, index, infrastructure or destructive migration is authorized.

## Current web query boundaries

| Flow | Current source / returned-row boundary | Required consolidated evidence |
| --- | --- | --- |
| Calendar | events GET range limit+1 and continuation; legacy read takes100 | Count actual relation SQL and inspect range/source overlap plans; prove range/timezone/foreign/cursor behavior |
| Chores | Recovery source API/SSR/Today/probes read at most200 candidates and scoped metadata per batch until the visible cap; separate50-row history and optional API paging remain | Dense hidden prefixes can require many batches; inspect total statements/subject/rotation/member fanout and query plans |
| List overview | readListOverview100+1 summaries, at most6 fixed type groups and100 checked-count groups | Same-snapshot counts/auth renewal, no item hydration, stable ties and every type/continued page |
| List detail | readListDetailPage100+1 rows and page-only section inputs; optional item/version API continuation | Row/ingredient/adder/checker SQL strategy, scoped hash parity, pending operations outside page, Back/offline/old clients |
| Meal week | meal GET optional limit+1; web requests only explicit page depth | Range/family positions, refresh/Undo loaded-depth, duplicate slots and truthful partial weeks |
| Today dinner | at most6 UTC-day queries, each2 dinner previews; at most201 ingredient lines per linked recipe | Count actual relation SQL, day/timezone edges, more-dinner signals, incomplete ingredient count withheld, shared omissions and cache/version parity |
| Recipes and inventory | canonical list GET limit+1/offset | Offset churn, filters, nested detail reads, stable fallback and inventory completeness before ingredient claims |
| Projects overview | Recovery source: web24+1 summaries and one grouped task-count query for returned IDs; API paging is opt-in | Current/previous client, cursor/status/family, concurrent changes, first/deep-page SQL plans and rendered recovery; legacy API remains unbounded |
| Wishlist | Recovery source: opt-in limit+1 with household/requester keyset; web24 per action, one-row mutation inspection and loaded-depth refresh | Old unpaged API remains complete/unbounded; requester filters/ties/concurrent changes, original UI fixture adoption and SQL/rendered acceptance |
| Notifications | Recovery source: opt-in personal50+1 API pages; inbox explicitly loads older and labels partial coverage | Personal/paired auth, snooze/Undo/load races, exact retry/timeout, old-server fallback and actual SQL/index/rendered evidence |
| Routine visibility prefilter | All current production callers pass canonical candidate IDs; batches run policy before visible caps, history skips open-row metadata | Actual root-join/date plans and helper parity remain unverified; the helper still permits broader scopes and dense prefixes are not a latency bound |
| Project detail | Recovery source SSR40+1 task keysets, grouped full-project progress and opt-in API continuation | Legacy API remains unbounded; index source unapplied; position/time/ID ties, database plans, rendered/compatibility/concurrency acceptance remain |
| Project send to calendar | Recovery source 200-task and candidate-match batches inside one locked transaction; modern count-only summary, legacy full event-array response | Total work/lock time and legacy result memory remain unbounded within prior timeout; indexes unapplied; atomicity/authority/rollback acceptance unrun |
| Pinned Notes | Recovery source web24-note replacement pages; opt-in household timestamp/ID keysets, exact retry and fetch/body deadline | Legacy API remains complete/unbounded; index source unapplied; original compatibility/isolation/permission/SQL/rendered acceptance unrun |
| Read-only calendar feed | Family token resolves household; recovery source reads2,001 rows and refuses overflow above prior2,000-event capacity before emitting ICS | Supported-size format retained; large complete delivery unavailable. Refusal/provider/parser/compatibility acceptance unrun; no full export or deletion-safety claim |
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

## Static helper findings and remaining exceptions — 2026-10-24

Inspection of the canonical route/board readers identified a whole-household
pre-read in `hiddenRoutineOccurrenceIds`. Previously, one-chore GET and Today
windows could materialize metadata for every open scheduled occurrence before
the visible row limit. The recovery source now accepts an internal ID/date scope:

- One-chore GET supplies only its already-owned canonical ID.
- Main Today board supplies its exact inclusive-start/exclusive-end window.
- Personal home summary supplies its inclusive yesterday-through-tomorrow window.
- Initial Chores supplies the earliest date from the actual open query branches.
- Dated chore API supplies its validated from/to-exclusive bounds; completed and
  verified history pages skip metadata because this policy never hides history.

The root join remains household-scoped and is not date-filtered: a root outside
the viewed window can still hide its selected inactive occurrence. Subsequent
recovery commits replaced broad window preloads in all current production
callers with at most200 candidate IDs per policy batch. API/SSR/Today/probes
continue through hidden prefixes before satisfying the visible cap. Date/ID
and private creation-time ties preserve the caller's original order. History
still skips the open-row policy. The helper's optional broader scope remains
available; do not infer every future caller is safe automatically. Per-batch
bounds do not bound total dense-prefix traversal, SQL count or request latency.
Actual PostgreSQL/date/root-join/rotation/profile/permission and fixture acceptance
remain unexecuted. Authored tests are source, not measurements.

Remaining source exceptions are real work, not a completed performance audit:

| Exception | Why not silently cap it | Next bounded action |
| --- | --- | --- |
| Legacy meal/list/item/project/task/wishlist/notification/notes APIs | Older clients expect complete unpaged contracts | Identify supported consumers, migrate continuation and accept forward/rollback before changing defaults |
| Dense routine-visibility candidate ranges | Every current production caller now uses scoped candidate IDs; limiting total traversal could silently hide valid rows | Measure total batches/rows and root-join plans; helper row bounds do not establish dense-prefix latency |
| Household account/profile rosters | Attribution, assignee choices and compatibility need complete current membership | Audit consumers/cardinality and design explicit complete/continuing contract before a roster cap |
| Recurrence foreground / explicit maintenance | Default repeating path starts at first100; gated one-root continuation source now authored; explicit expandAllRecurringChores remains a complete maintenance pass | Accept real cursor/concurrency/budget/rollback behavior and inspect relation/rotation work separately; no foreground completeness claim |
| Supporting collection screens | Other complete-family readers still need individually scoped continuation | Audit each consumer and preserve role/feature/old-client behavior; Wishlist and Notes source now have opt-in web/API continuation, not acceptance |
| Export/deletion/reconciliation | Complete approved ownership/erasure coverage is intentional | Use separately scoped streaming/batching/recovery contracts; do not turn an incomplete collection page into a complete export/deletion claim |

This is a static source refinement. No measured SQL/round-trip, EXPLAIN, load,
capacity, N+1, rendered or production result is claimed, and #134's full audit
criterion remains open.

## Recurrence read-window refinement — 2026-10-24

Static follow-through inspected `topUpHouseholdSeries`, `topUpScheduledOnceSteps`
and `expandSeriesInTx`. The foreground passes already select at most100 once
roots and100 repeating roots separately. There is no legacy-adoption helper
called ahead of that repeating selection in current source; the earlier broad
inventory item was a question to inspect, not a proved extra adoption pass.
`expandAllRecurringChores` is an explicit full maintenance operation, separate
from bounded foreground top-up. No scheduler or full maintenance run was started.

The ordinary per-series upcoming-occurrence read previously materialized every
future row before computing `needed = windowSize - upcoming.length`. Recovery
source now reads at most windowSize (daily7, weekly4 × selected-day count up to28,
monthly3), with stable due-date/id ordering and an explicit household predicate.
The latest-occurrence lookup is explicitly household-scoped as well.

Source-equivalence rationale: when fewer than the required window exist, all
rows are still read and the collision set/needed count is unchanged. When at
least the window exists, either read yields needed <=0 and no insert. No future
row is deleted or ignored to manufacture an extra occurrence. The later latest
lookup still preserves the original monthly anchor and rotation position. The
scheduled routine-definition branch remains separate and already selects only
its computed bounded day set. This reasoning is not executed recurrence proof.

Source cases for full daily/legacy-weekly/multi-weekday/monthly windows were
added to existing tests, not run. Underfilled, history/rotation, profile rollback,
concurrent unique-key behavior and PostgreSQL/query plans retain their original
acceptance. No schema, effect protocol, window size, history, credit, membership,
feature gate, scheduler or rollout setting changed.

Fair continuation source is now authored behind two default-off acknowledgements.
See [the exact contract](../plans/fair-chore-top-up.md): one committed attempted
position per root, separate canonical idempotent effect, isolated failures,
cyclic traversal and a 1,500 ms initiation budget. The additive table/migration
is unapplied. Default legacy behavior retains first100 selection. Neither
inserted count nor cursor means complete. PostgreSQL/concurrency/rollback,
rotation eligibility/relations and total SQL/duration acceptance remain open.

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

The explicit [capacity model](../testing/CAPACITY_MODEL.md) now defines synthetic
cardinalities/skews, weighted household/event/grocery/inventory/task/AI traffic,
role/device mixes, bounded local stages, stop rules and required evidence. This
completes model definition only; no mixed runner or executed capacity result is
claimed. #137 reproducibility/bottleneck and all broader runtime gates remain.

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
