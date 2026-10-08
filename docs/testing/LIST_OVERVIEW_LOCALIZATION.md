# List overview localization (#411 / #142)

`ListsClient` uses the existing device EN/ES provider through the typed `listOverview` namespace. Matching dictionaries in `src/i18n/list-overview.ts` contain complete per-type headings, filter notices and empty/create sentences. They avoid English-specific lowercasing, fragment joining and suffix plurals. `Intl.PluralRules(locale)` selects one/other count templates for the supported English/Spanish locales; canonical integer counts stay unchanged. Zero-count badges remain hidden as before.

Household/list/creator names and checked/total values are rendered verbatim. Locale rendering does not change the mounted filter state, `?type=` enum, route/creation href, household query or permission checks. Existing legacy meal-plan lists remain readable. New meal-plan creation remains unavailable exactly as before; the overview's top add link keeps its original generic creation target for that filter. Child roles retain no create action.

The existing English type-filter, redirect and household-scope tests use the real English provider and retain their original assertions. Added regressions change locale while a filter is mounted, verify exact navigation and household names containing interpolation-like braces/emoji, singular/plural labels, and legacy/child empty restrictions.

`e2e/list-overview-localization.spec.ts` covers normal EN/ES overview, filtered grocery, empty wishlist and parent/child legacy meal-plan empty states at phone 390x844, portrait 800x1280 and fridge 1280x800. It writes and removes only an isolated fabricated grocery list. Scoped accessibility, keyboard focus, 44px filter/primary actions and horizontal bounds are asserted. Screenshots are saved per actual source/runtime; this coverage definition is not a claim that a future run passed.

```sh
npx playwright test e2e/list-overview-localization.spec.ts --project=phone-390x844 --project=tablet-portrait-800x1280 --project=fridge-landscape-1280x800
```

Use the isolated environment in `E2E.md`. Expanded-copy QA requires both explicit build/server flags in `PSEUDOLOCALE.md`; keep ordinary captures before output cleanup, use saved normal fixture auth for expanded runs with `--no-deps`, then restore a flags-off build. Run full unit checks with the documented host-compatible GNU date environment for the backup scripts; retain real failures and their diagnosis.

Exactly the migrated direct-copy inventory records are removed. Create/detail pages, shared headings, fallback names and indirect copy remain parent #142 migration debt. No API/schema/native/provider/production change or whole-app Spanish/human-language acceptance is implied. Revert this scoped component/dictionary change to restore English overview copy without a data migration.
