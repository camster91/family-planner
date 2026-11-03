# Connected workflow studies — #499 / #460

Status: proposed, interactive local design/spec reference, not production implementation. Canonical plan: https://github.com/camster91/family-planner/issues/499. Source baseline `c9e2ec1c1562ff9de034fecce31e55deda742637`. Uses the accepted Glance and act direction, existing Woven Grove palette, unchanged H asset and navigation. No new backend, provider, role or feature removal.

Run from repository root: `python3 -m http.server 18427 --bind 127.0.0.1`, then open `/design/connected-workflows/index.html`. Prototype only, fabricated data, no online search, persistence, authentication or production mutation. Browser-local sample selections reset on reload. Navigation includes explicitly out-of-scope destinations. Toasts disclose interactions that are only explanatory. System/Georgia typography is a local approximation, not proof of exact production fonts. This supplements existing Figma references in `design/APPROVED_UI_ROLLOUT.md`; it does not claim a new Figma approval.

## Source findings and disposition

| Surface / source | Observed source | Proposed disposition |
|---|---|---|
| Today: `src/components/fridge/TodayBoard.tsx`, `TodayControls.tsx` | Add-or-ask and one controls menu already consolidate earlier duplicate controls; layout editor sits inside menu. Clock/update/fridge entry have responsive visibility rules. | Preserve those improvements. Use a compact heading and meaningful Next up content. Do not report old screenshots as current runtime defects. Validate actual eligibility rules and rendering before changing fridge entry. |
| Meals: `src/app/dashboard/meals/page.tsx` | Header Add Meal/inventory link, separate Plan/Explore/Prep navigation, independent FoodPlanningLauncher, week controls. | Keep one view row, contextual week navigation, one dominant Plan action. Fold assisted planning into the relevant chooser/prep intent; preserve its grounded review/recovery behavior. Inventory remains reachable. |
| Add Meal: same page, `src/components/meals/RecipePicker.tsx` | Date, slot, name, saved query, saved select, New recipe, cook, notes and servings compete in the editor. | Replace competing recipe inputs with intent-based choice. Keep context; ask servings once; secondary cook/notes. Quick meal remains. Do not just wrap the same long form in more accordions. |
| Discovery: `src/app/dashboard/meals/explore/page.tsx`, recipes discover/preview APIs | Discovery and import already exist separately from saved picker. | Extract/reuse the discovery controller and preview UI, preserve source attribution, duplicate review and current owner/cancellation guards. Not a new parallel discovery backend. |
| Calendar: `CalendarPageClient.tsx`, `CalendarPlanner.tsx` | Planner owns source selector/view/date controls; capture passed into header; import also mounted as separate trailing action. | One date/view toolbar. Connections, import and capture grouped predictably beside calendar sources, with frequent Add event distinct. Preserve deep links, subscription read-only rules, overlap and duration semantics. Agenda study only; week grid remains to be designed/verified. |

`ROUTE_INVENTORY.md` enumerates current page sources. It is not a completed per-screen controls audit. This slice manually traces the three exemplars; remaining routes need component-level inspection, populated/empty states and actual role/device evidence.

## Prototype flow and implementation contract

1. Today → Find dinner or Meals → Plan a meal retains meal day/slot.
2. Find recipes / Saved / Paste link / Quick meal are mutually exclusive modes inside one chooser. Saved should initially show actual favorites/recent recipes; no false empty library during loading.
3. Results → preview keeps query/scroll/filters and draft context on Back. Show publisher, available timing and serving details; don't fabricate missing data. Unavailable discovery offers retry/paste/quick meal while retaining input.
4. Plan this meal → confirm chosen recipe, context and servings. Cook/notes secondary. No duplicate recipe-name field unless a quick meal is selected. Existing recipe edits need explicit policy and must not mutate shared recipes accidentally.
5. Save → real confirmed result with next step Review groceries. Pending blocks duplicate saves. Unknown outcomes reconcile the original idempotent operation; navigation must preserve recovery context. No optimistic claim of persistence.
6. Grocery review → select missing amounts using canonical recipe/stock data, handle unknown units conservatively, choose destination if multiple grocery lists, append idempotently. Link to actual resulting list. Stock consumption is a separate explicit action, never inferred from adding groceries.
7. Cook/leftovers/reuse and multi-dish prep continue through existing meal/batch/portion APIs. These screens are not fully mocked in this slice and remain required before #460 is complete.

Canonical adapters to reuse: `/api/recipes/discover`, `/api/recipes/preview`, `/api/recipes`, `/api/recipes/[id]/curation`, `/api/recipes/collections`, `/api/meals/create`, existing meal mutation/recovery controller, AddToGroceriesButton and current bulk APIs. Verify request/response and ownership contracts before extraction; endpoint presence does not prove live provider success. One household scope and current authorization apply throughout.

## People, devices and states

