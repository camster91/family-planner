# Shared navigation and offline presentation localization (#426)

Existing dashboard navigation, phone tabs, user-menu controls and role labels, the owned child notification-dialog shell, and shared offline/recovery presentation use typed EN/ES keys. Stable canonical hrefs map tab labels; pure navigation defaults, feature/role policy, private names and brand parameters remain compatible. No API, schema, permission, network listener, queue, polling, timer, storage or native contract changes.

## State and regression evidence

Meaningful mounted checks preserve route/hrefs, role/feature visibility, open menus/dialogs, private identity, keyboard focus, pending sign-out and the original three-second recovery deadline across locale changes and network flaps without extra requests, logout, queue deletion or navigation. Child dialog close copy localizes through its existing optional prop. Legacy English banner exports remain exact. Dictionary tests cover all exported parent/teen/child tab arrays, placeholders and prototype/unknown href fallback.

Initial four untranslated regressions fail before implementation. Review found the existing sign-out target was42.5px high; its minimum height is now44px. Expanded portrait runs exposed overflow/clipped avatar controls; narrower tablet spacing and wrapped labels preserve controls. This introduced a short Spanish Hoy width42.71875, repaired with an explicit44px minimum. Source review then found fridge hiding relied on English navigation aria-label. Actual regression passes all three English cases/fails all three Spanish cases; a stable data-dashboard-navigation hook preserves hiding across languages. Long private names pass without changing or truncating stored text.

Earlier failed browser stages, source/harness backups and logs remain in426-* task evidence. One harness used a Playwright focus matcher in Jest and was corrected to Jest DOM. A paused browser-clock attempt stalled Axe and was interrupted through the inspected owned CLI; flowing clock restored without timeout waiver or app timer change. A final full-unit run omitted the documented GNU date runtime and failed three existing backup-pruning cases; rerunning with the GNU path passes the full suite. No test, budget or policy is disabled to obtain acceptance.

## Exact local candidate

Actual compiled source is8f1bbd2285e3eabe2468b16cee9a5bb9bcf852a5, built2026-10-09T06:21:11.672Z. Ordinary30 journeys pass across phone390×844, portrait800×1280 and fridge1280×800. Artificial expanded-copy30 journeys also pass on the same compiled build. Regular cases cover parent/teen/child EN/ES tabs, active hrefs, private menus, role visibility, real browser offline/recovery, overflow, scoped serious/critical accessibility,44×44 targets, full bounds, focus and hit-testing. Additional parent cases cover fresh normal chrome, hidden fridge chrome and long names with guarded fake-profile restoration. Expanded pages assert their actual private mode marker. Unit evidence proves the exact timer deadline; browser evidence proves eventual recovery.

Existing notification/offline journeys pass13 with1 configured skip. All36 unchanged initial-JavaScript budgets pass across six viewports. Final full units pass371 suites/4504 cases with38 suites/188 existing opt-in skips.87 affected mounted/keys/fridge tests pass. Types, lint, format, Prisma validation and ordinary build pass. These are separate, potentially overlapping runs, not a unique aggregated count.

Screenshots are viewport captures before Axe analysis; keyboard-focus rings are intentional. Earlier6603 images remain historical, and some earlier post-Axe tab frames transiently omit right-side header icons. 192 final repaired-source captures extend the gallery to1645 and are separately labelled; all1453 earlier objects/pixels, unique paths, PNG hashes and ZIP CRC pass. no previous manifest records/pixels are replaced. Actual runtime source/build is recorded independently of later test/docs/publication commits. Only guarded fabricated households/loopback PostgreSQL are used. Teen cases log in through the real fixture UI; no auth/role bypass or paid-provider flow.

## Review, rollback and remaining gates

Accepted #425 maina9a30f41c21d4ba3ad82c38f58a21597d5e1f22f is integrated normally. Final tree/history secret checks, publication source identity, original hosted checks, manual review, protections, resolved threads and normal merge remain publication/acceptance gates until observed. Notification preference and deletion-dialog contents remain broader #142 work. Copy inventory1590→1574 only removes14 reviewed records/16 occurrences in three owned components; unrelated records and guards stay unchanged. Complete language/date/time/units/RTL/human/native/store requirements and original #134/#377 remain open.

Rollback is a scoped presentation/dictionary/test/inventory revert, including the matching fridge hook and selector together; no data migration. Local browser QA establishes no production/provider/native-device/human/store or real-household acceptance. Owned app and PostgreSQL are stopped after all browser runs; ports3161/55437 are verified empty.

```sh
npx jest --runInBand src/components/layout/__tests__/navigation-localization.test.tsx src/i18n/__tests__/navigation-keys.test.tsx src/components/fridge/__tests__
npx playwright test e2e/navigation-localization.spec.ts --project=phone-390x844 --project=tablet-portrait-800x1280 --project=fridge-landscape-1280x800
npx playwright test e2e/offline.spec.ts e2e/notifications.spec.ts --project=phone-390x844 --project=desktop-1366x768
npx playwright test e2e/initial-js-budget.spec.ts
```

Use Node22, the documented GNU date shim for full units, guarded isolated fixtures and existing actual-build server flags. Artificial expanded-copy runs need the existing private gallery/pseudo flags; ordinary hosted runs retain their default policy.
