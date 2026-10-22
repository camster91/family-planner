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
