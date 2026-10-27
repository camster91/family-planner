# Capacity engine implementation — #137

2026-10-24. **Authored source only; unrun.** No fixture, adapter, application,
database, load, provider or resource measurement was executed. This does not
complete the clean-environment reproducibility criterion.

## Present source

`src/lib/capacity/model.ts` constructs the four fixed local stages from
`CAPACITY_MODEL.md`. Reference/beta require an explicit ordinary/calendar/food/
history profile so each skew can be exercised separately. Larger mixed stages
use70/10/10/10 household composition. Traffic ordinals exclude two sentinel
households. Seeded per-worker streams choose the eight weighted scenarios,
parent/teen/child60/25/15 attribution, shared20% of Today/grocery starts and
2–5-second think times. A hot run puts half of starts in the first10% of the
traffic pool and half in the remainder; this avoids accidentally making55%
of starts hot through a second uniform draw.

`src/lib/capacity/runner.ts` exposes `runCapacityStage` without a CLI or import-time
action. It requires all eight scenario adapters, canonical before/after
reconciliation and a resource-limit callback. The caller must explicitly adopt
`CAPACITY_ALLOW=local-fabricated-v1`, pass the existing fixture/database and
loopback-application guards, and supply an exact40-character source commit.
Fixed stage ceilings cannot be increased through the supplied plan. This checks
declared targets; it does **not** sandbox adapter code or prove that a server
uses the declared database. Binding the server, fake providers and fixtures is
still mandatory adapter/adoption work.

Warmup and measured periods are separate. Each worker permits one in-flight
scenario, bounded to60 seconds. Adapters receive the15-second per-request rule;
the engine cannot enforce HTTP/body timing inside arbitrary adapter code.
Adapters must use canonical request helpers for that. A scenario timeout or
exception stops the entire stage; it never releases a timed-out slot to another
scenario. Abort may be ignored, so stopped stages do not perform concurrent
post-reconciliation or claim all effects settled. Preserve their report and
inspect the owned process/database before another run. No automatic replay,
rerun, stage escalation, seed/reset or teardown is included.

Workers are concurrency slots, **not counted authenticated users or sessions**.
Adapters must resolve each ordinal/role/surface to an exact fabricated session
and preserve real authorization. Draws happen per scenario start; the engine
reports actual actor starts rather than claiming a measured active-user mix.
Session-pool construction and per-client polling cadence remain adapter work.
The model's target virtual-session stages cannot be claimed from worker counts.

The engine stops on unsafe outcomes, failed preflight/postflight reconciliation,
resource-limit signals, unknown/failed outcomes above1% of the last60 seconds
(after the first measured minute), and its100,000-sample per-scenario memory
ceiling. These are harness stops, not revised production SLOs. All supplied
callbacks, including reconciliation/resource checks, have bounded waits.

## Partial fabricated dataset constructor

`src/lib/capacity/dataset.ts` now reuses the existing pure fixture row factories
for canonical families, account users, events, lists/items, recipes/ingredients/
lines and family meals, with type-only schema shapes for stock/adjustment rows. It provides deterministic insertion-order batches of at
most200 rows, fixed UTC anchor validation, reserved `.test` emails, dedicated
`fx_capacity_v1_` IDs and a versioned expected-count manifest. There are two
parents, a teen and a child account per constructed household, with no password
or token. There are two ordinary sentinel households outside traffic selection.

Cardinalities follow the model for these supported dimensions. Recurring event
roots are included in the event-row count, not added to it. They use bounded
weekly rules; expanded-instance counts remain reconciliation work. The largest
list has the model's declared size; each other list has five items. Each recipe
has the declared number of lines, sharing a household-local ingredient catalogue.
One tied pair per five sort keys exercises stable ID tie-breakers. Dates span a
rolling365-day UTC window and family-meal dates retain canonical UTC midnight.
Unicode titles/content are fabricated; no publisher, real family or provider data
is fetched. Explicit Toronto DST and other semantic edge cases remain unsupported.

