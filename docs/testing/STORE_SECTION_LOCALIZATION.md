# Store-section controls (#415 / #142)

This slice externalizes the existing section headings, move trigger/dialog/current/automatic controls, and sort switch/state/hints. `store-section-messages.ts` has 26 matching typed EN/ES keys with context notes; `store-sections.ts` supplies the typed route-owned hook. Section keys remain the canonical `GrocerySectionId` values. The dependency-free default English labels, keyword classifier, grouping, walking order, overrides and server consumers in `src/lib/grocery-sections.ts` retain their original behavior. Household names and item text are inserted verbatim.

The existing provider accepts an optional third `t` argument containing a route-owned dictionary. The provider does not import this dictionary into root startup. Existing two-argument/root-key calls, saved per-device language, `<html lang>`, supported public locales and QA flags remain unchanged. Scoped templates use the same lookup, missing-key fallback, pseudolocalization-before-interpolation and single-pass placeholder rules. Without a provider, existing root keys still fall back to the key; an explicitly supplied scoped dictionary uses English. This is additive presentation capability, not a new locale, external translation service or storage contract.

English output and classes are preserved. The child still gets a complete read-only sort-state sentence, with no sorting switch. All ten move choices return their original section ID; automatic choice returns `null`. Current/chosen/pending state stays mounted on locale change. The close label is localized while the original dialog owns focus, Escape, and pending non-dismissal. The locale never enters the persisted section preference, item-name classifier or API payload.

Applicable verification:

```bash
npm test -- --runInBand --runTestsByPath \
  src/i18n/__tests__/scoped-messages.test.tsx \
  src/i18n/__tests__/store-section-keys.test.ts \
  'src/app/dashboard/lists/[listId]/__tests__/move-section-localization.test.tsx' \
  'src/app/dashboard/lists/[listId]/__tests__/store-sections.test.tsx' \
  src/i18n/__tests__/pseudo.test.tsx \
  src/i18n/__tests__/translation-keys.test.ts \
  src/lib/__tests__/grocery-sections.test.ts
npx playwright test e2e/aisles.spec.ts e2e/store-section-localization.spec.ts e2e/initial-js-budget.spec.ts
node scripts/ui-copy.cjs
```

Use the fixture database and production-build prerequisites in [E2E.md](E2E.md). The scoped spec owns only its fabricated list/item/preference, removes them after each case, and uses the fixture-target guard. Parent/child EN/ES sort-on, current/chosen, pending, error and automatic-choice states run at phone, portrait and fridge sizes; parent sort-off is also captured. Checks include focus, 44px buttons, center hit testing, scoped accessibility and document overflow. Existing aisle classification, ingredient grouping, persisted move/sort, offline tick, child permissions and cross-household negative cases remain separate unchanged assertions.

Expanded-copy QA requires both existing explicit flags at build/server time. It expands templates before inserting household text and uses the same declared real locales. Keep ordinary and expanded runtime source, build identity, results and screenshots separate, then restore a normal flags-off build. The unchanged core JavaScript budgets must also pass; the route dictionary must not be made an eager global namespace to simplify tests.

The original caller's mutation/offline/sync errors and other list-detail copy remain explicit #142 debt. An injected 503 still shows the existing generic English move error; no arbitrary server text is silently translated. These controls do not establish whole-component/app Spanish, critical human-copy review, store language claims, native/device or household acceptance. Revert the scoped dictionary/provider/component changes without a data migration; no API/schema/provider/production configuration changes are included. Exact-head hosted checks and protected normal merge remain required before issue closure.
