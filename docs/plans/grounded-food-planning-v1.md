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

## Remaining source required before activation

1. Reconcile commitments from existing planned meals and the canonical bulk-prep
   lifecycle, including prepared dishes, remaining portions/eaten and next prep.
   Current proposals explicitly report `existingMealReservationsChecked:false`
   and `inventoryBasis:recorded-stock-for-new-proposals`; their quantities do not
   claim that other meal commitments have been reserved.
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
