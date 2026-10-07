# Weekly meal-planning controls: implementation evidence

## Source baseline and scope

- Based on fetched `origin/main` at `4909b4b161120f11f573af834b65bec28d91c141`, not the earlier `f3fa529` audit checkout.
- Worktree: `family-planner-meals`; branch: `feat/meal-planning-controls`.
- UI-only additions to the canonical meals page and its existing editor. No API/schema/role changes, new write endpoints, or offline/idempotency changes.
- Source contracts checked: `src/app/api/meals/{route.ts,[id]/route.ts}`, `src/app/api/family/members/route.ts`, `src/lib/{meal-slots,dates,kid-access}.ts` and ADR-0007 documentation.
- The current source admits teens to meals (`TEEN_EXTRA_PREFIXES`); the older Meals and Groceries document's parent-only UI statement is historical, not the current role contract. This slice leaves those rules unchanged.

## Behaviour

- Optional URL `start=YYYY-MM-DD` selects exactly seven viewer-local calendar days. Previous/next move by seven calendar days; Current week removes `start` while retaining unrelated URL parameters.
- The default remains the existing rolling week (today plus six days), not a new Monday/Sunday boundary. The heading gives an explicit localized inclusive date range.
- Fetches use `GET /api/meals?start=...&end=...`, with inclusive start/exclusive end, always seven days (inside the existing 62-day API maximum).
- Calendar anchors are constructed locally from date components. Navigation uses calendar arithmetic, not UTC parsing or fixed millisecond durations. Both start and exclusive end must pass the canonical API date-only parser. Unsupported URL weeks show an explicit recovery state instead of silently falling back to today; unsupported previous/next navigation is disabled.
- Only the actual viewer-local day is labelled Today, even when it is not the first displayed day. Mutation completion and retained Undo callbacks refresh the currently selected week. Request-version and window-identity guards stop late responses from replacing it.
- Header Add Meal defaults to the selected window start; slot add controls retain the selected day and meal type.
- Cook choices come from the existing household-scoped members endpoint. Loading/error disables only the selector; an unavailable/current assignment is preserved and unchanged fields are omitted on PATCH.
- Servings are optional, integer 1–100. Blank add omits the field; unchanged edit omits it; clearing an existing value sends null. Cook changes follow the same omitted-versus-null rule.
- Multiple meals per slot, snacks, free-text names, recipe snapshot/unlink semantics, notes clearing, undo and feature gating remain on their existing paths. Grocery adds are disabled with an explanation while servings differ from the saved meal; reverting the draft restores the action, and existing grocery Undo remains available. No servings are silently clamped.
- Controls reuse Herewoven semantic input/button tokens and explicit 44px minimum targets. The existing stacked meal-day composition is preserved; no wider tablet layout redesign is claimed here.

## TDD evidence

Observed failing tests before their production changes, followed by passing reruns:

1. URL-backed navigation: existing page fetched the current week instead of the requested URL window.
2. Today identification: an unrelated browsed week's first day was incorrectly marked Today.
3. Household cook: no household cook option existed in the editor.
4. Servings: no labelled servings input existed in the editor.
5. Request ordering: a deferred previous-window response removed the selected week's meal.

Additional regression coverage checks null clearing versus omission, unchanged linked recipe/snapshot/notes, second-row editing, snack creation, servings bounds, household-members failure, invalid URL dates, year rollover and both DST transition dates.

## Executed gates

All commands ran sequentially under Node 22.23.3, without a preview server, dependency install, build, commit, push or deployment. Installed dependencies were reused through a local untracked `node_modules` directory symlink to the calendar worktree; Jest ran without cache and TypeScript without incremental writes.

```bash
TZ=America/Toronto node node_modules/jest/bin/jest.js --runInBand --no-cache --runTestsByPath \
  src/app/dashboard/meals/__tests__/meals-page.test.tsx \
  src/lib/__tests__/meal-slots.test.ts \
  src/lib/__tests__/display-locale.test.tsx \
  src/app/api/meals/__tests__/isolation.test.ts \
  src/app/api/meals/__tests__/recipe-link.test.ts \
  src/components/meals/__tests__/recipe-components.test.tsx
node node_modules/typescript/bin/tsc --noEmit --incremental false
node node_modules/eslint/bin/eslint.js \
  src/app/dashboard/meals/page.tsx \
  src/app/dashboard/meals/__tests__/meals-page.test.tsx \
  src/lib/meal-slots.ts \
  src/lib/__tests__/meal-slots.test.ts \
  src/lib/__tests__/display-locale.test.tsx
git diff --check
```

Results: **6 suites / 64 tests passed**; typecheck, focused lint and whitespace checks exited 0 with no diagnostics. A separate `Pacific/Kiritimati` run of the page, slots and display-locale suites passed **3 suites / 44 tests**. That run initially exposed an older locale fixture assuming the anchor was always Today; it now freezes its clock to the fixture's day.

## Independent-review fixes

Observed RED then GREEN for deferred save/delete/Undo refreshing the original week (3 cases), unsupported complete-week URL/boundary navigation (6 cases), and unsaved-servings grocery protection (2 cases). The retained Undo regression clicks Undo only after navigation, defers its completion, and releases an older selected-window request after the refreshed data has loaded.

Follow-up commands ran sequentially, without servers, installs, builds, commits or remote actions:

```bash
npm test -- --runInBand --runTestsByPath src/app/dashboard/meals/__tests__/meals-page.test.tsx src/lib/__tests__/meal-slots.test.ts src/lib/__tests__/display-locale.test.tsx src/lib/__tests__/add-to-groceries-client.test.ts
npm run typecheck
npm test -- --runInBand --runTestsByPath src/app/api/meals/__tests__/isolation.test.ts src/app/api/meals/__tests__/recipe-link.test.ts src/components/meals/__tests__/recipe-components.test.tsx
git diff --check
```

Results: first group **4 suites / 62 tests passed**, typecheck exited 0, second group **3 suites / 20 tests passed**, whitespace check exited 0. The API, canonical/shared calendar date helpers, authorization and servings ranges were not changed.

## Remaining release evidence

Parent-owned full gates and browser responsive/accessibility review are not run or claimed. No real household/private data was read or written. Groceries review, recipe editing and routines are outside this slice.