- Study is the parent personal view only. Teen/child permissions, emergency access and email-free assignments remain separate required examples. Do not use cosmetic role toggles as authorization evidence.
- Shared device: show only approved household content; no account entry/private messages, finances, care records or precise private addresses by default. Parent personal prototype is not a shared-device design.
- Phone: bottom navigation, agenda/day rows, near-full-height bottom sheet. Tablet/desktop: top navigation, meaningful multi-column content, wider editor. Long tasks can scroll intentionally; don't shrink text or hide useful content just to fit one screen.
- Keyboard: native dialog focuses/traps and closes with Escape. Production must retain opener focus, draft/discard and pending-close semantics; this disposable prototype does not implement draft recovery.
- Required production states: loading without layout jumps, no recipes, no matches, partial metadata, inaccessible source, invalid URL, provider timeout, forbidden role, stale session, offline, interrupted save, existing duplicate, pending confirmation, successful save and undo where supported. These are specification requirements, not completed prototype coverage.

## Delivery cut and compatibility

First implementation PR: extract one meal chooser using existing saved and discovery controllers; integrate it into Add Meal with date/slot/servings/return context, translations and same mutation controller. Preserve edit-meal flow, current canonical routes, favorites/collections, bulk recipe linking, API compatibility and existing recovery behavior. No schema migration or provider activation expected; assess before changing either.

Validate the selected journey with an empty household and populated recipe library at phone/tablet/desktop sizes, plus ownership refusal, failure/retry, draft preservation and duplicate prevention. Record real search/import coverage separately. Rollback is UI composition reverting to the existing editor without changing records or API contracts. Today/Calendar production changes follow the same shared patterns after this first slice proves useful.

## Evidence and remaining work

Local prototype checks cover three screen compositions at 390×844, 800×1280 and 1366×768 plus recipe selection → confirmation → grocery review → return. These are simulated interactions only. Screenshots/check receipts live in the sibling `artifacts/connected-workflows-20261102` directory. No production app screenshots, runtime provider success, full accessibility audit, shared-device acceptance or native acceptance are claimed. Broader inventory/role/state studies and live-backend implementation remain open in #499/#460.

## Recipe delivery update and considered ideas — November 2

The first implementation adds inline publisher search and URL preview to the existing meal recipe picker, reusing the owned recipe editor and returning the saved recipe directly to the meal. Search is explicitly labeled with its three supported publishers. Google is currently an external search link; it is **not** a connected Google Search API or Gemini grounding provider. No Google billing/provider switch is activated by this patch. Source presence is not a successful live publisher test.

Before embedded Google discovery: integrate the existing household provider configuration and metered usage broker; verify model eligibility, source/suggestion display and storage terms; review bounded cost and failure policy; validate a real grounded response. Do not turn Gemini grounding into a scraped result database or silently persist its generated text as a publisher recipe. Publisher imports remain separate, explicit reviewed actions. References: https://ai.google.dev/gemini-api/docs/google-search/ and https://ai.google.dev/gemini-api/terms .

Ideas to evaluate within the existing workflow, not as new top-level buttons:

| Idea | Placement and benefit | Evidence / dependency |
|---|---|---|
| Use what we have | Optional ingredient filter in recipe choice; prioritizes food to use soon | Canonical inventory quantities, age and uncertain-unit handling; no automatic dietary claims |
| Family favorites and repeat meals | Saved view, recent selections before a blank search | Reuse existing favorites/collections and meal history, scoped to household |
| Time available | Optional 15/30/60-minute filter beside search | Only use publisher times when present; unknown stays unknown |
| Grocery difference review | Immediately after planning, one review with destination list | Existing grocery write/idempotency plus serving/unit validation |
| Leftovers and next prep | Meal/prep detail, not another home toolbar | Existing batch/portion consumption model and conflict handling |
| Dietary preferences | Optional household preference and query aid | Explicit editable preferences; ingredients require checking; never promise allergen safety |
| Weekly suggestions | Optional planning action inside Meals | Existing grounded food planner and review flow; no automatic scheduling or new cron |

Prioritize search/import/save/reuse and grocery review before adding more recommendation controls. Photos need verified publisher metadata and safe image handling; do not substitute generated pictures for actual recipe images.

Local verification for inline discovery: 15 focused tests pass (new search/import handoff, changed-owner refusal and retry; existing saved picker and Explore localization). Typecheck passes. Scoped ESLint has no errors and one pre-existing ref-cleanup warning in RecipePicker. The real OnlineRecipePicker was rendered in an isolated browser fixture at 390×844, 800×1280 and 1366×768: search → preview passes, no page exceptions or horizontal overflow; phone results and tablet preview were visually inspected. The fixture stubs publisher responses and the final editor, so it does not prove real publisher availability, persistence or authenticated production behavior. No deployment or provider activation occurred.

## Active-goal continuation — discovery continuity

