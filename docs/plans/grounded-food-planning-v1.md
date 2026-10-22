# Grounded food planning — #123/#122/#144

2026-10-22: canonical read/planner foundation authored, unactivated and unverified.
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

## Remaining source required before activation

1. Finish the compact human review of unresolved existing commitments and
   explicit prepared-portion reuse/allocation through canonical bulk APIs. The
   scoped read/virtual reservation/recorded portion reconciliation above is now
   authored; its cases and all actual acceptance remain unrun.
2. Integrate authorized calendar source/range/recurrence/freshness coverage,
   explicit departure and preparation/travel/eating buffers, with the canonical
   schedule planner. `calendarChecked:false` is mandatory today. A requested
   numeric duration limit is not a household availability or departure check.
3. Add a compact existing Meals/weekly-review/chat preview that exposes source,
   unknowns, portions and editable choices. Use existing owned-draft navigation,
   owner/generation scoping and durable review inbox contracts. Keep ordinary
   provider-free controls usable when AI is unavailable. Complete the appropriate
   design/spec alignment before substantial new UI.
4. Add the allowlisted provider projection and opaque exact record references;
   validate only issued recipe/ingredient selections, never arbitrary IDs/URLs.
   Renew owner/features/config and full source evidence after provider latency.
   Prompts must not invent ingredients, amounts, nutrition, allergies or safety.
5. Add explicit reviewed apply adapters through canonical meal-create,
   several-dish prep and recipe-to-groceries primitives. Preserve source provenance,
   grocery duplicate/Undo rules, explicit ingredient selections, atomic minimal
   receipts and exact unknown-result recovery. No autonomous add, purchase,
   overwrite, consumption or portion allocation. Apply must rebuild/compare all
   relevant source identities/ranges in the effect transaction; this preview's
   keyed revision alone cannot authorize a write or universal ABA claim.
6. Add versioned semantic evaluation/scoring and privacy-safe accepted/dismissed/
   success/refusal telemetry through existing AI usage controls. Then complete
   consolidated unit/API/real-PostgreSQL/concurrency/role/compatibility/browser/
   accessibility/release checks and fix failures before activation or deployment.

Pure planner, scoped source and disposable-DB cases are authored and **unrun**.
No migration/provider/flag activation, live household data change, native/store
acceptance or release is established by this foundation. #123/#144/#128 remain
open; full thread goal remains active.
