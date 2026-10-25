# Fabricated capacity workload model — #134 / #137

2026-10-24. **Defined model, not an executed test or capacity result.** This
completes the planning requirement to cover household, event, grocery, inventory,
task and AI traffic. No runner, fixture seed, query trace, load run, provider,
scheduler, infrastructure or release is activated here. #137's reproducible-load
and measured-bottleneck criteria remain open. Existing `perf-baseline.mjs` is a
sequential ten-endpoint timing baseline; it does not implement this mixed model.

## Scope and authority

Use the canonical schema, fixture builders, route validators, read protocols and
idempotency/review contracts. Never seed production, import real family content,
substitute one parent's account for all roles, or call paid/external providers.
The future runner must reuse guarded disposable-database/loopback conventions,
refuse a live/remote database or application target, and require explicit local
adoption. A plan is not permission to turn on production telemetry or delivery.

A virtual session is one authenticated personal client or paired tablet. It is
not an active user, household, request per second or installed device. Shared
actor selection is attribution and never parent authorization. Report each unit
separately. Keep two sentinel households isolated from the traffic pool for
negative checks; never count their intentional refusals as successful writes.

## Deterministic fabricated datasets

Fixed seed `herewoven.capacity.v1`, a declared UTC clock and America/Toronto
household zone. No generator exists yet; these counts are construction inputs,
not assertions about already-seeded fixtures. Each household has 2 parents,
1 teen, 1 child account, 2 email-free profiles and 1 paired shared tablet.
Profile linking/assignments are constructed only when the exact isolated schema
and adoption protocol support them; otherwise report that dimension unsupported.
Do not silently replace a profile with a User.

| Per-household data | Ordinary | Calendar-heavy | Grocery/inventory-heavy | History/recurrence-heavy |
| --- | ---: | ---: | ---: | ---: |
| Events within the viewed year | 100 | 2,400 | 100 | 500 |
| Recurring event roots | 10 | 100 | 10 | 100 |
| Lists / items per largest list | 8 / 50 | 8 / 50 | 20 / 2,000 | 8 / 250 |
| Active stock / adjustments | 100 / 300 | 100 / 300 | 2,000 / 10,000 | 500 / 10,000 |
| Chore roots / dated occurrences | 20 / 200 | 20 / 200 | 20 / 200 | 500 / 10,000 |
| Recipes / ingredient lines per recipe | 40 / 12 | 40 / 12 | 200 / 40 | 100 / 20 |
| Meals / dated prep sessions | 90 / 12 | 90 / 12 | 365 / 60 | 365 / 60 |
| Projects / tasks per largest project | 6 / 40 | 6 / 40 | 6 / 40 | 20 / 2,000 |
| Notes / wishlist / notifications / audit rows | 30 / 30 / 100 / 300 | 30 / 30 / 100 / 300 | 100 / 100 / 500 / 1,000 | 500 / 500 / 5,000 / 10,000 |

Composition: 70% ordinary, 10% of each skewed profile. For fewer than 10 traffic
households, run the four profiles separately instead of rounding away a skew.
Counts are per household, not global table caps. Give 20% of position/date/time
sort keys equal values while keeping IDs unique. Include past/today/future work,
paused/unknown routine definitions, incomplete allocations and long Unicode text.
Build relations through canonical fixture/domain constructors; do not bypass
receipt, proof, stock or credit invariants to obtain large counts. Preserve fixture
version and row-count manifest, without storing tokens or private request bodies.

Calendar-heavy feeds intentionally exceed the current 2,000-event export cap.
Record its incomplete delivery as a known failure; never call that a passing
complete export. A separate complete-feed design/implementation remains needed.

## Traffic mix

Weights apply to scenario starts and sum to 100. Each scenario contains several
requests: report its actual request amplification separately. Select household
uniformly for ordinary runs, then separately concentrate 50% of starts on 10%
of households to expose household-lock contention. In a single-household stage,
explicitly report the hot-household variant as inapplicable.

| Scenario | Weight | Canonical paths and behavior |
| --- | ---: | --- |
| Today burst | 30% | Personal `/dashboard/today`, `/api/family/board-version`; shared `/api/device/today` and `/version` only with paired credentials. Keep existing visible/online polling cadence; do not add a request loop that pretends to be the UI |
| Calendar | 15% | `/api/events` bounded range pages, source filters, create/edit with canonical UTC instants; separate ICS read. Include overnight and Toronto DST gap/fold fixtures; imported rows retain source/read-only policy |
| Shared groceries | 20% | `/api/lists`, paged items/version; canonical grocery-add and explicit checked-state writes. Use two sessions editing one list, same-key retry after dropped response, sections and Undo. Device writes keep their separate route/namespace/actor rules |
| Inventory / food | 10% | `/api/inventory`, `/use-soon`, `/adjustments`, reviewed `/intake` and `/change`, supported Undo. Manual fabricated rows only; no camera, scanner metadata, extraction or provider dispatch. Include consumed/deleted targets and stale review refusal |
| Chores / routines | 10% | `/api/chores`, completion/review/Undo, profile capability refusal, grouped recurring views and linked routine reads. Mix visible/history rows with dense hidden prefixes; no arbitrary scheduler or full maintenance expansion |
| Household / identity | 5% | `/api/auth/me`, account login and permitted settings/membership reads. Preserve hashing and rate limits. Changed role/session/household must refuse stale requests; do not mutate real accounts or mass-create email invitations |
| Grounded AI | 5% | `/api/assistant` and grounded food review/apply/inspect routes with approved isolated fake transport/clock and real reservation/review/receipt logic. Observe no-data/budget-refusal/timeout/malformed response. No live model dispatch or invented target IDs |
| Notifications / history | 5% | Canonical inbox continuation, snooze/Undo and audit reads. Create content-minimal fabricated notification fanout only through the isolated canonical writer. Email/push transport is an in-process fake; no delivery registration, provider or scheduler |

