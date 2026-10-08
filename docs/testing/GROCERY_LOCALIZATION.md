# Grocery control localization (#409 / #142)

The existing personal grocery add, online grocery edit, shared-device grocery add, and saved-tick recovery controls use the `groceries` namespace. `src/i18n/grocery-controls.ts` defines stable English templates and a Spanish dictionary with the exact same typed keys. Existing English wording is retained; this does not establish whole-app Spanish support or replace critical human-language review under #142.

## Meaning and data boundaries

- `confirmed` and `deviceConfirmed` require the original queue confirmation event. Queued/page-only messages must never claim server confirmation.
- `editUncertain` means the response could not be confirmed. The editor freezes and reuses the original body, version and idempotency key; changing language must not regenerate them.
- `unsafe`, `deviceUnsafe`, missing/conflict and removal messages preserve the warning to check canonical lists before recreating an item. Removing a local retry does not undo an earlier server write.
- `tick*` copy describes the current browser's saved check/uncheck retry. It does not store or reveal item names. Discard remains an explicit confirmation for the selected operation.
- `actorExpired` requires choosing the acting member again; translation does not change attribution or authorize a write.
- Notice/error state stores typed presentation keys. Subscribers remain tied to the original user/list/device and generation, not the translator callback. Current-locale rendering updates existing notices without resubscribing or resetting a draft.
- Household item/list names, counts, canonical timestamps, actor IDs, operation codes and queue/API formats remain unchanged. Tick dates use the selected display locale with the existing browser timezone. Interpolation happens after QA template expansion, preserving braces, numbers and emoji in household text.
- Dialogs pass the localized accessible `closeLabel`; other dialog callers keep the existing English default. That default and other indirect copy remain parent migration debt.

## Regression evidence

Affected unit fixtures use the real English provider, preserving the original English queue, authorization, expiry, conflict and exact-retry assertions. Added regressions change locale while a draft/add, confirmed notice, uncertain edit or discard dialog stays mounted. They assert unchanged payload/key/attribution, draft and selected tick, and semantic Refresh list availability.

`e2e/grocery-localization.spec.ts` and the added localization cases in `e2e/device.spec.ts` cover English/Spanish personal queued add, uncertain edit, saved-tick recovery/discard and shared-device add/queued states at 390x844, 800x1280 and 1280x800. Checks retain 44px controls, keyboard focus, page/control overflow and scoped axe assertions. Only isolated fabricated fixtures are written. Next streaming buffers can hold hidden markup outside the displayed main; row assertions scope to the displayed main and still require exactly one current row and the original queued state. The unsent-draft readiness check proves hydration before a test goes offline.

Run with the documented isolated E2E environment in `E2E.md`:

```sh
npx playwright test e2e/grocery-localization.spec.ts e2e/device.spec.ts --grep 'grocery localization' --project=phone-390x844 --project=tablet-portrait-800x1280 --project=fridge-landscape-1280x800
```

For expanded-copy QA, both `I18N_PSEUDO_ENABLED=1` and `DESIGN_GALLERY_ENABLED=1` are required at build and server startup; see `PSEUDOLOCALE.md`. Preserve normal captures before Playwright clears its output directory. Reuse previously created fixture auth with `--no-deps` for expanded UI runs; do not change login assertions or real locale/storage values. Restore a normal flags-off build afterward. Record actual source/runtime, commands and results in the PR; this document defines coverage, not an assertion that future runs passed.

The direct-copy inventory removes only migrated records. List overview/detail, shared-board headings and other domains retain their existing parent #142 scope. No API/schema/native/provider/production change or whole #128/#135/#139/#142 completion is implied. Rollback reverts the scoped control/dictionary changes without a data migration.
