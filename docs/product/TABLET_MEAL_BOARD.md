# Tablet weekly dinner board

## Scope and design

Operate is the primary surface: choose/edit meals, not a marketing hero. This is a presentation change to `/dashboard/meals` on base `ddca2fec9b8b503f37e196567a6daeef41580027` (recipe editor merge), isolated in `feat/tablet-meal-board`.

- Reuse the existing `buildDayPlans` → `DayPlan` → canonical `FamilyMeal` flow. No schema, API, permission, household or second planning model changes.
- Dinner is always first, including every dinner in canonical order. Other slots are behind an independent, dated disclosure per day.
- Phone below 700px: compact one-column days. Tablet 700–1599px: four columns, then three. Wide screens from 1600px: seven columns. The existing dashboard shell still caps content width.
- All primary card buttons retain at least 44×44 CSS px. Tablet dinner titles increase to 18px rather than shrinking controls or text to fit seven narrow columns.
- Titles use `overflow-wrap:anywhere`, without truncation, fake overflow counts, fixed card heights or hidden dinners. Extreme content and opened other slots expand naturally; only the short-content closed overview is a one-screen fit claim.
- The date remains visible beside Today. The seven-day URL anchor, inclusive/exclusive request bounds, DST logic, loading/error/retry and empty slots are unchanged.
- Use existing Herewoven semantic colors and global Fraunces/Inter setup. Dense meal labels and titles use Inter; the page heading retains Fraunces. Decorative meal glyph circles were removed to give actual titles room.

## Editable reference

Open `design/tablet-meal-board.html` directly from the checkout. It uses the production board stylesheet, exact light/dark semantic color values and an editable embedded JSON fixture with a description. Controls exercise other meals, empty week, long text, week navigation, night mode and a clearly labelled reference-only detail dialog. They never call APIs or save household records.

The JSON is explicitly synthetic. Fonts in this portable reference use locally installed Fraunces/Inter or serif/sans fallbacks; production still uses its unchanged self-hosted Next font setup. No screenshot-as-UI, paid generation, assets upload or Figma approval is claimed.

## Acceptance/source evidence

| Criterion | Source/evidence |
| --- | --- |
| Whole seven-day dinner-first overview | `src/app/dashboard/meals/page.tsx`: existing seven `week.map` DayCards; each renders only dinner before disclosure. `meals-board.module.css`: 1/4/7-column responsive rules. |
| Accessible, independent other-slot disclosure | Real button with date-specific accessible name, `aria-expanded`, `aria-controls`, hidden target; dated UI state belongs to the page so canonical reloads cannot collapse an opened day. DOM tests cover Enter, open/close, independence, deferred reload and zero writes. |
| Multiple dinners and snacks are not lost | Render each canonical slot array in order; one contextual add-another button per occupied slot. Existing second-dinner edit/delete/Undo tests remain; new multiple-snack test checks canonical IDs and contextual editor date/type. |
| Cook, 1–100 servings, notes, recipes, groceries and pending guards | MealModal, mutation handlers, RecipePicker and AddToGroceriesButton are unchanged. Existing assertions still cover raw bodies, servings limits, snapshot/unlink behavior, nested mutation ownership, grocery review/refreeze/retry/Undo and focus return. |
| Phone reflow and long text | Source-rendered real DayCards + compiled production globals/CSS in local Chromium, no server. All visible card targets >=44×44; no horizontal overflow at 390px and 800px, including long unbroken text. |
| Truthful dates/navigation/state | DOM test added for visible Today date; existing URL/week-boundary/DST/stale-response/retry/empty tests pass. No loading/error flow removed. |

## Executed checks

Strict behavior RED→GREEN was observed before each change:

