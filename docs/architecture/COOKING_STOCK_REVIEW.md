# Recipe and prep stock review

Source candidate, 2026-10-20; #125/#460/#128. Implementation only. No QA or rollout proof.

Recipe cooking links to `/dashboard/inventory?cookRecipe=<id>&portions=<integer>`.
Prep dish links use `cookBatch=<id>`. Only parent/teen personal inventory controls
open the sheet. Query values select canonical records; they never authorize a
stock operation. Ambiguous source query values are refused. Missing features
retain the existing feature gate.

`GET /api/inventory/cooking-review?kind=recipe|batch&id=<id>&servings=<optional>`
is private/no-store, 60 requests per user/minute. Common authentication refuses
paired-device cookies before data access. Existing User then household locks
renew session token version, membership, inventory write role and inventory /
meals features. Recipe, batch, prep session and live ingredient reads are scoped
to the authenticated household. Live joins must all be owned. Up to 100 lines;
invalid/oversized context refuses instead of truncating the recipe. Prepared
batches use the recorded recipe snapshot and captured timestamp; missing or
invalid history never falls back to a subsequently edited live recipe. Unprepared
batches with unexplained existing history also refuse substitution.

The additive optional inventory read-scope header is validated/echoed. Modern UI
requires its original actor/household echo before reading JSON, verifies the
source/actor DTO, bounds replies at 128 KiB / 15 seconds and ignores stale
requests. Only IDs and portions appear in URL queries, no ingredient/draft text.
The response contains title, live/captured basis, original/target portions and
bounded ingredient lines. No instructions, provider metadata, media or other
household record is exposed. Existing native/public capabilities are unchanged;
older servers yield an unavailable review, never a fallback stock write.

The sheet uses the existing scope-bound Inventory read. Ingredient matches use
the same normalized-name rule as canonical recipe presence suggestions: linked
stock requires the matching ingredient ID; name fallback applies only to
unlinked stock. Finished, zero/nonfinite, expired and unversioned rows do not
appear as matches. Unknown amounts remain unknown. Sort dated lots first, then
location and stable ID; show at most 20 per line, with a disclosure. Incomplete
inventory reads are disclosed. A match is neither proof of quantity sufficiency
nor advice that food is safe to eat. Missing matches never imply a purchase.

Expandable ingredient rows compare scaled recipe guidance with each lot's
unchanged amount/unit, location and labelled date. No amount is copied into a
mutation, converted or automatically allocated. Choose a lot to open the existing
Inventory item editor; explicitly record all or part used in its own unit.
Original reviewed version, canonical consume/receipt transaction, exact retry,
owned inventory recovery and adjustment Undo remain the sole write path. The
sheet hides while the item/recovery editor is open and refetches context on
return. Stale/refresh/recovery states block new selections, ownership loss hides
content. Existing history remains available after closing the sheet.

Each lot is a separate transaction. There is no recipe/prep consumption ledger,
all-lots atomic save or claim that a dish's ingredients were deducted in full.
Marking prep ready, scheduling a meal and recording cooked portions eaten do not
change inventory. Another deliberate amount-used action is another stock change;
Undo and history are the canonical way to inspect/correct it. No provider,
scheduler, schema, background queue or native activation is added.

Authored, unrun source tests: cooking-lots, cooking-review and cooking-sheet,
plus paired-route isolation inventory. Later consolidated gates must cover actual
two-household API negatives, fresh authority/version races, current/captured
history, repeated ingredient lines/lots, stale reads, exact unknown retries and
Undo, original recovery ownership, missing features, EN/ES reflow, keyboard/focus/
Back and real device lifecycle. Existing write/recovery gates remain off until
accepted through their own rollout contracts.
