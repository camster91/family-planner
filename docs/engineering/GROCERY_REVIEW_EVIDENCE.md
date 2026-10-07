# Recipe-to-grocery review evidence

## Candidate and source audit

Isolated `feat/grocery-review` worktree at `C:/Users/camst/DesignStudio/family-planner-groceries`, based on fetched `origin/main` `4909b4b161120f11f573af834b65bec28d91c141`. No commits, pushes, deployments, servers, browser sessions, schema changes or edits to the meals/calendar worktrees.

Source inspected before implementation:

- `src/components/meals/AddToGroceriesButton.tsx`: previously wrote on the first click. Kept an idempotency key but reconstructed the request from live props on retries, allowing a body/key mismatch.
- `src/lib/add-to-groceries-client.ts`: existing retry classification, in-progress retries, add/Undo reports and absolute Undo expiry. Automatic retries previously reserialized the live request object.
- `src/app/api/lists/items/from-recipe/route.ts` and `src/lib/grocery-from-recipe.ts`: canonical strict request is `{recipeId, mealId?, listId?, servings?, ingredientIds?}`. Explicit servings are 1–50; omitted servings retain saved meal/recipe fallback, including saved 100-serving meals. Ingredient ids are validated against owned recipe ingredients. Default list creation happens inside the commit transaction only.
- `src/lib/grocery-from-recipe.ts`: source/open partial-index deduplication, already-on-list and possible-duplicate reports; actor-owned Undo within 10 minutes removes only that request's new unchecked rows. These server mutation contracts were not changed.
- `src/lib/inventory.ts`: `loadCookInventory`, `indexCookInventory`, `matchRecipeIngredients` are the canonical presence-only comparison. The ranked cook suggestions omit zero-stock recipes, so they cannot supply review hints for arbitrary direct recipe requests.
- Existing meal, recipe detail and inventory call sites already use the shared button; no parallel write path or caller migration was introduced.

## Implementation

- New read-only `GET /api/lists/items/from-recipe/review?recipeId=…&mealId=…` returns owned canonical ingredient names/amounts/units, saved serving fallback, eligible destinations, and optional inventory presence hints. Requires person authentication, parent/teen/child role, meals and lists features; refuses paired devices. Recipe/meal/list/inventory queries are household scoped. Direct recipe lookup includes recipes with no stock. Inventory disabled or unavailable is explicitly unknown, not "missing". Capped inventory comparisons report incompleteness.
- Dialog uses the existing accessible `Dialog` primitive. Selection and destination are editable; empty recipes/selections cannot commit. Cancel/close only discard review UI, never create lists or items.
- Submitted payload and key are retained together across ambiguous failures. Prop changes cannot change a retry body. Automatic in-progress retries serialize once. Unreadable/incomplete successful responses remain ambiguous and retry the original intent rather than silently creating another. No force-reapply/new-intent button is offered while unresolved. After a definite response, another reviewed add uses a new key.
- Duplicate reporting and Undo remain on the existing client/server path.

## TDD evidence

Observed separate RED → GREEN cycles with focused Jest commands:

- Route review: missing route module → read-only review pass.
- Direct zero-stock coverage: expected available/empty presence, received unavailable → canonical comparison pass.
- Saved meal fallback: expected 100, received recipe default 4 → owned meal lookup pass.
- Review-first UI: missing dialog and observed immediate mutation → dialog/cancel-zero-write pass.
- Empty selection: commit was enabled → disabled commit pass.
- Frozen retry: received recipe-b/meal-b/servings 2 under the original key instead of recipe-a/meal-a/servings 8 → exact body/key pass.
- Presence hints: missing presence labels → honest presence/incomplete-scan copy pass.
- Reviewed intent: live prop update changed visible amount from 800 g to 200 g → review snapshot pass.
- Automatic retries: request mutation changed serialized body → serialize-once pass.
- Unreadable successful response: classified as final error → retry-original-intent pass.
- Ambiguous result guidance, empty-recipe explanation, unavailable destination refusal, destination bounds and cap notice each failed before its implementation and then passed.

Additional regression tests cover fresh keys after definite responses, destination editing, saved 100-serving fallback without an invalid explicit override, checked-item Undo reporting, household isolation, normalized unlinked inventory matching, feature gates, paired-device refusal and no default-list creation on review.

## Verification commands and limits

Run sequentially from this worktree using existing cached dependencies through a node_modules junction. No installs, dependency generation or lockfile changes.