The manifest deliberately returns `complete: false`. It names unsupported
profiles/linking, pairing, inventory reviewed receipts/deleted targets, profile chores/scheduled routines/credit, recipe-prep snapshots/receipts,
project-calendar linked/deleted targets, notification delivery/shared activity and receipt/review/provider
fixtures. Empty arrays do not substitute for these dimensions. Counts are
construction expectations, not observations from a seeded/reconciled database.
A declared Toronto zone is metadata, not evidence of database/application zone
configuration. No `seedFixtures`/reset call, connection, writer, migration or CLI
is wired to this builder. Later adoption must bind the schema/guards, insert in
order through a scoped writer, refuse unsupported required dimensions and preserve
fixture/receipt invariants. Do not pass this partial manifest off as a complete
mixed-workload fixture or change an acceptance box from it.

## Report and interpretation

The returned object contains fixed scenario names, exact declared source/model/
stage, stop reason, reconciliation booleans, warmup/measured starts, observed
worker concurrency, actor-start counts, scenario-duration p50/p95/p99/max and
adapter-reported requests/response-byte counts. It excludes payloads, URLs,
account/household identifiers, credentials, cookie headers and raw exceptions.
No report is automatically written or published.

Scenario duration is client harness wall time. Request amplification/bytes are
adapter reports, not independently instrumented transport measurements. Server,
database and provider metrics remain explicitly unmeasured/synthetic-required.
Unknown/cancelled scenarios contribute to duration/outcome accounting; a low
error rate under reduced closed-loop arrivals is not a throughput proof.

## Missing before a usable end-to-end run

- Complete the partial dataset constructor for all remaining canonical dimensions,
  with a guarded writer/adoption and observed row-count/schema reconciliation.
- All eight real route/domain adapters with exact household/role/device identity,
  idempotency keys, receipts, continuation, review/Undo and semantic assertions.
- Provider/delivery fakes and process/database binding adoption, with refusal of
  live provider dispatch and proof that the target server uses the isolated DB.
- Canonical before/after outcome reconciler and post-abort inspection procedure.
- Resource sampler, fixed-route request metrics and clean owned-process setup.
- Cold/warm run orchestration, exact build/schema/client/fixture identity and
  resource-limit manifest; report storage and final evidence review.
- Authored regression cases and actual clean-environment execution when QA resumes.

No command is offered as a working mixed-load test before these pieces exist.
The existing sequential `perf:baseline` command remains separate. No #137
runtime/reproducibility/capacity/drill acceptance box is checked by this source.

## Inventory row construction — 2026-10-24 (version2, source only)

`herewoven.capacity-rows.v2` adds canonical InventoryItem/InventoryAdjustment row
shapes via type-only Prisma imports; the builder still has no runtime Prisma,
connection, writer, seed/reset, CLI or import-time effect. Dedicated existing
`fx_capacity_v1_` identity prefixes remain reserved; the manifest version signals
expanded content. Do not mix manifests in later observed reconciliation.

Ordinary/calendar households have100 active items/300 history rows; food-heavy
has2,000/10,000, history-heavy500/10,000. Each household also has six finished stock
targets (three consumed, three discarded), whose six finishing adjustments count
inside the declared history total. Remaining histories are partial consumption on
active stock, distributed deterministically; active final quantity is10. Every
tenth active item has a last partial consumption that was undone, with restored
quantity/status and a later matching item version. Full completion retains the
canonical stored amount while its negative delta records consumed/discarded stock;
unknown quantities remain null. No receipt IDs are invented.

Stock references household-local ingredients, parent/teen history actors, fridge/
freezer/pantry locations, best-before/use-by and absent/past/future date-only expiry,
purchase/open dates. Barcode/provider fields remain null. Ingredient/item parents
are yielded before their dependents, within existing200-row batches. Per-item
history construction is small for the declared fixed profiles. These expected
snapshots/versions are fabricated construction, not outcomes observed through the
canonical mutation/Undo API. Inventory reviewed receipts/deleted targets, other
missing dimensions and real lifecycle semantics remain unsupported; manifest is
still complete:false. Adapted integrity source covers counts, household references,
insertion order and history-to-final snapshot reconciliation, all unrun.