Within personal traffic use 60% parent, 25% teen, 15% child sessions, subject to
the real route allowlist. Run shared-device traffic separately at 20% of Today/
grocery starts, not as a hidden personal session. Rejected role/capability calls
have their own negative cases; do not replace refused writes with parent calls.

## Stages and request shape

| Stage | Traffic households / simultaneous sessions | Warmup / measured period | Purpose |
| --- | --- | --- | --- |
| Correctness reference | 2 / 1 | 1 minute / 3 minutes | Establish canonical outcomes and known refusal buckets before any contention |
| Beta mixed | 5 / 10 | 2 minutes / 10 minutes | Multiple devices per household, realistic small deployment shape |
| Local contention | 20 / 50 | 2 minutes / 10 minutes | Hot household, equal-key pages and write/Undo contention |
| Local ceiling probe | 50 / 100 | 2 minutes / 10 minutes | Only after prior stage has reliable results; identify local saturation, not consumer-scale capacity |

Each session allows one in-flight scenario, chooses a seeded 2–5 second think
time between starts, and preserves canonical polling. Request deadline 15s;
scenario deadline 60s. These are harness stop limits, not product SLO changes.
Record actual arrival/completion rates, maximum in-flight requests and offered
load. Closed-loop sessions reduce arrivals under saturation; report that effect
rather than interpreting low errors as proof of high throughput.

Run cold and warmed application/database cases separately. Cold release behavior
requires a separately owned isolated process; do not restart production or share
a dirty developer server. Stub providers in the local process with declared
0ms/200ms/2s/timeout cases, always tagged synthetic. Do not combine fake provider
time with claims about real Google/Apple/Gemini/email/push latency.

1k/10k/100k concurrent-session stages are future study targets, not configured or
approved runs. They require measured connection-pool/resource limits, validated
runner capacity and a separate infrastructure plan. Never extrapolate one-host
results into million-user support or automatically escalate spend/stages.

## Correctness and stop rules

Before/after each stage reconcile expected durable effects by original key and
canonical receipt. Same-key retries must not create additional rows, XP, stock
changes, events or notifications. Unknown outcomes stay unknown until inspection;
a successful local enqueue is not a server-confirmed effect. Check household
sentinel data, stale identity/permission refusal, bounded-page continuation and
no hidden routine exposure. Export/deletion coverage must never use a partial
collection as a complete source. Preserve failed evidence; no automatic rerun.

Stop immediately on any cross-household/private shared-device exposure, duplicate
or lost confirmed effect, corrupted recovery journal, uncontrolled provider call
or escape from the fabricated environment. Stop the offered-load increase if
unexpected 5xx/timeouts exceed 1% over 60 seconds, or the database/application
resource limit declared in the run manifest is reached. These are test abort
rules; they do not redefine the 30-day availability SLO or classify intentional
4xx security refusals as outages. Do not disable authorization/rate limits to
obtain a faster result. Expected rate refusals are measured separately from
successful mutation latency and unexpected 4xx/5xx.

Compare applicable route latency with `SLO_AND_PERFORMANCE.md`; do not invent
budgets for unlisted routes. Server, client/network and provider durations are
separate. UI 100ms feedback, warm-launch, first-load JS/image and physical-device
budgets require their own browser/device evidence and cannot pass from API load.

## Required evidence record and unresolved implementation

Record exact source/build/schema/migration/client/fixture/model versions; stage,
seed/clock/zone, dataset cardinalities, role/device mix, host CPU/memory/database
connection limits, offered/actual rates, completed/refused/unknown/failed counts,
p50/p95/p99/max per fixed route and scenario, response bytes, database query/scan/
return counts, pool waits, locks/deadlocks, process memory/CPU and cache behavior.
Use declared content-free timing fields. Never retain raw URLs with query tokens,
request/response content, cookies, account IDs/names or provider secrets.

The report must identify the first measured bottleneck and supporting evidence,
then propose one reversible optimization and an objective capacity trigger.
Without a completed run these fields are **unmeasured**, not “no bottleneck”.
Keep frontend, database, native, provider and production evidence separate.

Still required: guarded deterministic dataset builder, mixed-session runner,
provider fakes/adoption isolation, outcome reconciler, resource sampling and
clean-environment instructions bound to an exact candidate; then actual runs and
observed repairs. Do not mark reproducibility, capacity, recovery drills or
production readiness complete from this planning document. Codex owns this
implementation and later evidence. Cameron owns separate production/provider/
infrastructure activation and real-device/household operating inputs.
