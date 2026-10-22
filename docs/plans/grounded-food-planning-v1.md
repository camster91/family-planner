# Grounded food planning — #123/#122/#144

2026-10-22: canonical reads, planner, internal write composition and signed review
source authored, unactivated and unverified.
This is part of the full remaining implementation, not a delivered AI meal planner.

## Canonical foundation

`src/lib/food-planning/contract.ts` defines up to14 explicit meal slots across
seven days, or several dishes in one prep day, with servings, optional selected
recipe IDs and requested duration limits. Priority can favor use-soon food,
less shopping or shorter authored time. Ordinary slots are chronological; prep
dishes retain their reviewed order. A prep session can have its own time budget.
Date-only meal days remain distinct from precise calendar instants. The server
accepts today through31 days ahead in the explicitly supplied valid viewer zone.

`planner.ts` reuses canonical `indexCookInventory` / `matchRecipeIngredients`
semantics: same ingredient ID, or normalized equal name for an **unlinked**
item; active positive/unknown stock only; past best-before and past use-by do
not count for recipe coverage. It never creates an ingredient association.
Name provenance remains explicit rather than becoming a calibrated confidence.
The original presence-only What can I cook and Today APIs are unchanged.

The additional quantity estimate uses existing `scaleRecipeAmount` and only
the exact authored unit after NFC/whitespace normalization. Case is retained:
T and t may be different units. No plural aliases, mass/volume/density/package
conversion or parsed quantity text is introduced. Unknown stock/units and zero
authored recipe amounts remain `check`, not a fabricated zero or guaranteed
shortage. `shortfall` means the deficit against comparable recorded stock in
these new proposals, not proof that the household has no such food.

Each candidate is evaluated against an isolated virtual ledger. Only a selected
unheld choice advances the ledger for later new slots/dishes; alternatives do
not spend stock. Earlier expiry is allocated first. Known use-soon contributions
are counted when actually allocated, preventing the same known quantity from
covering several proposed dishes. No inventory or portion record is changed.
Occupied ordinary meal slots are held without replacing their existing records.

Authored prep+cook time is an estimate, not a readiness guarantee. Unknown
components stay unknown. Changing servings scales ingredients but **does not**
establish scaled cooking time: the base servings/authored estimate remain visible
while the duration/deadline check is unknown. Several-dish prep estimates are a
sequential sum only; no assumed parallel appliance capacity, cleanup or travel
time is hidden in the result. An exceeded prep budget is explicit.

## Authorized read API

`POST /api/assistant/food` is a bounded, rate-limited, private/no-store read API,
gated by default-off `FAMILY_FOOD_PLANNING_READY=1`. It refuses paired devices
through ordinary person auth and requires current parent/teen authority plus
Meals and Inventory features. It never calls a provider or dispatches a tool.

The server uses user-before-household membership locks and row-share authority
checks in a repeatable-read transaction. A changed authority row after the
snapshot began must serialize/refuse rather than accept stale membership. Recipe,
ingredient, inventory and meal reads are household-scoped; foreign nested
ingredient/stock links refuse without exposing their content. Recipe instructions,
publisher URLs, author/contact details and private medical/diet records are not
retrieved. No dynamic remote recipe request occurs.

Bounds are explicit:100 recipes,100 ingredients per recipe,500 relevant active
inventory rows,500 existing meal rows; one extra row detects each cap. A larger
library requires an explicit selection of up to50 canonical recipe IDs. Foreign
or unavailable selected IDs produce the same refusal; a missing selection is not
silently substituted. Source caps do not become complete coverage. Request bodies
are bounded to16KiB before parsing, response bodies to256KiB. Metadata includes
the original60-second observation lease, selected versus library recipe scope
and an owner/query/source-bound keyed revision. That revision is read identity,
not a signed action proof, receipt, human approval or write authorization.

## Existing commitments and recorded prepared portions

The source broker now reads ordinary canonical meals from the viewer's current
calendar day through the last requested slot, even if the new plan begins later.
They receive first claim on comparable recorded stock; a null serving count uses
the recipe's base servings, matching the canonical recipe-to-groceries fallback.
The source does not infer that a same-day ordinary meal has already been cooked.
An unlinked/free-text meal remains a visible unresolved commitment, not zero food.

Pending prep through that horizon, including overdue sessions, is counted once
per **whole dish** using `total_servings`. Its individual meal allocations never
reserve the recipe again. Overdue reservations use today's stock eligibility,
retain the authored original date and carry a warning; they do not allocate food
against a historical day or silently cancel the old plan. Unprepared sessions
with recorded consumption remain uncertain rather than being inferred prepared.

Explicitly prepared dishes use canonical `batchPortionCounts` over all their
allocations and active, noncancelled consumption, including allocations outside
the requested week. `eaten`, `planned`, `remaining` and `unplanned` stay distinct;
passed allocation dates do not imply eaten food. Ingredient stock is not deducted
again for those prepared dishes. Next-prep date, fridge/freezer storage and the
recipe-snapshot timestamp marker are projected from canonical records. The marker
records metadata only; frozen recipe prose is neither fetched nor validated here.
Recorded prepared portions are not a food-safety or freshness guarantee and are
not automatically offered, eaten, consumed or allocated by this reader.