## Project/task construction — 2026-10-25 (version3, source only)

`herewoven.capacity-rows.v3` now includes type-only canonical Project/ProjectTask
rows, with the existing reserved identity prefixes. Ordinary/calendar/food profiles
have six projects and40 tasks in the largest project; history has20 projects and
2,000 tasks in the largest. Each other nonempty project has five tasks; the last
project is deliberately empty/archived. Thus expected task totals are60 or2,090,
not the largest-project count multiplied by every project.

Projects cover active/completed/archived states. All tasks in the completed project
are completed; active projects mix completion and parent/teen/unassigned subjects.
Due dates cover absent and past/future UTC-midnight values. Tied task position and
created timestamps exercise the existing ID tie-breaker; repeated titles are
intentional. Projects precede their task rows and all references remain local to
the fabricated household. No calendar link is invented: existing fixture events
remain standalone. Linked/already-sent/deleted project-calendar scenarios remain
explicitly unsupported until canonical adapter/receipt semantics are constructed.

Expected counts and parent/locality/empty/largest/status/tie integrity source are
updated, all unrun. Other missing fixture dimensions, adoption/writer, exact
server/database/provider binding, canonical workload adapters and observed outcome
reconciliation remain required. Manifest stays complete:false. No generator,
writer, seed/reset, DB/API, load test, QA/build/browser/native/provider or release
was executed; this source does not complete #137 reproducibility or capacity.

## Personal history construction — 2026-10-25 (version4, source only)

`herewoven.capacity-rows.v4` adds type-only canonical PinnedNote, WishlistItem,
Notification and AuditLog rows. Notes/wishlist/notices/audits per household are
30/30/100/300 for ordinary/calendar,100/100/500/1,000 for food-heavy and
500/500/5,000/10,000 for history-heavy. These are household totals; inbox rows are
distributed across four existing fabricated accounts, not copied in full to every
account. Notes vary color/pinned state, wishes cover idle/on_the_way/received/
denied with parent decision references, and inbox history covers read/unread,
future/expired/no snooze and the existing safe Today destination. Future snoozes
are unread. Wishlist prices/external links and arbitrary notification URLs remain
null; text is labelled fabricated. Audit history uses the fixed
board_settings.changed/person/family vocabulary, a fixed safe summary and local
parent/household references. Tied timestamps exercise canonical ID tie ordering.

All parents precede dependents within the existing200-row batches. These rows
represent preloaded synthetic histories; they do not prove that a real setting
change or notification event occurred, bypass a delivery preference, or exercise
permission/fanout/deduplication. Live workload fanout must still go through the
isolated canonical writer/fake delivery adapter required by CAPACITY_MODEL.md.
Activity is a separate canonical model and remains unsupported rather than being
substituted with AuditLog. The manifest explicitly retains notification delivery/
shared activity and remaining fixture/adoption/adapter gaps; complete stays false.

Count/locality/status/tie integrity source is updated but unrun. No builder,
writer, seed/reset, DB/API/load, test/build/browser/native/provider or release
was run. Observed reconciliation and #137 full acceptance remain required.

## Manual meal-prep construction — 2026-10-25 (version5, source only)

`herewoven.capacity-rows.v5` adds canonical MealPrepSession/MealBatch/
MealBatchConsumption shapes with type-only imports. Ordinary/calendar have12
sessions; food/history have60. Sessions span the rolling UTC year, have three
manual10-serving dishes each and a next-prep date seven days later. Sessions
whose prep day is past and whose ordinal is not divisible by three are prepared;
others remain pending (future sessions never have fabricated consumption).

