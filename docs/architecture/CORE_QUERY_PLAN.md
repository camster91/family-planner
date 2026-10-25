# Core collection query and compatibility plan — #134

Source checkpoint2026-10-25 (including unverified recovery-branch follow-through). This is an execution plan and source inventory,
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
| Read-only calendar feed | Family token resolves household; complete RepeatableRead snapshot in200-row keyset batches, at most10,000 events/16MiB within30s; overflow or invalid supported recurrence refuses503 before ICS | Actual SQL/transaction, format/recurrence, supported-size/overflow/refusal and old-client/provider acceptance unrun; no unlimited export or deletion-safety claim |
| Calendar subscription reconcile | Recovery source200-row immutable-ID history reads/deletes/creates inside one RepeatableRead transaction; incoming feed capped3,000 | Total history traversal and30s transaction budget remain; additive index unapplied; real conflict/rollback/removal/metadata/SQL acceptance unrun |
| Grounded planning | bounded canonical source loaders and explicit incomplete/unknown holds | All-source coverage, locks/versions, allocations/timing, no model-invented identities, exact atomic outcomes/recovery |
| AI reporting | reservation-before-dispatch, fixed content-free usage fields and bounded reports | Reservation concurrency/cost uncertainty, current authority, opt-out/erasure/export; real provider observations remain separate |
| Shared Activity | Optional paging=keyset-v1, default30/max100+1, household timestamp/ID cursor; private timeline/analytics exclusions retained | Legacy timestamp paging can skip tied rows; no new web consumer/current-previous migration or SQL/isolation acceptance claimed |
| Private feedback |25 own-user/household reports; optional summary-v1 selects five display fields; exact report-request receipt checks retained | No continuation or complete-history claim; legacy full representation stays compatible, UI/transport/privacy acceptance unrun |
| Rewards | Optional24-web/max100-API timestamp/ID pages bound to household/status, one-row exact recovery read, legacy unpaged API retained | Relation SQL/first/deep-page plans, status/tie/role/old-client and mutation recovery/navigation acceptance unrun; compound indexes are proposals only |
| Account erasure/removal | Identifier-only ownership discovery and sorted historical household locks; relation-derived ListItem/ProjectTask ownership; per-household successor/clear predicates | Complete discovery is not a bounded request-work guarantee; FK/transaction/rollback/concurrency and query plans remain unmeasured; no live deletion performed |

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

## Chores board streak projection — 2026-10-24 (#134/#137, local source)

`chore-streak-read.ts` replaces the board's unbounded seven-day `findMany` of
completion rows/titles. It requests only account assignees present in the loaded
board, deduplicated in200-ID batches. Each SQL query pins the household, requested
account IDs, completed/verified status and the exact seven badge-day keys, with a
half-open TIMESTAMP(3) UTC storage range. PostgreSQL groups account/day, returning
at most1,400 markers per batch regardless of the number of same-day completions.
Unexpected scope/duplicates/overflow fail without a partial badge map. Profile-only
rows remain outside account streaks; gamification-off pages skip the helper.

Preserved: consecutive days beginning today, minimum3 to show, maximum7; existing
server-local-midnight converted to UTC-day keys. One captured clock is reused for
all batches. This does not redefine household-timezone/DST semantics or credit,
verification, recurrence, lifetime streaks or history. No new shared-device field.

Payload/statement growth now follows displayed assignees; database scan/grouping
cost still follows matching completions. Existing `Chore(family_id, assigned_to)`
index is relevant but no plan or latency claim follows. Later fixture EXPLAIN must
compare the existing index with a candidate partial composite
`(family_id, assigned_to, completed_at) WHERE status IN ('completed','verified')`
and its write/storage cost before any index migration. Cross-batch consistency is
not a new snapshot guarantee. No index/schema/migration or database operation ran.
Authored pure and guarded PostgreSQL source cases are unrun; real grouping/date/
scoping equivalence and the broader N+1/capacity acceptance remain open.

## Canonical chore profile hydration — 2026-10-24 (#134/#480, local source)

Both list and single-item chore API reads now use `hydrateChoreProfileMembers`.
Previously their local helper queried all selected profile IDs together, without
a family predicate on `HouseholdMember`. New queries include the authenticated
household and at most200 unique IDs, with `take` matching the batch length and
only the existing subject/identity projection. Returned IDs/household/duplicates
are checked; unexpected rows or later batch failure throw before any result map
is exposed. Missing profile references remain null and reach the existing subject
refusal path. Account-only inputs do not query the profile table.