Source scope includes pending sessions through the horizon and prepared sessions
with recorded remaining portions, plus every session referenced by an existing
in-range meal. A capped newest-first history list cannot silently omit older live
portions. Caps are50 sessions,200 dishes,1000 allocations and1000 active consumption
rows; one extra row signals a cap. Up to200 additional recipe dependencies and a
combined5000 ingredient lines are bounded separately. Pending dependency recipes
are scoped/validated without becoming candidates outside a user's selected recipe
catalog. Prepared recipe links require ownership metadata only; the current recipe
is not used to recalculate already-prepared ingredients. Cross-family batch/session/
meal/consumption edges, broken allocation links and invalid portion counts refuse
rather than expose foreign labels or treat incomplete sources as complete. Added
source fields participate in the owner/query/source keyed read revision.

`existingMealReservationsChecked` reports whether that read/reconciliation took
place. `commitments.complete` means recorded ingredient commitments resolved;
it does **not** mean the stock is sufficient or the schedule is feasible. Known
shortfalls remain visible. Unknown recipes, quantities, units or prep state hold
new proposals with `commitments-unresolved` and prevent a covered/zero-shortfall
claim for them. Ordinary meal labels and pending dish labels identify the records
for later manual review. All reservations remain virtual; neither inventory nor
meal/portion records are changed by the preview. Compact commitment review and
explicit reuse/allocation of prepared portions remain part of the next UI/apply
integration, followed by consolidated QA.

## Calendar and departure constraints

Optional per-meal timing uses an explicit start/end ISO interval with offsets;
prep uses one shared `prepTiming` interval for the sequential multi-dish estimate.
A window can span a DST boundary (up to26 real hours), and its end must fall on
the selected meal/prep day in the supplied valid viewer zone. Naive wall times,
rollover dates, overlapping per-dish prep windows and ambiguous buffer use are
refused by the typed request contract. No device clock becomes actor authority.

Timing can name one canonical departure event and explicit extra time before
cooking, eating, cleanup, travel and departure preparation. Travel/preparation
buffers require a selected departure. The ready-by boundary is the earlier of
the requested end and canonical departure start minus those two departure buffers.
The occupied interval includes the authored recipe estimate plus extra setup,
eating and cleanup, once per meal or shared prep session. Scaled recipe cooking
time remains unknown; no model-extrapolated duration becomes evidence.

`readFoodCalendar` uses canonical comparison predicates, source generation/epoch
tokens and storage readiness. A range-only reader avoids an invented target and
selects no unrelated event titles. Only explicitly selected same-family departure
records supply a title. No descriptions, locations, attendees, creator-based
availability, provider URLs, tokens or credentials are retrieved for timing.
The existing reschedule path and food path now share source freshness/ownership/
cap assessment; its24-hour check-age rule, future-check refusal and500-event/
100-source limits remain unchanged. One extra record detects a cap. Metadata is
read before and after comparison; every linked source must belong to the scoped
source set. No provider synchronization or calendar connection is triggered.

Unexpanded recurring roots (including those outside the requested range), invalid
legacy intervals, stale/missing sources, missing/foreign selected identities,
unsupported source storage and disabled Calendar are incomplete evidence, not
free time. Known unavailable storage/features can leave food estimates visible
with calendar holds; an actual read/transaction failure refuses the preview.
Ignoring an explicitly named owned event only changes the declared comparison;
it cannot cure missing sources or recurrence coverage. The selected departure
still limits ready-by even when ignored as a busy interval. No ignore IDs are
accepted without a requested timing window.

The pure timing checker uses half-open recorded intervals and one continuous gap,
starting no earlier than the server observation. It does not add separate short
free gaps together. Finishing when a busy interval starts is allowed; even a
zero-minute authored dish cannot start inside a busy interval. Meal conflicts and
unknowns become holds. Prep checks the whole sequential sum against one shared
window, rather than allowing several dishes to claim the same time independently.

`calendarChecked` means a requested canonical comparison had complete evidence;
per-candidate/prep `schedule.state` separately reports fits/conflict/unknown.
`fits` is an authored-time estimate against **recorded household events**, not
personal attendance/physical availability, future calendar completeness, food
safety or a promise of readiness. Other events receive no guessed travel buffers.
Source intervals/versions/statuses/departures enter the owner/query read revision;
its original60-second lease remains unchanged. A new apply transaction must still
renew/compare that evidence. Calendar records are never moved by this reader.