The first36/180 existing FamilyMeal rows become one4-serving allocation per dish,
with unique stable allocation keys, no recipe link and a snapshot dish name. These
rows remain within the existing90/365 meal totals; allocation dates never precede
prep. Remaining meals retain their existing recipe links. Each prepared dish has
a live2-serving allocated use and a cancelled1-serving use; its third dish also
has a live1-serving unallocated reserve use. Thus seven consumption records per
prepared session. Cancelled rows do not reduce remaining portions. Consumed time
follows its allocated meal day; active eaten plus outstanding planned portions
stay within the dish's10 servings. Source request receipts are null.

Manual dishes intentionally have no recipe/snapshot; recipe-linked preparation,
historical recipe snapshot recovery, review/replay receipts and mutation/Undo API
outcomes remain unsupported. No fake snapshot is substituted. Parent-before-child
order covers session/batch/meal/consumption across200-row output batches. Source
cases cover profile counts, portion arithmetic, keys, date scope, ownership and
insertion order; all unrun. Manifest remains incomplete with other required fixture
and adoption/adapter/reconciliation gaps. No generator, DB/API, writer/seed/reset,
load/QA/build/browser/native/provider/release execution occurred.

## Account chore series construction — 2026-10-25 (version6, source only)

`herewoven.capacity-rows.v6` reuses the existing FixtureChore factory for20 weekly
roots plus200 dated copies in ordinary/calendar/food, or500 roots plus10,000
copies in history. Roots count separately from occurrences: total Chore rows220
or10,500. Each root references itself, has weekly frequency and a UTC weekday;
copies retain the root ID, use once frequency and distinct later UTC-midnight
weekly dates. Root rows precede copies. No duplicate `(recurrence_id,due_date)`
key is intentionally generated. Every fourth root rotates between local parent/
teen accounts with consistent indices; others use one of the four local accounts.

Past occurrences include pending/completed/verified state, with appropriate
completion/verification timestamps; future copies are pending. Created rows are
labelled fabricated, have no photos, successor, profile subject, routine stack or
private future definition. These are account-based legacy-compatible weekly
series, not scheduled-routine/profile/credit fixtures. Actual read-triggered top-up,
completion/verification/Undo/rotation transitions and their ledgers remain adapter
and observed reconciliation work. Root-relative dates extend past the anchor's
ordinary upcoming window, but no promise is made for a server with an unbound
clock or later canonical workload actions. Expected row counts are initial only.

Source integrity cases cover declared counts, local actors, root-before-copy,
root/day uniqueness, date shape, rotation and status timestamps, all unrun. Manifest
still declares profile chores, scheduled routines, credit history and other required
dimensions unsupported, and complete:false. No generator, DB/API, writer/seed/reset,
load/test/build/browser/native/provider or release execution occurred. #137 actual
recurrence/clean-environment/capacity and broader #450/#480 acceptance remain open.


## Dormant bounded read transport and owned stage inputs — 2026-10-26

`src/lib/capacity/read-transport.ts` supplies the next adapter primitive. Factory
creation checks explicit CAPACITY adoption plus the existing loopback performance
and disposable-fixture target guards. It snapshots environment/normalized origin,
one caller-supplied fabricated session cookie and the fetch implementation.
Neither import nor factory creation makes an HTTP/database/provider call.
Explicit reads accept only a fixed allowlist of existing canonical GET routes,
construct query parameters within key/value/URL limits and cannot supply another
origin, method, credential or route. Requests use no-store, omit ambient browser
credentials, carry the captured cookie explicitly and set redirect:error.

One15-second foreground boundary covers fetch and JSON decode; the shared body
reader admits at most8MiB. Redirected/cross-origin returned responses are refused.
A transport/fetch/decode/timeout/abort failure produces unknown; a complete HTTP
reply still contains unknown JSON for the canonical scenario adapter to validate.
A200 alone never becomes a confirmed CapacityResult. No cookie, database URL,
raw query, payload or exception string is logged/reported by this primitive.
Returned private fabricated data must remain transient inside the adapter.