Archived profiles intentionally remain in this read for historical display.
No active-membership filter or new linkage/credit/action policy is invented;
`readChoreSubject`, profile protocol gates and canonical mutation/lifecycle checks
continue to own those decisions. The helper is read-only and does not perform a
new authority renewal or establish cross-query snapshot consistency. Relation
fanout/query plans still need actual PostgreSQL observation; this payload/parameter
bound is not full N+1 or household-isolation acceptance. No schema/index/DB change.
Authored empty/deduplicated/archived/later-batch/missing/foreign/failure source cases
are unrun. Original profile/queue/native/permission acceptance remains separate.

## Legacy Activity stable continuation — 2026-10-25 (#134/#135, local source)

The all-member Activity API now offers explicit `paging=keyset-v1`, limit1..100
(default30), limit+1 lookahead and timestamp-desc/ID-asc positions bound to household.
Legacy timestamp-only and activities-only replies remain for no-mode clients.
No current web consumer was identified; client adoption remains separate. Existing
analytics/private fact exclusions and safe marker projection remain. Candidate
query-plan work must compare current `(family_id,created_at)` with a possible
`(family_id,created_at DESC,id ASC)` index under tied rows and exclusion predicates;
no performance/index or snapshot claim follows from source. No schema/migration,
query-plan execution or database change. Pure/route cases authored/unrun; full
N+1/query/isolation/legacy/offline acceptance remains open.

## Supporting collection follow-through — 2026-10-25

Source inspection narrows the earlier generic supporting-screen exception. This
is API source inventory only; it does not establish rendered behavior or a
measured N+1 pass. Preserve existing account/role/feature/paired-device policies
and complete legacy representations when adding opt-in continuation.

| Current route | Inspected source behavior | Next bounded contract work |
| --- | --- | --- |
| `/api/rewards` | Optional limit1..100 keysets/nextCursor, household+status bound; exact rewardId inspection at most1; no-limit original full response retained. Web uses24-row replacement pages | Accept status/tie/old-client/role/relations and recovery/navigation behavior; no complete-total claim or implicit absence proof |
| `/api/anniversaries` | Complete household dates; computes next occurrence/days from UTC day and returns source dates | Preserve local annual-date semantics and permission DTOs; define view position before paging, not a naive calendar-year slice |
| `/api/allowance` | At most100 status/date rows; parent household versus own-recipient child/teen policy | Make latest/partial coverage explicit and define status/date/ID continuation before claiming complete history |
| `/api/messages` | Optional paging=keyset-v1 default50/max100+1 household timestamp/ID pages; web now requests50 and retains explicit older cursor; complete current roster/legacy API remain | Tie/merge/scroll/exact retry/read-scope/older-server source authored, unrun. Roster/relations, polling/send races, live catch-up gaps and native acceptance remain separate |
| `/api/budget/transactions` | Parent-only default50/max200 offset pages with separate total and current filters | Inspect tie ordering, offset churn and count snapshot; maintain parent-only aggregate/privacy and ordinary create/recovery paths |
| `/api/budget/categories` | Complete household categories with transaction relations | Separate selector completeness from budget reporting; inspect relation projection/aggregate strategy before page adoption |
| `/api/sick-days` | Active household/own-subject cases with active medication relation | Bound case and nested medication contracts separately; never imply a partial medication set is the complete treatment view |
| `/api/medications` | Complete active household/own-subject medications with person projection | Define explicit complete/continued view without losing next-dose visibility or own-subject isolation |
| `/api/emergency-contacts` | Complete authorized household contacts ordered by created_at | Preserve emergency access and permission semantics; define complete contact access before imposing a cap |
| `/api/locations` | Complete authorized household locations, primary-first then label | Keep primary/navigation/role access explicit; design stable complete/continued selection before a cap |

Current Notes/Wishlist/Notifications and assistant/feedback transport bounds are
separate client contracts, not SQL scan bounds. Notes reads2MiB/edit256KiB/delete32KiB;
Wishlist list/target2MiB/account32KiB/writes256KiB; notification read512KiB/write32KiB.
Reward-board claim/approval and exact status reads use256KiB with preserved unknown-result keys.
These use15-second foreground deadlines. Assistant chat allows45seconds/256KiB
above the existing30-second provider limit; report read512KiB/write64KiB uses15seconds.
Streaming decoding bounds transferred bytes; JSON-only bridges remain post-parse
bounded. Unknown write outcomes preserve their domain recovery and never prove
rollback, free provider use or a fresh safe create.