```bash
node node_modules/jest/bin/jest.js --runInBand src/app/api/lists/__tests__/from-recipe.test.ts src/app/api/lists/__tests__/grocery-review.test.ts src/components/meals/__tests__/grocery-review.test.tsx src/lib/__tests__/add-to-groceries-client.test.ts
node node_modules/typescript/bin/tsc --noEmit --incremental false
node node_modules/eslint/bin/eslint.js src/components/meals/AddToGroceriesButton.tsx src/components/meals/__tests__/grocery-review.test.tsx src/lib/add-to-groceries-client.ts src/lib/__tests__/add-to-groceries-client.test.ts src/app/api/lists/items/from-recipe/review/route.ts src/app/api/lists/__tests__/grocery-review.test.ts
git diff --check
```

Final observed results: **4 suites / 44 tests passed**; TypeScript full-project no-emit check, focused ESLint, and `git diff --check` all exited 0. Git emitted only its existing LF-to-CRLF working-copy notices. The initial typecheck caught a test fixture's inferred optional `mealId` incompatible with the request helper's string-only query map; the fixture annotation was corrected and the final check passed.

Jest route tests use the repository's two-household fake; component tests mock HTTP. These are real executions of the route/component/client code, not Postgres, browser-layout or live-API evidence. Full build, full test suite, live database concurrency, browser/reflow and Android process-death checks are intentionally deferred to parent review/CI under the resource limits.

Pending intents remain in component memory (not an offline queue or process-death persistence feature). Destination choices are bounded to 100, grocery-first then latest updated/id, with an explicit truncation notice; a caller-supplied destination outside the returned choices fails closed. Recipe and inventory may change between read-only review and commit; the canonical mutation continues to revalidate current household ownership and apply saved-serving fallback on commit.

## Nested-dialog blocker follow-up

- Actual canonical `Dialog` nesting in StrictMode reproduced both blockers before the fix: forward Tab from review Cancel focused the outer Close, and Escape removed the meal dialog as well as review. All three forward/backward Tab/Escape cases now pass, including review reopen, restored grocery trigger, resumed outer trap and restored meal opener.
- The shared Dialog now gives keyboard ownership only to the topmost registered panel. Ancestors register below children even when child effects run first. Cleanup removes exact registrations/listeners, propagates ancestor openers on simultaneous removal, and restores focus to the surviving modal or original opener. A non-dismissible topmost child absorbs Escape instead of dismissing its ancestor. Accessibility semantics and single-dialog focus handling remain enabled.
- Additional lifecycle RED cases exposed focus falling to body when an initially-open nested child closed and when both ancestor/child were removed. The lifecycle fixes passed those cases under StrictMode; the non-dismissible-child regression also passes.
- Bounded runtime review parsing rejects malformed/unrenderable nested JSON, oversized ingredient/list collections, invalid saved servings and mismatched recipe ids before rendering. Invalid explicit servings (non-integer, non-finite or outside 1–50) failed before validation and now show an error without any mutation or silent clamp. Valid explicit 1/50 boundaries and saved recipe 1/100 fallbacks are covered; omitted saved overrides remain omitted from the submitted payload.
- The newer meal `disabled` prop is integrated without merging main or editing the meal worktree: disabled prevents review/new commits (including an already-open review) while Undo remains enabled. Its regression was RED before the compatible prop/guards and GREEN afterward.
- Added existing-contract regressions for `Cache-Control: private, no-store` and foreign ingredients linked to an owned recipe, including exclusion from inventory hints. The route already satisfied these assertions and needed no production change.

Follow-up verification ran sequentially, without servers, installs, commits or remote writes:

```bash
node node_modules/jest/bin/jest.js --runInBand --runTestsByPath src/components/ui/__tests__/dialog.test.tsx src/components/meals/__tests__/grocery-review.test.tsx src/app/api/lists/__tests__/grocery-review.test.ts src/app/api/lists/__tests__/from-recipe.test.ts src/lib/__tests__/add-to-groceries-client.test.ts src/app/dashboard/__tests__/form-dialog-a11y.test.tsx src/components/account/__tests__/delete-account-dialog.test.tsx src/app/dashboard/meals/__tests__/meals-page.test.tsx
node node_modules/typescript/bin/tsc --noEmit --incremental false
node node_modules/eslint/bin/eslint.js src/components/ui/dialog.tsx src/components/ui/__tests__/dialog.test.tsx src/components/meals/AddToGroceriesButton.tsx src/components/meals/__tests__/grocery-review.test.tsx src/app/api/lists/__tests__/grocery-review.test.ts
git diff --check
```

Results: **8 suites / 108 tests passed**; full-project typecheck, focused ESLint and whitespace check exited 0. The existing emergency-page a11y fixture logged React warnings for styled-jsx `jsx`/`global` attributes; no assertions failed. The nested keyboard tests exercise real rendered components and document listeners with mocked HTTP; their narrowly scoped jsdom `offsetParent` override substitutes only missing layout visibility. They are not real-browser geometry or live API/Postgres evidence.