1. Dinner-first/disclosure: failed because the snack appeared among initial dinner rows; passed after dinner-first disclosure implementation.
2. Per-day accessible name/canonical non-dinner count: failed because the disclosure lacked its date; passed after the date-specific accessible name. The same test checks two snacks, both IDs, Enter activation and canonical add/edit context without writes.
3. Visible Today date: failed with `TodayToday`; passed after using canonical `day.longLabel`.

Existing non-dinner tests now open the disclosure through the user path. Their payload, focus, validation and recovery assertions are not removed or weakened. The existing recipe metadata wording was preserved after the full suite exposed that expectation.

Commands run sequentially, with the existing calendar worktree's dependencies linked into this isolated checkout (no installation):

```text
node node_modules/jest/bin/jest.js --runInBand --runTestsByPath
  src/app/dashboard/meals/__tests__/meals-page.test.tsx
  src/lib/__tests__/meal-slots.test.ts
  src/components/meals/__tests__/grocery-review.test.tsx
  src/components/meals/__tests__/recipe-components.test.tsx
  src/components/meals/__tests__/recipe-editor.test.tsx
  src/components/meals/__tests__/recipe-edit.test.tsx
```

Result: **6 suites / 159 tests passed**. Meal-page suite includes 54 tests.

```text
node node_modules/typescript/bin/tsc --noEmit --incremental false
node node_modules/eslint/bin/eslint.js src/app/dashboard/meals/page.tsx src/app/dashboard/meals/__tests__/meals-page.test.tsx e2e/meals.spec.ts
git diff --check
```

All exited 0. Git only reported its configured LF→CRLF normalization notices.

### Serverless rendered layout evidence

A scratch script transpiled the actual page, exposed the existing private DayCard only in memory, rendered it with ReactDOMServer and `buildDayPlans`, and used freshly compiled production Tailwind/global CSS plus the actual board CSS. Cached real Fraunces/Inter font files were read from the recipe worktree and embedded in the temporary fixture; no other worktree was changed. The surrounding shell/header is a representative fixture, not the actual authenticated dashboard.

Local Chromium exercised seven source-rendered viewport/state combinations: 390×844, 800×1280, 1280×800, 1920×1200, landscape dark, portrait long text and phone long text. All seven day elements were present, all card buttons were >=44×44, and no horizontal overflow or page errors occurred.

- 800px portrait: four columns, final short-content card bottom **761.5px**.
- 1280×800 landscape: 4+3 overview, final short-content card bottom **711.125px**; dark matched.
- 1920px wide: seven columns, final card bottom **559.9375px**.
- Long text expands vertically and remains fully wrapped; it is intentionally not a seven-days-without-scroll claim.
- Editable reference opened without page errors; keyboard Enter disclosed both synthetic snacks.

Scratch artifacts under `C:/Users/camst/AppData/Local/hermes/cache/scratch/`:
`meal-board-source-render.cjs`, `meal-board-geometry.cjs`, `meal-board-geometry.json`, `meal-board-*-source*.png`, `meal-board-reference.png` and source-rendered HTML fixtures. Scratch artifacts may expire after 24h; the repository reference/spec remain editable.

## Remaining review/release gates

The initial source-only pass did not run a server or authenticated browser. The final local authenticated browser pass below supersedes that limitation. No production build, full repository suite/lint, Android gate, deployment or remote write was run by this verification task. Local Chromium/dev-server evidence is not a production or Android-device verification claim.

`e2e/meals.spec.ts` keeps all existing behavioral assertions, adds the disclosure step to its breakfast/lunch/snack flows and a persisted, populated four-size overview/keyboard-disclosure gate. It was executed against the guarded canonical fixture database in the final pass below. No snapshot baselines were updated. No commit, push, merge or release was performed.

Composition self-audit: 0/10 generic-design tells. The repeating cells are the actual seven canonical planning days, not feature tiles; no hero, gradients, decoration metrics, icon toppers or new palette. Inter is the explicitly approved operational brand font, not an invented default.

## Final actual authenticated browser verification