The new household-local erasure discovery intentionally enumerates all matching
household identifiers, deriving list/project children through their parent. It
must remain complete or fail, not silently page away data before User cascades.
That lifecycle operation needs separate plan/scan/lock-duration evidence; it is
not a normal page reader or a claim that deletion work is constant-time.

No tests/QA/build/browser/CI/API/DB/EXPLAIN/load/native/provider/activation/push/
merge/deployment ran for this reconciliation. #134's full audit/index/isolation/
rolling-migration criteria remain open. The next source work is explicit per-flow
continuation/client semantics, not a default cap or a fabricated measurement.

## Recipe ingredient name resolution memory — 2026-10-25

#134/#460 source: canonical resolveIngredientLines no longer loads and indexes
the whole household Ingredient catalog for at most100 submitted recipe lines.
It retains the existing household ingredient-name advisory lock, JavaScript NFC/
trim/inner-whitespace/lowercase comparison and canonical same-family exact-name
upsert. Catalog reads now use500-row ID keysets scoped to the original family,
retaining only requested normalized matches and stopping once all are found.
Missing names still require exhausting the catalog before creation; data is not
silently truncated and no approximate SQL collation replaces Unicode matching.

Legacy normalized-name collisions choose the first database-ID-ordered row for
future name resolution; the previous read had unspecified database order. No
existing ingredient/recipe identity, catalog row, unit, history or foreign key is
rewritten/merged. Explicit ingredient IDs keep their existing ownership lookup;
repeated resolved IDs retain duplicate-line refusal. Canonical source input
bounds and outer recipe transaction/authority checks remain unchanged.

This bounds per-read/retained application rows, not total scan/SQL/lock duration.
A large missing-name catalog can still take multiple reads or hit the transaction
limit. Family/ID index/plan measurement and a normalized-key additive migration
would need separate duplicate-catalog/compatibility decisions; no index, schema,
backfill or stored data is changed here. No capacity/read-latency claim is made.
Cross-page Unicode reuse, early stop, full exhaustion before missing-name upsert,
foreign-family exclusion and duplicate input cases are authored UNRUN. No QA/
tests/checks/build/browser/CI/API/DB/provider/push/merge/deploy ran. #134/#460 open.

## Canonical recipe read authority renewal — 2026-10-25

#136/#460 source: the public discovery renewal helper is now the shared
recipe-read-authority.ts boundary. Existing publisher routes retain their prior
behavior. Private recipe library/detail, collection catalog and recipe curation
GETs now also freeze original server actor/family/role/session generation and
renew after database reads before returning data. Scope changes refuse409;
expired/revoked sessions keep authentication refusals, and Meals is checked again.
These routes never reinterpret an old read as a request for a new household.
Detail success is explicitly private/no-store; new refusals and existing curation
wrappers retain that policy. Valid query/response, permitted read roles and write
contracts remain unchanged. No new data model, endpoint or permission is added.

This is point-in-time renewal, not locked read snapshots or a complete original-
owner client echo. Concurrent later changes, native masking, restore/erasure,
SQL/capacity and current/old-client evidence remain separate acceptance. Source
review also confirmed existing collection writes cap the catalog at100 and the
curation UI exposes missing chosen collections for deliberate removal; no new
paging engine or silent selection drop was introduced there.

Four private-route household-retirement cases are authored UNRUN alongside the
existing publisher role/generation cases. No QA/tests/checks/build/browser/CI/API/
DB/provider/push/merge/deploy ran. #136/#460 remain open.

## Rotation identity preflight and profile namespace boundary — 2026-10-25

#134/#450 source: applyRotationEditInTx now resolves each distinct required
canonical account/member mapping once, before any template/order/assignee write,
instead of repeating the same eligibility queries for every future occurrence.
The existing household lifecycle lock remains held. Targets are visited in
stable ID order; normal accepted rotation inputs contain at most8 participants.
Legacy account-only rows still receive account-only assignment updates, while
canonical rows receive the same resolved account/member pair. Missing/contradictory
identity rejects before any rotation effect. Existing turn sequence, pending/
manual-override filtering, history and clearing rules stay unchanged.

The future pending-row read and per-row updates remain unbounded total work;
this removes repeated identity queries, not all transaction cost or concurrency
proof. Existing canonical lifecycle locking is relied on, not newly expanded or
claimed verified. No schema, profile capability or account credit rule changes.
Three source cases cover24 turns/two identity resolutions, pre-effect refusal and
legacy-row preservation; all UNRUN. No QA/tests/checks/build/browser/CI/API/DB/
provider/push/merge/deploy ran. #134/#450/#480 remain open.

