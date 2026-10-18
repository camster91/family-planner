# Multi-dish prep sessions (#538)

## Journey

Meals shares Plan, Explore and Prep navigation across the weekly planner,
recipe exploration and bulk-cooking routes. Switching views retains the chosen
week; Prep opens the existing Bulk cooking workspace. A prep session contains
one to eight dishes cooked together, a prep day, and an optional next-prep day.
The rounded editor has three steps: Prep day, Dishes, and Meals/review. Edit one
dish at a time. Each dish has a name or saved recipe, cook, 1–50 portions, fridge
or freezer intention, and optional dated meal allocations. Each save creates the
session, all dishes, canonical FamilyMeal slots, and success receipt atomically.

The overview groups dishes within a selectable prep session. Each dish shows
total, eaten, remaining, planned and unplanned portions. Explicitly mark the
session prepared before recording eaten portions. Record consumption against a
planned meal or against unplanned portions; other meals keep their reservations.
Undo reverses a consumption entry while retaining its history. Storage labels
are intentions; the app infers no safe storage duration or expiry advice and
makes no automatic inventory writes.

Next prep is an explicit date, not a scheduler. Changing it compares the saved
old date to avoid silently overwriting another planner. Plan next prep starts a
new reviewed session seeded with the prior dishes, without prior allocations.
It has a new intent and creates nothing until saved.

## Portion rules

- Eaten is the sum of active consumption entries.
- Remaining is total minus eaten.
- Planned is each linked meal's portions minus consumption recorded against
  that meal, with a minimum of zero per meal.
- Unplanned is remaining minus planned.
- Allocations cannot exceed unplanned portions or precede the prep day.
- Dates, slots, notes, cooks and portions can change within these bounds.
- Choosing another recipe, or renaming an unlinked dish, detaches that meal.
- Deleting a meal retains its eaten history. Undo uses a stable allocation key
  to restore the outstanding reservation and relink its existing consumption.
  An unavailable/full dish is an explicit refusal, never a standalone fallback.

## Groceries and compatibility

Ingredients scale to a dish's whole prep quantity. Every linked meal shares that
dish's grocery source, preserving the existing review, open-item deduplication
and Undo. Once prepared, that dish cannot generate another ingredient purchase.
Old clients supplying an explicit different quantity receive a refusal rather
than an unexpected purchase quantity.

The schema is additive: MealPrepSession, MealBatch, MealBatchConsumption, and
nullable FamilyMeal batch references. Existing ordinary meal requests and
protocol 1 remain valid. Household deletion cascades prep records; optional
creator/cook references clear on account deletion. Parent/teen exports include
prep records and consumption history without idempotency internals.

## Permissions and failure states

Parent/teen account sessions can manage bulk cooking. Paired devices and child
accounts cannot use bulk actions; ordinary meal permissions remain unchanged.
Every bulk intent is bound to its original user and household. Fresh membership,
role, token generation and feature checks run under household locks before writes
and receipt replay. Concurrent allocation/consumption cannot overbook a dish.

Failed or ambiguous saves retain the draft and identical intent/key. Pending or
unconfirmed saves lock editing and navigation. Retry does not invent a new save.
Ordinary unsaved drafts require explicit discard on sheet dismissal. No offline
queue or process-death recovery is claimed. Listing is private, bounded and
paginated. EN/ES, light/dark, keyboard focus, 44px controls and six responsive
sizes are release checks.

## Release boundary

Validate migrations twice on isolated data, affected unit/integration tests,
actual rendered workflows and baseline repository checks. Deployment is a
separate action after review. An old server lacks batch grocery semantics, so
rollback must preserve additive records and account for that behavior.

The superseded single-dish draft is preserved outside the checkout in
`work/538-spec-before-multi-dish.md` for the current task's review history.