- One owned Next development preview on `127.0.0.1:3237`, using only the guarded local `127.0.0.1:55439/family_planner_rebrand_dev` database. Existing canonical fixture accounts signed in through the real auth API; no seed/reset or alternate household model. Server provider keys were removed and external socket/fetch calls blocked. The private browser harness also refused external browser requests.
- Next's font test hook read the already-cached real Fraunces/Inter CSS and WOFF2 assets from the recipe worktree, read-only, to avoid Google downloads. Actual root layout, authenticated dashboard shell, production component/CSS, hydration, APIs and database were exercised; no handwritten replacement UI or fake successful API responses. Browser geometry guarded loaded fonts and real computed paints.
- A concrete regression reproduced in three canonical journeys: saving a non-dinner unmounted DayCards during the reload, losing their local disclosure state and hiding the saved row. A new deferred-reload DOM regression failed with `aria-expanded=false` before the fix. Lifting only dated disclosure preferences to the page made the test and live add/edit/delete/Undo journeys pass; API, pending guards and data models are unchanged.
- Final focused canonical run: **39 passed** — three authenticated setup checks and nine meal journeys at each of 390×844, 800×1280, 1280×800 and 1920×1200. This includes populated density, disclosure, free-text add/edit/delete/Undo, linked recipe/detail, inline recipe creation, multiple dinners/long title, grocery provenance, loading/error/retry and child refusal. The canonical error test injects explicit 500/404 failures, not successful fake data.
- Private actual-browser integration harness: **18 checks passed**, zero page errors. Eight short-content light/dark density captures and eight long/open-disclosure reflow captures cover the four sizes. Real persisted multiple dinners, breakfast, lunch and two snacks retain their IDs and order; contextual add/edit preserves date/type and saves cook, servings and notes with canonical GET readback. Short dinner overviews fit all tablet/wide sizes; long/open content scrolls without title truncation or horizontal overflow.
- Real held GET loading, aborted-network error and retry are captured separately. Inline/detail recipe edits and nested grocery review were checked for keyboard trapping, topmost Escape, focus return, zero-write cancellation, duplicate/pending ownership, scaled canonical grocery write and Undo. **Nine actual editor/review axe scans had zero violations**; all measured board buttons remained ≥44×44.
- Final focused source checks: **6 suites / 160 tests passed**, typecheck and scoped ESLint exited 0; `git diff --check` passed. These include the existing recipe/grocery/pending suites, not only the new disclosure test.
- Canonical before/after snapshots of `FamilyMeal`, `Recipe`, `Ingredient`, `RecipeIngredient`, `List`, `ListItem` and `IdempotencyRecord` were byte-identical after the final canonical run. Private harness records were cleaned by exact returned IDs and read back absent, with a full unchanged preexisting canonical snapshot. Final counts: 2 meals, 3 recipes, 3 ingredients, 4 recipe joins, 7 lists, 22 list items, 1 idempotency record.
- Inspected actual 1280 light, 800 dark, 390 light, 1920 dark and 800 long screenshots; no clipped titles or layout regression. No blind visual baseline update. The dev indicator is present in these development captures.
- Initial launcher attempts exposed the Windows shell shim's `stdin is not a tty` and Next's merging of duplicate `--require` options. The private launcher uses the pinned native Node executable and one aggregate preload. A cold dev/HMR navigation timed out on one repeat after formatting; the unchanged warm repeat passed all 39 tests. No production fix or weakened assertion was introduced for that environment transient.
- Owned preview and both Node descendants were stopped; port 3237 was read back free. No normal application or the existing fixture database was stopped.

Durable private evidence: `C:/Users/camst/DesignStudio/family-planner-rebrand-evidence/tablet-meal-board/`, including canonical JSON/logs, RED/GREEN logs, source hashes, 28 final screenshots, geometry/axe/API records, exact cleanup receipts and stopped-preview receipt. Credentials remain in the existing private environment wrapper and are not copied into the repository or evidence reports.