Metrics are explicitly elapsed request/decode time and **re-encoded admitted JSON
bytes**, not compressed/wire bytes or bytes from partial/failed responses. The
existing engine's responseBytes field must not silently relabel this as network
measurement. Arbitrary injected fetch/adapter code is not sandboxed: redirect
admission cannot recall credentials sent by an incompatible implementation, and
declared local targets do not prove the server uses the isolated database.
Session provenance, fake-provider isolation, actual fetch enforcement, source/
schema binding and before/after reconciliation remain mandatory adoption work.

The stage engine now snapshots nested traffic/sentinel lists, declared source
commit, environment, callbacks and external abort signal before waits. Later
caller mutation cannot redirect its callback/abort/report references or rewrite
reported source identity. This preserves the original declaration; it does not
attest that the supplied source SHA was actually built or measure a running app.

The primitive is deliberately **not wired to a CLI, scenario or stage**. All
eight canonical mixed adapters, session pools/poll cadence, mutation receipts,
reconciler/resource sampling, full dataset/adoption and actual clean-environment
reproducibility are still unfinished. No placeholder adapter reports success.
No QA/tests/checks/build/browser/DB/HTTP/provider/CI/release action ran. Later
checks must cover refusal before dispatch, original target/cookie/input capture,
route/query/redirect limits, streaming/legacy body bounds, stalled and abort-
ignoring reads, unknown vs confirmed outcomes, metric naming, input mutation
through every awaited phase and clean callback/signal retirement.


## Canonical calendar range-read case — 2026-10-26, dormant/unrun

`src/lib/capacity/calendar-read-case.ts` now supplies the range-read portion of
the calendar scenario. Creation captures one declared fabricated ordinal/role,
strict calendar-owner metadata, exact start/end (at most45 days), a copied set
of expected event IDs for that exact range and the guarded transport. Calling
it with another scenario, shared surface, ordinal or role refuses before dispatch.
It neither obtains a session nor proves cookie/owner/fixture provenance; the
adoption/session pool must bind these independently to the isolated backend.

The case invokes the real `fetchPlanningRange`, retaining its canonical page,
event, interval/overlap, cursor, whole-job deadline and truncation behavior.
The transport sends only the admitted original calendar comparison header on
events reads and validates successful response-owner metadata before private
body decoding. A different successful owner becomes unsafe; absent metadata is
an unsupported/failed case, not fabricated old-server proof. Explicit401/403/
409/429 is a measured refusal; malformed/transport/timeout uncertainty never
becomes a confirmed range. Foreign/unexpected IDs are unsafe; missing expected
IDs fail; only complete exact membership confirms the range read. Truncation is
unknown even when the returned rows themselves are valid.

The transport returns only the parsed calendar-owner comparison header, never
Set-Cookie or arbitrary response headers. Its parsed JSON is reconstructed as a
Response for the real reader, adding client-side encoding/decoding overhead.
Metrics retain requests and decodedJsonBytes; they are not wire-byte/server-only
latency measurements. The case result deliberately is not a full CapacityResult
and is not wired as the engine's calendar adapter. Expected-ID membership alone
does not prove correct titles/source values or timing; dataset reconciliation,
sentinels and field-level canonical evidence remain necessary.

Still unfinished: source-filter/create/edit/ICS parts of the calendar scenario,
Toronto semantic/exception fixtures, the other mixed scenarios, authenticated
session resolution/cadence, provider fakes, full fixture/schema/source binding,
resource sampling/reconciliation and actual clean-environment execution. No
CLI, seed/reset, network/provider/DB/load/QA/check/build/browser/CI/release ran.
Deferred cases include exact empty/multipage membership, omitted/unexpected IDs,
owner mismatch/missing marker before decoding, session/intent mismatch before
HTTP, refusal buckets, cursor/body/deadline errors, truncation, caller input
mutation and unsafe/unknown outcome propagation without retaining private data.