Current rotation_member_ids are User IDs: rotationMembersInHousehold queries the
User delegate, and profile actions explicitly refuse nonempty legacy rotations.
They must not be reinterpreted as HouseholdMember IDs because their strings look
similar. Profile rotation still requires additive/versioned storage and strict
capability/read/write/rollback handling with explicit active stable-member
eligibility. It is not delivered by this query optimization. The unanswered
standalone-unlink retention decision remains independent and unresolved.

## Rotation candidate read batches — 2026-10-25

#134/#450 source: rotation edits now enumerate future pending candidates in500-row
(date,id) keyset batches, with original household/root/status/tomorrow predicates
on every read. Equal-date boundaries use ID ties; invalid/nonadvancing cursors
throw before effects. The complete narrow plan is retained before canonical
identity preflight and writes, so a prefix is never treated as the whole series.
Turn ordering, manual-override eligibility, history and all-or-nothing outer
transaction behavior remain. Canonical generation/completion already use the
household lock retained here; this is not new cross-process proof.

Per-read payload is bounded; total retained candidate/turn arrays, SQL/lock time
and per-row effects remain proportional to the complete affected series. No
capacity/fully bounded-memory claim, index/schema or data change. A501-row same-
date boundary/tail/complete-turn source case is authored UNRUN; existing identity
preflight/legacy/refusal cases remain. No QA/tests/checks/build/browser/CI/API/DB/
provider/push/merge/deploy ran. #134/#450 remain open; profile rotation decisions
and implementation remain separate.


### Clearing rotation avoids candidate planning — 2026-10-25

`applyRotationEditInTx` now exits through an empty-roster branch after household
locking, membership validation, template lookup and the unchanged-list no-op.
It updates the root roster and clears household-scoped occurrence indices in the
caller's transaction without querying pending candidates or resolving assignees.
This preserves the existing clear semantics: no assignee/history rewrite and no
profile-ID reinterpretation. The bulk index update can still touch many rows;
this is not a bounded total transaction or measured performance result.
An unrun regression source case asserts the two intended writes and absence of
candidate/identity reads. #134 remains open; all runtime/concurrency/rollback
acceptance is deferred with QA. No schema, API, flag or scheduler change.


### Member-removal rotation identity preflight — 2026-10-25

`dropMemberFromRotationsInTx` retains the complete household-scoped root read,
then computes the same removal slot, remaining roster and replacement per root.
It resolves each distinct required canonical replacement once in sorted account
ID order before its own rotation updates. Existing member-removal and account-
deletion callers hold the household lifecycle lock and surrounding transaction;
this is not a new standalone authorization entry point or a claim that no caller
effects precede this helper. A later failed mapping throws for transaction rollback.

Legacy account-only roots remain account-only. Completed/verified/approved
canonical roots retain their accepted subject. Empty/single remaining rosters,
index shifts, row scoping and caller open-chore policies are unchanged. No mixed
profile/account namespace, profile erasure/credit policy or migration is added.
Two source cases cover shared mapping reuse with legacy/history preservation and
late distinct-mapping refusal before helper writes; both are unrun. Full root
reads/plans, per-root effects, lock duration and PostgreSQL/concurrency acceptance
remain open under #134/#136. No QA, database operation or release ran.


### Bounded lazy generic receipt cleanup — 2026-10-25 (#134/#135)

`idempotency.ts` previously issued a whole-backlog expired-row delete on a
probabilistically selected keyed request. It now reads only500 IDs ordered by
expires_at/id and deletes only that set with the same strict expires_at < now
predicate rechecked. A renewed row is not removed solely because it appeared in
the earlier candidate list. Remaining expired rows wait for later selected
requests; an empty candidate batch produces no delete. The existing expiry index
is a source fact, not an accepted deep-backlog/tie/lock query plan.

TTL, probability, full request hash/scope/replay, action-specific expiry and
single-key expiry handling remain unchanged. This introduces neither scheduler
nor new retention/deletion policy. Cleanup failure remains best effort and cannot
refuse the main mutation. The internal DB delegate now also requires findMany;
Prisma and the existing fake delegate supply it, while custom consumers must
implement that read. No schema or external API change. The bound covers cleanup
candidate/output rows and delete target count, not total scanned rows, SQL work,
FK effects or request duration. Overlapping concurrent passes may select the same
expired IDs; no claim of exactly500 deletions per pass or backlog completion.
An unrun501-expired-row source case checks that one pass leaves a remainder and
a later pass drains it while retaining live receipts. PostgreSQL renewal/races,
real query plans, full offline/receipt semantics and all QA remain unverified.
No database/cleanup invocation, test/build/browser/CI or release ran.