Timing/source/cap/freshness/DST/zero-duration and disposable-DB foreign-departure/
material-away-and-back cases are authored and **unrun**. Full UI/provider/apply,
recurrence interoperability (#124), consolidated QA and activation remain separate.

## Atomic canonical write composition (internal source only)

`food-planning/persist.ts` now composes ordinary meals or one canonical multi-dish
prep session and optional explicitly selected groceries inside one serializable
transaction. The strict person/owner-bound write route is now authored below. The required
same-transaction source guard has a concrete signed implementation. Legacy-writer food version source is now authored below and remains unapplied/
unverified. The backend APIs and exact browser request journal are authored below; compact
human confirmation, draft/pending/inbox UI integration and acceptance remain. A supplied read revision or browser recipe ID
alone must never activate this adapter.

The normal outer idempotency boundary reserves an exact owner/action/body root
receipt. Current original actor/role/generation/Meals authority is checked before
replay, including during a rollout pause. New effects also require readiness and
Inventory/Lists availability plus the guard. Completed replay returns minimal
pointers without recreating deleted targets or extending Undo. All child receipts
are created, completed and committed with the domain writes and root receipt.
Canonical meal/prep/grocery failures throw, so even a late grocery refusal or lease
expiry rolls back earlier meals, dishes, grocery rows and child receipts. Unknown
transaction outcomes must use original-root receipt inspection, not a new key.

The ordinary meal and recipe-grocery primitives now expose transaction variants;
their existing wrappers still use the same effects. Prep keeps its existing
verification, eight-dish/fifty-portion limits, next-prep and allocation validation.
No session is marked prepared and no inventory/consumption is changed. Grocery
selections specify a list and unique recipe ingredient IDs. Amounts remain full
canonical scaled recipe quantities, **not computed shortfalls**; the eventual UI
must disclose those exact amounts. Canonical source keys, duplicate reporting and
per-add ten-minute Undo remain attached to ordinary child grocery receipts.

Contract/disposable-DB composition cases are authored and **unrun**, including
late failure rollback, final-boundary expiry, full scaled grocery amounts/Undo,
paused-rollout replay after target deletion, actor-generation refusal and one
multi-dish session. Fixture guards in those cases prove composition only, not
signed-source verification, universal ABA detection or end-to-end acceptance.
Legacy-writer food row version source is now authored below; its migration and
acceptance remain required before apply activation. No new endpoint, schema/provider/flag activation or release occurred.

## Signed command review and effect-transaction renewal

Browser-safe `apply-contract.ts` now includes the complete normalized food source
query in the frozen command. `contract.ts` owns the shared preview query schema;
server exports retain compatibility. `previewFoodPlanInTx` runs the existing
scoped broker inside the caller's read or serializable write transaction. It does
not open a separately committed/nested source read.

`POST /api/assistant/food/review` is a person-only, rate-limited, private/no-store
read endpoint (64KiB input,256KiB response). It returns fresh canonical plan,
explicit command, selected cook/list display names, full canonical grocery
amounts and a server-issued `fpr1` seal. It never calls a provider or dispatches
an effect. The seal contains keyed hashes of exact owner/role/generation,
whole command (including source query, dates, servings, notes, cooks, allocations,
next prep and grocery/list/ingredient selections), source revision and auxiliary
metadata, plus the original60-second lease. It embeds no recipe/meal/person/list
labels. Replacing an existing supplied proof during an explicit new read review
does not approve or send that command; UI confirmation remains a separate step.

Issuance requires every chosen meal/dish to match this query's current concrete
canonical choices, dates and exact portions, with no feasibility holds. Prep
preserves reviewed dish order and canonical verified bulk permission. Existing
future meal slots block prep allocations rather than being overwritten; several
newly reviewed dishes can explicitly share one new allocation slot. Allocation
dates are bounded to the same today-through31-day source policy. Selected cooks
and grocery lists must exist in this household; foreign and missing identities
share a refusal. Grocery review reads bounded canonical recipe lines and reuses
`recipeGroceryAmount`, the exact same two-decimal calculation as persistence.
Full amounts, not estimated shortages, are labelled in the review. Other people's
session generation and auxiliary source metadata stay server-side; displayed
people/lists contain only the necessary ID/name/role or type.

`createFoodWriteSourceGuard` verifies the seal and original lease only when a new
effect is attempted, then reruns the scoped food/calendar/commitment broker and
auxiliary reads on the **actual write transaction**. Current feasibility and exact
choice/portion matching are checked again. Source or auxiliary revision changes
refuse, and the last write boundary checks the original lease/readiness again.
Completed canonical receipt replay remains independent of expired sources and
uses the write adapter's current original-authority check. The seal is integrity
and freshness evidence, never human consent, a provider tool or actor authority.

Cryptographic binding/tamper/owner/lease and mocked transaction-renewal/changed-
source/held-choice/cook-metadata cases are authored **unrun**. New read reviews and
write source renewal still need full real-DB/concurrency/compatibility acceptance.
Legacy-writer row generation/epochs are now authored below. Their migration and
real acceptance are still required; value hashes and ordinary timestamps alone
must never substitute for those checks. The write endpoint and browser transport are now authored below; no provider/
flag activation, migration, rendered acceptance or release is established.

## Legacy-writer food row continuity

`migration-zzzzzzzzz-food-source-versions.sql` and matching Prisma source add
`food_generation` and `food_epoch` to Family, User, Recipe, RecipeIngredient,
Ingredient, InventoryItem, FamilyMeal, MealPrepSession, MealBatch,
MealBatchConsumption and List. The existing migration runner discovers the file
after the canonical tables are created. **No migration or client generation has
run.** These internal fields are `@ignore` in Prisma Client and read only through
the bounded raw metadata helper, avoiding automatic widening of ordinary ORM
response DTOs. Installed older clients need not send or understand the fields.

One generic enabled-ALWAYS BEFORE INSERT/UPDATE trigger assigns a fresh UUID on
each insertion, ignoring a supplied old identity/epoch. Updates preserve the old
insertion identity and increment the old epoch, ignoring attempted resets. Every
update counts, including no-ops and updates to fields outside the planner's
projection. This is deliberately conservative; unrelated edits can require a new
review rather than depending on a brittle material-field allowlist. Exhaustion
refuses the update instead of freezing, wrapping or reusing an old version. There
is no new family-wide counter, collection lock, storage model or ordinary-writer
adoption requirement. Privileged schema/trigger tampering is not an app guarantee.

`source-versions.ts` checks all eleven tables for nonnull typed fields and the
exact enabled insertion/update trigger function. It reads only kind/ID/generation/
epoch for the positive dependency graph in the same source transaction. All rows
are household-scoped; recipe lines require both owned recipe and owned ingredient.
Missing, foreign, malformed, duplicated or partially returned metadata refuses.
Selectors are fixed table names, deduplicated and bounded (6000 per kind,20000
combined); arbitrary dynamic tables are not accepted. Queries use existing primary
keys and add no content/prose/email/secret selection.

The broker includes actor/family, candidate and dependency recipe/line/ingredient,
linked stock ingredient, inventory, relevant meal/allocation, session, dish and
active consumption versions in its keyed source revision. Signed review also
binds selected cook and target grocery-list versions in its server-only auxiliary
hash. A value edited away/back, restored timestamp or deleted/recreated positive
source ID cannot silently retain that row's previous version under ordinary SQL
writers. Version arrays and other people's session metadata are not projected to
the browser or provider. Completed receipt recovery remains independent of new
source/trigger readiness and cannot recreate records.

These are **positive-row continuity checks**, not a historical log, absence lock,
future availability promise, privileged-DB guarantee or proof that a source graph
is complete. Fresh whole-query/range reconstruction, caps, household/role gates,
canonical calendar versions and the write transaction's isolation still apply.
Concurrent source edits can serialize before/after an overlapping transaction;
QA must verify intended ordering/refusal/receipt recovery rather than assert a
stronger physical-world availability claim.

Metadata/cap/foreign/incomplete cases, broker/auxiliary restored-value hashes and
disposable-DB all-eleven-table raw update/reset, insert/recreate, ingredient-away/
back, cross-family line and overflow cases are authored **unrun**. Before release,
run the full migration twice on an isolated restore, generate the client, verify
triggers/defaults/constraints and old/new-writer/FK/concurrency behavior, then the
full applicable consolidated gates. Rollback pauses food readiness and uses the
prior compatible build while retaining additive columns/triggers/receipts; do not
drop or reset version history as a routine rollback. No activation is established.

## Owned save, receipt inspection and browser request journal

Source now defines three fixed person endpoints: `GET /api/assistant/food/context`,
`POST /api/assistant/food/apply` and `POST /api/assistant/food/inspect`. Authentication,
current parent/teen role/token/family/Meals authority, rate limits and a domain-
scoped session-owner header precede mutation/receipt access. Context retains the
owner during a write pause and enables new saves only with Inventory, food
readiness, existing owner-recovery/rollback gates and version storage available.
Paired devices and missing/mismatched owner proof cannot enter this path.

Apply requires a validated original key, a bounded64KiB exact command and the
signed original role/generation/command binding. The existing idempotency boundary
reserves the root; the canonical composition and real source guard commit all
children/domain effects/root together. Readiness and ownership-rollout gates are
checked for new effects, including the last guard boundary. Completed replay
renews current original authority and command/receipt shape without needing a
fresh source lease or target existence. Prep replay/inspection also retains the
canonical verified-account bulk permission. This closes a source-only gap where
a new valid account generation could otherwise have replayed an older generation's
receipt. Retained completed receipts are historical pointers, not current-target
existence or new-effect proof.

Inspection is read-only and first matches original current authority, exact key,
family/user/action/canonical hash and the signed original generation/role. Matching
completed receipts return before expiry/readiness/source checks. Live in-progress
records return pending without retry permission. Missing or abandoned records can
become `ready` only after full current same-transaction source renewal within the
original lease; that means the **same frozen key/body** may be deliberately retried,
not that an earlier attempt failed. Expired/conflicting/paused/unavailable/malformed
states never prove no effect, supply a replacement key, rewrite the intent or
create a new proof. Inputs are bounded including nested-body escaping; replies are
private/no-store and bounded to256KiB. No raw command/labels are logged on failure.

Browser-safe contracts validate entry size/key/body, original expected person/
household, receipt correspondence, unique choice/target/request pointers and
consistent recovery states. Client inspection checks exact echoed body/key,
current owner scope and an independently computed canonical request hash. Server
`canRetry` and local `retryEligible` remain distinct; local eligibility also requires
current enabled context and original deadline. Save sends only the frozen body/key
to the fixed endpoint. Non-201, malformed success, timeout and HTTP refusals remain
unknown until inspected; only a matching201 receipt confirms the attempt.

`browser.ts` composes the existing owned request journal, domain-isolated owner
scope, retirement/Web Lock rules and localStorage/IndexedDB candidate handling.
There is no unowned fallback, background send, auto-retry or second food store.
Four frozen entries are bounded within a768KiB journal and staged durably before
send. A backwards-compatible `reviewBeforeEverySend` opt-in in the generic journal
makes food inspect receipts/sources on **every** send, including in-session unknown
retries; existing domains retain their previous recovered-only default. Recovered
entries still require explicit user review, and delayed results still require the
same current owner/storage lease. The journal retains entries even on success;
only explicit confirmed dismissal or acknowledged local forgetting removes them.

HTTP authority/ownership/body-bound/pause-replay/unknown cases, receipt-first state
and original-generation refusal, client exact-body/hash/unknown handling, optional
journal review/legacy-default and disposable-DB original-generation/prep-verification
cases are authored **unrun**. No API was called and no real record was changed.
Compact review/timing/portion UI, source-read DTO validation, draft/exit/pending/
inbox integration and projection of canonical child grocery duplicate/Undo reports
still need wiring. Root receipts stay minimal; do not silently omit those grocery
outcomes from the final human journey. All original migration/concurrency/role/
storage/client/rendered/release acceptance remains in consolidated QA, with flags
unchanged/off and no source/QA/production acceptance conflation.

## Compact source review presentation and transport

`design/FOOD_PLAN_REVIEW.md` extends the existing meal journey/composition and
approved calm-sheet direction. It records flow/state/role/draft/Back requirements,
without claiming a newly created Figma frame or rendered approval.

`view-contract.ts` validates nested preview/review payloads before browser use:
source labels, IDs, amounts, unknowns, holds, calendar evidence, commitments,
prepared counts and the exact60-second lease. Preview now echoes the normalized
source query; client read rejects a different date/query even if slot keys match,
alongside household/role/generation, selected recipe catalog and portion checks.
Signed review compares the complete normalized command, and browser/server share
pure `foodWriteChoicesMatch` semantics. After either private read, client helpers
renew person scope and generation before returning delayed data for rendering. Review display people/lists/grocery choice/
ingredient IDs must correspond exactly to the selected command; extra private
metadata, unrelated records or held/inconsistent choices refuse before rendering.
No keyed revision or client parser becomes authority to save.

`FoodPlanSummary` is an initial person-only presentation component: one meal/dish
at a time, labelled previous/next controls and expandable paginated ingredient,
commitment and prepared-portion lists. Alternatives emit only a selection callback
for a fresh preview. Scaled cooking time stays unknown despite a recorded base
estimate. Calendar fit is explicitly an estimate against recorded household
events; holds never become a successful feasibility claim. Existing quantities,
recipe-default servings, unresolved states, next prep and distinct eaten/planned/
remaining/unplanned counts remain visible. It performs no fetch/save/stock/portion
write, and prepared portions link to canonical prep management. The parent sheet,
edit/timing/portion controls, durable draft/exit/pending/inbox orchestration and
confirmed grocery outcome/Undo integration remain to be wired; the component is
not exposed as an unfinished replacement for existing Meals controls.

DTO owner/query/command/nested-shape and mounted per-choice/long-list/unknown-time/
hold/alternative cases are authored **unrun**. No app rendering, API/DB call,
browser/source acceptance, flag activation or release was performed. Full UI,
provider/evaluation and the other remaining sources still precede consolidated QA.

## Initial Meals sheet and editable-to-frozen transition

The Meals page now has a lazy personal planner entry behind the unchanged food
capability flag. Layout passes only capability and role; the sheet fetches its own
current person/household/owner context on explicit opening. Child/paired/shared-
fridge and active profile-preparation surfaces do not mount it. The explicit
`?foodPlan=recovery` entry remains available to eligible people during a write
pause; it never enables a new mutation. Existing manual Meals/Prep controls remain.

`editor.ts` stores raw unfinished dates/numbers, per-choice notes/recipe/cook/
storage/allocation fields, optional whole-session settings and local wall-time
choices. Canonical request/write schemas validate before preview/review. Shared
schedule wall-time resolution refuses nonexistent clocks and requires an explicit
choice on a DST fold. Several meals and one multi-dish prep remain separate;
prep limits/next prep/whole-dish portions use canonical schemas. Default shortened
labels for long imported recipes are shown in exact confirmation and do not alter
the recipe identity/title.

The existing owned food journal now supports one `local-food-draft` plus up to
four immutable requests within its overall byte bound. Local draft payloads bind
person/household; only network entries are accepted by backend inspection/apply
schemas. Debounced local saves and close/Back preparation use exact predecessor
CAS under the existing lease. Human confirmation atomically promotes that same
entry/key to the exact reviewed network body before any send. Failed/uncertain
persistence cannot dispatch. Repair adopts only the known transition and preserves
newer unsaved editable input; explicit stored-copy adoption/forgetting remains a
separate acknowledged action. Older network-only readers encountering a newer
local-draft kind must hold/update rather than silently omit or overwrite it;
actual installed-client/rollback acceptance remains unverified.

The initial sheet edits one choice at a time, with separate suggestion and exact
save review steps. Current implementation includes date/meal/portions/priority,
repeat suggestions, prep label/storage/next day, time budgets and shared/per-meal
cooking windows with explicit setup/eating/cleanup. Recipe alternatives renew the
preview without saving. Exact confirmation displays actual cooks, notes, prep
allocations and selected full grocery amounts from the signed command, including
restored draft choices. Account verification is projected only as an own-person
prep capability and is rechecked before prep promotion/effect. This source is
not a fully finished editor: full recipe-catalog/cook/list/ingredient/allocation/
departure pickers and explicit prepared-portion reuse are still required below.

The session controller guards double actions synchronously, invalidates a review
immediately on an edit, binds confirmation to the exact draft revision/deadline,
separates background local saves from network operations and suppresses delayed
private results on lifecycle/owner changes. A matching201 save stays known even
if a later receipt inspection cannot be read. Unknown writes remain frozen;
receipt inspection and exact retry are explicit. Known receipt dismissal does
not remove canonical records; unknown local forgetting is acknowledged and never
asserts no effect. Back/close/link exits flush/verify owned work and release the
existing history sentinel before navigation; stored clean work does not need an
unload warning. This remains authored behavior, not rendered evidence.

Partial-field/DST/query-command matching, local-only/no-send/exact-promotion,
review-edit race and known-success controller cases are authored **unrun**.
No mounted/browser/API/DB/native check or flag activation occurred. Full editor
controls, canonical child grocery outcomes/Undo, broader inbox/weekly/chat entry
points, provider/evaluation and all remaining goal work still precede consolidated
QA. Migration/readiness/compatibility/lifecycle/rendered/release gates stay open.

## Food planning selectors and prep allocations — 2026-10-22

The initial owned Meals sheet now has household-scoped searchable recipe pools,
per-choice recipes, account cooks, grocery/shopping destinations and optional
ingredient selection. A read-only owner/query-bound selector API returns eight
rows per page plus exact selected metadata; authorization, household filters,
strict DTOs, bounded response sizes and delayed-owner renewal precede rendering.
Email-free profiles remain separate from account cook identities.

Prep dishes now support paged meal allocations with explicit portions, notes and
inherited versus unassigned cooks. Old draft cook intent is preserved. Optional
calendar departure selection uses an explicit unambiguous search interval and
travel/get-ready buffers. Reviews show exact estimated start/finish/deadline and
selected departure instants. Grocery-only edits retain matching read previews
while invalidating signed confirmation; no automatic grocery or portion writes.
Occupied prep meal slots now check the complete day, including legacy non-midnight
rows. Selector/foreign-selection/DTO/owner/catalog/partial-allocation cases are
authored and unrun. No tests, typecheck, lint, build, browser, API, DB, schema,
provider, flag, push, merge or deploy action. Canonical grocery outcomes/Undo,
prepared-portion reuse, inbox/weekly/chat entry points, provider/evaluation and the
broader goal remain open before consolidated QA and authorized release.

## Food grocery outcomes and canonical Undo — 2026-10-22

The food sheet now has explicit original-grocery-result reads and per-add Undo.
Root receipts remain minimal and unchanged. Separate bounded no-store endpoints
renew current original person/role/generation, verify the signed original command,
require its committed root/hash and follow only exact child pointers. Child action,
owner, family, normalized request hash, selected ingredient counts and original
creation-based Undo deadline must match before projecting details or undoing.
Missing child details never become a failed meal/prep save. Historical added/open
and possible free-text-lookalike counts are distinct from current list contents.

Explicit Undo runs existing canonical provenance/window/checked-row rules inside
an authorized serializable transaction. It does not undo meals/prep, replay adds,
extend deadlines or change root receipts. Unknown replies retain the original
owned food intent and exact child target for explicit safe repeats; no background
Undo. UI actions share sheet operation/storage/owner/navigation guards, paginate
one add at a time and require acknowledgement before forgetting an in-view unknown
Undo. Original intents, not volatile result banners, retain recovery across reload.

Scoped linkage/hash/foreign-root/child-unavailable/strict-DTO/canonical-Undo and
mounted explicit-action/unknown/expiry cases are authored and unrun. No tests,
typecheck, lint, build, browser, API, DB, schema, provider, flag, push, merge or
deploy action. Prepared reuse, inbox/weekly/chat integration, provider/evaluation
and broader goal source remain before consolidated QA and authorized release.

## Specific prepared-dish reuse handoff — 2026-10-22

The personal food review can now hand off an exact prepared session/batch with
unplanned portions to its canonical Plan portions sheet through owned draft-aware
navigation. The destination reloads current household-scoped data, including an
older exact session beyond the first page, and refuses missing/unprepared/full/
incomplete targets without opening a different dish. Invalid or conflicting URL
intents have an explicit clear/reload state. Links do not allocate or mark food
eaten, reserve raw stock, or add groceries.

The canonical bulk read now probes51 and projects50 meal/consumption rows with
optional `portions_complete` metadata; older clients retain bounded arrays, while
this new reuse handoff holds older/incomplete projections. A backwards-compatible
optional `require_prepared: true` allocation field is rechecked under the existing
effect transaction before creating meals. Current canonical role/verification,
portion budget, household and receipt rules remain. Source unit/mounted/disposable-
DB cases are authored and unrun. Bulk action draft/unknown recovery is still
memory-held; durable owned bulk editor/action recovery must be implemented before
claiming this entire reuse workflow source-complete or release-ready.

No tests/typecheck/lint/build/browser/API/DB/schema/provider/flag/push/merge/deploy
or issue closure. Wider inbox/weekly/chat, provider/evaluation and broader goal
source remain before consolidated QA and authorized release.

## Bulk owned-recovery source foundation — 2026-10-22

Strict local-only create/action draft and frozen canonical bulk request contracts,
person/role/generation-bound context/apply/receipt-inspection endpoints and an
existing-owned-journal browser adapter are now source-authored. Apply reuses the
canonical bulk effect with exact receipt/status/target/count validation in an
atomic transaction. Canonical refusals throw for rollback; readiness and the
original24-hour retry lease are checked before commit. Completed receipt replay/
inspection precedes lease/readiness/target availability. Every explicit send is
inspected; nonmatching replies remain unknown with original key/body retained.

The independent readiness example is0, with existing owner/rollback gates required.
No actual setting or schema changed. Unit/HTTP/client/storage-fault and allowed
PostgreSQL rollback/replay cases are authored and unrun. Existing bulk forms still
use their memory-held hook: wiring one panel-owned controller, raw-draft flush/
restore/promotion, compact recovery/discovery and wider inbox integration remain
source work. This foundation is not a completed durable bulk UI or release. No
QA/API/DB/schema/provider/flag/push/merge/deploy or issue closure. Full goal remains
active; see [`meal-prep-recovery-v1.md`](./meal-prep-recovery-v1.md).

## Bulk forms and owned recovery controls — 2026-10-22

Bulk creation and action sheets now share one panel-owned recovery controller,
strict raw-field conversion and existing CAS journal. Draft fields debounce into
local storage; close/navigation flush the latest form reader. Save compares the
current raw draft and actual canonical payload before atomic draft promotion,
then explicitly inspects/sends that immutable key/body. Unknown replies retain
frozen requests; confirmed results remain separate from later read/storage errors.
Fields cannot turn a saved request into a second save. Closing an owned sheet
keeps its work and receipts rather than implicitly discarding it.

Compact EN/ES controls provide draft restore, one-request-at-a-time inspection/
exact retry/known-result dismissal, acknowledged local forgetting/stored-copy
reload and exact storage repair. Action restore reloads the same canonical target;
missing, incomplete or unprepared reuse targets preserve the draft. Prepared-dish
handoff waits for recovery state and cannot overwrite an existing draft. Back and
owned exit guards preserve current readers; newer edits during a storage write
remain dirty and prevent navigation until durable. Owner changes suppress private
work without erasing original storage. Existing empty owned envelopes preserve
adoption through a pause, so new web work does not silently fall back to legacy.
Legacy flag-off/no-journal journeys remain separate; readiness stays off.

Conversion/controller/form/shelf/Strict-Mode/owner/pause/storage-race cases are
authored and unrun. No tests/typecheck/lint/build/browser/API/DB/schema/provider/
flag/push/merge/deploy or issue closure. Wider unified inbox/weekly/chat adapters,
provider/evaluation and broader goal source remain before consolidated QA and
release. See [`meal-prep-recovery-v1.md`](./meal-prep-recovery-v1.md).

## Meal and bulk work in review discovery — 2026-10-22

The parent inbox Saved requests reader now supports meal planning and canonical
bulk work through the same read-only owned-store snapshot/lease machinery as its
existing domains. It projects generic labels, editing/submitted phase, recorded
request times when available and fixed recovery URLs. It does not copy raw drafts,
names, notes, request keys, IDs, proofs or quantities into inbox state. Missing
draft/prep timestamps remain explicitly unknown. Every candidate store and current
owner/household/generation is rechecked; discovery does not initialize a competing
journal, inspect receipts, reconcile replicas, resend, forget or write queue data.

Weekly meal/prep/food/grocery steps now offer a compact personal planning/saved-
work disclosure. Parent/teen capability links open canonical recovery/planning;
children receive no new private links. Navigation respects active owned drafts and
weekly pending/storage guards, and never marks progress reviewed. No local counts
or provider calls run on weekly mount. An explicit bulk recovery URL now obtains
current person authority independently of a failed current-list read, preserving
receipt inspection when targets/list data are unavailable. Editable target restore
still requires its canonical reads; current-list failure blocks fresh saves.

Adapter/readonly/owner/replica/null-time, personal-link and target-independent
recovery cases are authored and unrun. Fridge/preparation omissions and parent
inbox limits remain. No checks/browser/API/DB/schema/provider/flag/push/merge/deploy
or issue closure. Broader chat/provider/AI evaluation and remaining full-goal source
still precede consolidated QA and authorized release.

## Metered AI meal choices and explicit draft adoption — 2026-10-22

An optional personal Meals AI path is now source-authored. It ranks at most four
canonical recipe candidates per slot through opaque, owner/source/slot-bound
references. The minimized provider packet contains recipe/ingredient names,
recorded quantities and timing/calendar-state estimates, not canonical IDs,
URLs, owner metadata, notes, instructions or event names. A shared opaque recipe
identity supports repeat constraints. Output is strict reference selection only;
invented/cross-slot references, missing slots, extra actions and unintended repeats
refuse. Pinned recipes remain pinned. Incomplete/occupied/unresolved-commitment
sources refuse before provider dispatch; unknown quantities/durations remain held
estimates rather than invented facts.

The server requires existing quota/cost observation with no unmetered fallback,
renews person/role/generation/features/provider configuration and original source
identity after latency, then reconstructs the selected query in the same canonical
read snapshot. The original one-minute lease is never refreshed. The new example
`FAMILY_FOOD_AI_READY=0` also requires existing food/AI-usage gates; no real settings
or provider activation changed. Usage uses the existing assistant accounting
bucket; API outcome counts are not user acceptance or successful domain saves.

The EN/ES sheet offers explicit optional provider disclosure and a durable local
cooking preference. AI choices render separately, one at a time. Use these choices
copies recipe IDs into the owned draft, clears groceries for changed recipes,
persists editing, and obtains a new canonical preview. Exact save review and
confirmation remain separate. Dismiss, failure, pause and expiry preserve the raw
draft and provider-free controls. No meal/prep/grocery/stock write follows a reply.

Versioned grounding/feasibility metrics validate issued choices, intent, owner,
servings, pins, repeats and original lease. They do not rate nutrition, safety,
preference satisfaction or overall app quality. Catalog/client/editor/service/UI
cases are authored and **unrun**. No test/typecheck/lint/build/browser/API/DB/schema/
provider/flag/push/merge/deploy or issue closure. Broader chat handoff, fixed-vocabulary
accept/dismiss telemetry and cross-feature evaluation source remain before final
consolidated QA and authorized release; the full goal remains active.

## Remaining source and acceptance before activation

1. Finish the compact human review of unresolved existing commitments, without
   implying free-text commitments consume zero food. Exact prepared-dish navigation,
   canonical allocation checks, owned bulk forms/recovery, parent inbox snapshots
   and personal weekly links are source-authored above; their acceptance is unrun.
2. Owned timing controls, concrete calendar reads, source-reference renewal and
   apply-time checks are source-authored. Recurring source expansion stays held
   under canonical #124; do not claim complete recurrence/physical availability.
3. Meals catalog/cook/list/ingredient/allocation/departure controls and optional AI
   draft adoption are source-authored. Finish broader assistant/chat handoff using
   canonical owned navigation, never implicit save or private layout context.
4. The minimized provider projection, opaque references, exact output validation,
   post-latency canonical reconstruction and initial versioned evaluation are now
   source-authored. Complete cross-feature semantic fixtures and privacy-safe
   accepted/dismissed feedback. Existing usage HTTP outcomes/cost accounting do not
   prove a user accepted a suggestion or a consequential write succeeded.
5. Preserve legacy-writer version probes, bounded dependency coverage, canonical
   grocery duplicate/Undo rules, explicit ingredient choices, minimal atomic
   receipts and exact unknown recovery. Run migration/isolation/concurrency and
   effect-transaction source renewal acceptance in final QA. No autonomous add,
   purchase, overwrite, consumption or portion allocation is in scope.
6. Finish the full thread's other remaining code/plans first, then run consolidated
   unit/API/real-PostgreSQL/concurrency/role/compatibility/browser/accessibility and
   release checks, fix failures, and perform the authorized merge/deployment.

Pure planner, scoped source, AI selection and disposable-DB cases are authored and
**unrun**. No migration/provider/flag activation, live household data change,
native/store acceptance or release is established. #123/#144/#128 remain open;
the full thread goal remains active.