Empty add-meal slots now request the online picker first; existing recipe/edit flows retain their saved selection. Switching between online and saved recipes keeps the mounted search state. After import, the editor resets without discarding the query/results. Cook and notes share an optional Details disclosure. A newly chosen recipe supplies its verified serving count only while the person has not edited servings or supplied a reuse count.

Public-source evidence (local outbound requests, not Cloudflare or authenticated saves): the `vegetable soup` search returned HTTP 200 with 24 links from BBC Good Food; Allrecipes and Serious Eats returned HTTP 403. The first probe exposed collection/navigation links masquerading as recipes. The extractor now excludes collection/category paths, with a regression test. After the fix, `https://www.bbcgoodfood.com/recipes/versatile-veg-soup` returned HTTP 200 and parsed five ingredients, directions and two servings, with no extraction review issues. This is a single-query/source sample, not universal import support.

Remaining goal requirements: complete the task-first editor instead of keeping manual name input competing with discovery; combine recipe save/reuse with planning; carry confirmed meal receipts into grocery review; verify portions/leftovers/reuse, household permissions and authenticated interruption recovery; integrate and meter embedded Google grounding; perform combined responsive application/release acceptance. The goal is active and this checkpoint is not completion or deployment.

## Confirmed-meal grocery handoff and imported ingredient rows

The creation hook now returns the validated meal receipt ID and the exact submitted intent, including during retry recovery. Recipe-backed new meals show a confirmation with Review groceries; the existing review control uses that saved meal ID and recipe ID. No grocery write runs automatically. Pending/unknown grocery operations lock the confirmation's dismissal through the existing pending callback; Back refreshes the meal plan after confirmation. Quick name-only meals retain their normal return to the plan.

A discovered gap in recipe import was also fixed: publisher ingredient lines had only been retained in instruction text. Both inline discovery and Explore now seed actual editable ingredient rows in the existing recipe editor. Explicit decimal/simple/mixed-fraction amounts and recognized units are suggested conservatively; ranges, unknown quantities and package expressions stay verbatim with blank quantities for review. Full original source lines remain in the imported text. No nutritional/allergen inference, inventory deduction or automatic grocery quantity guessing is introduced.

Focused checks cover confirmed receipt handoff (no unsaved draft in the review URL; no automatic grocery write), exact-intent retry, imported editor rows and uncertain quantity preservation. Combined focused run: 120 passing tests. Typecheck passes; scoped lint has no errors and one existing RecipeEditor ref-cleanup warning. Authenticated production, Cloudflare publisher coverage and combined browser journeys remain unverified. The complete goal remains active; next work is consolidating recipe save/reuse with planning without bypassing ingredient review, then completing the task-first editor and provider integration.

## Single-action imported recipe planning

The inline recipe review now ends in Plan meal when opened from an add-meal slot. Only a confirmed recipe save/reuse triggers the existing owned meal-create operation. The selected day/slot, custom meal name, cook, notes and edited portions remain the meal intent; untouched portions inherit the recipe yield. Standalone recipe editing retains Save recipe. Recipe and meal writes remain separate idempotent operations: a lost meal response retries its exact body/key without repeating recipe creation, then opens the confirmed grocery review.

Local evidence: 68 focused tests pass across the meal page, meal recovery and inline discovery suites. The full-component import test covers direct success and a lost meal response, preserving custom name/portions and one recipe POST. Typecheck passes. Scoped ESLint has zero errors and two existing ref-cleanup warnings. These mocked API tests do not establish authenticated server persistence or browser usability. Task-first form consolidation, authenticated/responsive application acceptance and supported/metered embedded Google remain unfinished. No merge, push, deployment or provider activation in this checkpoint.

## Task-first entry consolidation

Add-meal discovery now shares three choices: Saved, Find online and Quick meal. Manual naming and the existing description assistant live in Quick meal rather than ahead of recipe discovery. Switching modes preserves entered quick-meal text and the mounted search/preview state; choosing Quick meal explicitly removes a recipe link. Linked-recipe names and existing meal edits remain editable. The selected date/slot stays visible in a compact Change disclosure (expanded initially for editing).

Local evidence: 78 focused tests pass, including a visibility-aware empty-slot → Quick meal → save journey and preserved date. Typecheck passes; scoped lint has no errors and one existing RecipePicker cleanup warning. An isolated browser rendering of the real RecipePicker passes search → preview → Quick meal → preview → Back to search at 390×844, 800×1280 and 1366×768, retaining both search and manual text with no page exceptions or horizontal overflow. Phone screenshot reviewed; shortened Saved text keeps the three choices on one row. This fixture stubs recipe creation and API data; it is not the complete modal, authenticated persistence, installed-device acceptance or production evidence. Fixture artifacts: `artifacts/connected-workflows-20261102/task-first-browser.json` and `task-first-*-results.png`/`task-first-*-preview.png` in the adjacent local workspace. The initial bundled headless browser stalled during launch; the successful run used installed Chrome. Embedded Google, full application acceptance and release preparation remain open.
