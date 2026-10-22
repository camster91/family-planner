# Grounded food review — implementation spec, 2026-10-22

Source extension of the approved calm-sheet direction in
[APPROVED_UI_ROLLOUT.md](APPROVED_UI_ROLLOUT.md), the existing
[meal/task/parent journey frame](https://www.figma.com/design/s0qsOr91Au0OJ70SCZEWb4?node-id=7-222)
and [composition family](https://www.figma.com/design/s0qsOr91Au0OJ70SCZEWb4?node-id=54-58).
These links identify existing foundations, not a newly created or approved Figma
screen. This source spec is not rendered/design acceptance; no browser QA runs
until remaining source is complete.

One contextual form sheet reuses `Dialog variant="form"`, semantic tokens and
existing buttons/pickers. Flow: choose meals versus one prep session → edit dates,
portions and priorities → read suggestions → review exact save/grocery choices →
explicit confirmation → known result or saved pending work. Never auto-save from
preview, recipe selection, provider reply, close, mount or recovery inspection.

Review one meal/dish at a time with labelled Previous/Next and a count. Recipe
name/servings/time/holds come first. Ingredients, existing commitments and prepared
portion metadata use expandable sections. Long labels wrap; controls are44px.
Changing a recipe/portion/day clears the previous review/proof and rereads sources.
Unknown duration/units/quantities stay explicit, including scaled cooking time;
recorded stock and recorded calendar fit are estimates, never safety promises.

For prep, show the sequential session estimate separately. Prepared/eaten/planned/
remaining/unplanned and next-prep date remain distinct; no passed date marks eaten.
Use canonical prep controls for allocation/consumption. Food reviews themselves
never consume stock or portions. Groceries are opt-in with exact list/ingredient
selection, full scaled quantities and canonical duplicate/Undo outcomes.

Parent/teen person context only. No paired/shared-profile projection, private
layout-seeded owner context, new account inference or provider secrets. Source
responses and nested labels must validate before rendering; mismatched role,
generation, household or query is an explicit read failure, not an empty plan.

Editable draft, stale proof and frozen unknown request stay distinct. Use existing
owned draft/exit and request journal leases. Back/close must preserve or explicitly
resolve unsaved work; no native confirm/alert. Recovery offers inspect/exact retry/
acknowledged forgetting, never a new key after an unknown result. Paused recovery
can inspect matching receipts without enabling a mutation. An ownership switch
suppresses delayed results and retains/retire scopes through the existing machine.

Required later acceptance: EN/ES, loading/empty/read failure/offline/stale/held/
pending/storage fault/success/permission changes, six repository viewports,
keyboard/focus/Back, long text/reflow, light/dark and role/privacy boundaries.
No graphic, image-generation, Figma mutation or deployment is needed for this
bounded extension. Full orchestration and acceptance remain in the food plan and
#123/#144/#128; the summary component alone is not a shipped planning flow.


## Initial sheet source checkpoint

The Meals launcher, raw editable draft, per-choice sheet, exact save details and
pending-request controller are now authored behind the unchanged flag. The
capability wrapper contains no private owner context. One editable document
promotes into its exact immutable request within the same owned journal; failed
storage holds the sheet. Full catalog/cook/grocery/allocation/departure pickers,
prepared reuse, child grocery outcomes and wider entry points remain source work.
No browser or device rendering/acceptance is claimed at this checkpoint.

## Selector and allocation source checkpoint

Catalog/account/list/departure selection uses read-only contextual sheets with
eight results per page, explicit search and exact selected metadata. Ingredient
selection is opt-in and paged by five; prep allocations are edited one at a time
with distinct inherited/unassigned cooks and whole-dish portion totals. Selected
departures show recorded exact instants and separate travel/get-ready margins;
preview timing shows exact estimate/deadline in the explicitly chosen zone.
No selector or checkbox saves domain records. Selection changes invalidate signed
review; grocery-only changes may retain an exactly matching source preview.
All controls are source-authored; rendered/design acceptance remains unrun.
Prepared reuse, grocery outcomes/Undo and wider entry points remain source work.

## Grocery outcome and Undo extension

After a known save, an explicit read opens the original child grocery results:
added count, already-open count, possible lookalike count/truncation, destination
and original Undo deadline. These are historical receipt facts, not current list
contents. Missing child details do not invalidate the confirmed meal/prep save.
Undo is per original child request, never the whole food plan, and preserves
checked or unrelated rows through canonical grocery rules. It runs only on an
explicit tap. Lost/malformed responses remain unconfirmed; retries use the same
original child target. Original durable food intents retain recovery across reload.
No automatic Undo, new grocery add, root replay, deadline extension or private
lookalike row text is introduced. All actions share the sheet's current-owner,
operation, close and pending guards; final rendered acceptance stays deferred.

## Existing prepared-dish handoff

A specific prepared dish with recorded unplanned portions can open its canonical
Plan portions sheet. This is a navigation intent, never a prepared/eaten/grocery
mutation. Persist the food draft through existing owned navigation before leaving.
The destination reloads the exact household-scoped session, including older pages;
it must not substitute a different dish when missing, no longer prepared or full.
Show the current canonical portion counts before explicit allocation. No raw stock
reservation or recipe grocery add follows reuse. Current prepared/personal role
authority and canonical submit-time portion checks remain required. Existing bulk
action draft/unknown recovery needs durable owner-scoped follow-through before
this whole reuse workflow is release-ready; link wiring is not that acceptance.

## Bulk draft and request recovery contract

Reuse must adopt durable owner-scoped bulk action/editor recovery before release.
Keep one strict local-only raw document and at most four frozen canonical requests
in the existing owned journal, with atomic draft promotion before dispatch. Bound
network intents to their original person, household, role, token generation and
issued time; use fixed canonical create/action adapters and exact success shapes.
Inspection reads matching receipts before lease/readiness/target freshness, remains
read-only and cannot turn a missing/expired receipt into proof of no effect. Exact
retry requires explicit human intent, current authority, enabled recovery and the
original bounded retry lease. Never replay automatically, change a key/body, seed
private draft context into layout or expose drafts to shared/profile views.
Editable restore must reload the same canonical target first; target absence must
not erase a frozen request. Stored work, confirmed receipts and volatile form state
remain distinct. Storage repair and acknowledged forgetting use existing owned
CAS/retirement/history-exit machinery; readiness remains off pending full QA.

## Bulk form/controller source checkpoint

Creation/action forms now register one latest raw reader with their panel-owned
journal. Raw input survives local close/navigation; strict current payload and
editable predecessor must match before promotion to a frozen request. The compact
EN/ES recovery shelf pages one request, restores the exact canonical target, and
separates inspect/retry, known success, exact storage repair, acknowledged local
forgetting and acknowledged stored-copy reload. Back closes acknowledgement
before the underlying form. An adopted empty journal remains owned during pause.
Prepared reuse waits for draft ownership; no mount/restore/repair auto-submit.
Cases authored/unrun; rendered/device/source-to-screen acceptance and wider inbox/
weekly/chat orchestration remain. No readiness or provider activation is claimed.

Bulk personal recovery/forms also omit fridge mode and the active event-
preparation surface. Changing to those views hides private form state without
erasing its owned journal; returning requires current personal authority.
