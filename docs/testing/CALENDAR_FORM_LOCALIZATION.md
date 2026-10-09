# Calendar form localization (#421)

The existing manual event create/edit flow uses a typed route-owned EN/ES dictionary through the existing scoped translation API. Labels, placeholders, required-field hints, local errors, loading/empty/imported-read-only states and delete dialog/recovery copy localize. Owned errors retain a message key, so mounted locale switches update visible copy without resetting fields, original instants, record bindings, pending fetch/delete state or requests. Unknown server messages and household title/description/location/source values remain verbatim. The shared form-hints helper, root message bundle, dates/import/provider/API/schema and native contracts are unchanged.

## Regression and checks actually observed

The final correctly configured regression-first component run fails all six cases against the original #420 source47b1209. Early test harness runs lacked Jest DOM matchers and used the Playwright focus matcher; those setup errors are retained separately and are not substituted for the final six regression failures. After repair the new actual form suite passes9 cases and the dictionary/parameter suite passes5 (ordinary/expanded EN/ES private interpolation). Existing scoped create/delete/imported/teen and exact-timestamp/stale-record assertions remain intact; Spanish selectors now match actual translated accessible names rather than expecting English under Spanish app language.

The first full gate had366 suites/4,461 cases passing and one genuine translation-key guard failure: the literal route-scoped loading key was treated as a global key. A typed CalendarFormMessage variable keeps lookup explicitly scoped without changing the guard or adding messages to the global bundle. The repaired full gate passes367 suites/4,462 cases, with38 suites/188 existing opt-in cases skipped. Prisma/types/full lint/repository format/build and exported-tree/new-history secret checks pass. Practical inventory1722→1678 removes only42 records/44 occurrences in the two owned routes, with unchanged scanner and preserved original inventory backup.

Actual committed app build6a09e04f272690b60393da366d97acdb78b3d2f8 reports builtAt2026-10-09T02:57:55.778Z. Test-only harness headbfe2ead0f274dc1edd4da3d4abdf1a647df312f8 has byte-identical app src. The initial ordinary browser run has27 passes/12 failures: six initial-disabled-action checks wrongly required a disabled pointer-events:none action to receive a click; six imported-event readbacks exposed direct node-postgres Date fixture serialization into timestamp-without-time-zone columns. A guarded SELECT probe proves Date→01:30 vs ISO string→06:30 for the intended06:30Z instant. Fix only the harness: retain44px/viewport/no-overflow/axe requirements for disabled controls plus explicit disabled/aria-describedby assertions; require focus/hit-center for every enabled action. Pass direct fixture times as ISO strings. No app conversion, budget, baseline, retry or trace policy changed. Original failure reports and probe remain retained.

## Browser method and safety

One guarded loopback PostgreSQL and committed production build; actual Toronto browser zone, fixed fictional January anchor, existing fake parent auth and two-household fixtures. External browser requests blocked. Manual rows are created/saved/deleted via the real canonical API, then read back404. Imported-read-only rows use exact spec-owned fx_e2e_calendar_locale_* IDs in guarded fixture tables with an intentionally invalid URL envelope, so no provider refresh can run; afterAll deletes exact family-owned IDs and checks both tables empty. Read-only source/title text is verified verbatim. Calendar creation tests prove gap rejection sends zeroPOST and corrected03:30 stores exact07:30Z; edit tests preserve both06:30:45.123Z/06:45:55.456Z and all private fields. Delete confirmation focus/cancel and actual successful deletion use localized controls. Typed local errors translate on actual mounted locale switches in unit tests, including loading/404 and pending/failed delete without another request.

Ordinary and explicit QA-only expanded-copy results, final source identities, screenshots and exact original hosted gates must be appended after observation. Do not infer human language, full-app translations/pseudolocale/RTL/units, native/store/production/provider or broader parent142 acceptance. #420 remains the prerequisite in its original hosted E2E run; incorporate accepted protected main before publishing this slice. No production, settings, scheduler, paid provider or real household writes.

## Commands

```bash
npx prisma generate
npm run typecheck
npm run lint
npm run format:check
npm test -- --runInBand
npm run build
npx jest --runInBand --runTestsByPath src/app/dashboard/calendar/__tests__/form-localization.test.tsx src/i18n/__tests__/calendar-form-keys.test.tsx
npx playwright test e2e/calendar-form-localization.spec.ts e2e/calendar-event-instants.spec.ts --project=phone-390x844 --project=tablet-portrait-800x1280 --project=fridge-landscape-1280x800
npx playwright test e2e/initial-js-budget.spec.ts --no-deps
```

Full Jest uses the existing Node22/guarded fixture environment and GNU date shim. Secret tree scan runs from exported tree root using unchanged config; new history starts at prerequisite47b1209. Raw evidence stays as421-* logs, reports, runtime readback, inventory removal records, named backups and fixture serialization probe in this task workspace.

## Rollback

Revert route-owned dictionary/wiring/localized selectors/tests/inventory/docs to restore original English copy while retaining prerequisite419 timestamp/record-binding repair. No stored-data rewrite, schema/API/provider/native migration or production setting change.

## Final observed browser/capture evidence

Reviewed ordinary browser run passes39 checks (36 journeys plus3 setup) across phone390, portrait800 and fridge1280. All36 unchanged core JS budgets pass across all six configured viewports. Existing18 exact-timestamp/gap/obsolete-response journeys remain effective with localized selectors. Expanded run passes18 journeys using the same actual6a09e04 build/time with both existing local QA runtime flags; each private page asserts the actual data-pseudolocalized marker and exact expanded accessible names, rather than inferring mode from environment alone. Public/static pages and full-app/native/store QA are not claimed.

Visual inspection of ordinary Spanish confirmation/read-only and expanded Spanish phone confirmation found no clipped action or lost private interpolation. Full-page modal screenshots added off-screen background below the viewport; capture-only head0c6cc261721d29c191aa15957d03d6f97b5d2e59 switches confirmation captures to actual viewport dimensions, retaining full-page form captures and every action/axe/data assertion. Both final ordinary18 checks (40.5s) and final expanded18 checks (39.3s) pass, using existing validated auth with--no-deps. Its app src is byte-identical to actual6a09e04. Final expanded phone confirmation image was visually inspected. No UI source, baseline, budget, trace, retry, request or permission policy changed for this capture repair.

Gallery/ZIP now1003 unique source-labelled images, with all883 earlier entries preserved exactly. The120 additions are84 ordinary (48 timestamp/late-response views plus36 final translated forms/empty/errors/read-only/dialogs) and36 separate expanded QA views. New PNG dimensions/SHA, all manifest paths, exact archived manifest and fullZIPCRC pass. Expanded copy is artificial QA, not another supported language. All new form visits explicitly observedHTTP200. No claims about unchanged older image statuses or production/physical devices. Owned loopback server and guarded PostgreSQL stopped; port3161 has no listener.

#420 exact47b1209 Build/Test and checked-image jobs pass; its original E2E37875709527 remains live at this observation. This candidate is local/unpublished until accepted protected-main reconciliation and its own exact-head hosted gates and normal merge. Earlier failures, first passed capture sets and runtime identities remain preserved under their actual names and modes.

## Accepted-main inclusion

#420 passed original881 hosted journeys/28 visuals and merged normally asb53e5f109c8e438166a640176a80432d1e53ed21 at03:16:29UTC. Its five original #419 criteria are checked/closed with history intact; only its verified owned branch was removed. Ordinary mergef76b0d17171a18b54173875dac7a0965d8894e51 includes that accepted main here. Full app src,package/dependency files,next config,schema,Playwright config,support and scripts are byte-identical to the actual6a09e04 committed build. No new local runtime/build is claimed for documentation or this source-identical integration. Final types/format/tree/history checks and exact-head hosted gates remain recorded separately.

## Verified normal merge and original closure — 2026-10-09

#422 exact e33f46dd62c5c362b583477c9a503e88f0edd99d passed original Build/Test37878920351,
checked-image113656189598 and E2E37878920362 (899 journeys/736 configured skips in30.0m;
28 visuals/11 existing skips in39.5s). GitGuardian, manual exact-head review, resolved threads and
strict/admin/conversation protection verified. Normal merge73805fe9e94048bddcb993a5ab49509ee28a90af
completed03:56:36UTC. All five original #421 criteria are checked/closed preserving wording/history;
only its exact accepted owned local/remote branch was cleaned. Earlier pending paragraphs above
retain their original observation stage. Actual6a09e04 build and1003 source-labelled gallery identity
remain unchanged. Publish/VPS skipped; no cloud review success, production/provider/native/store or
wider #142 acceptance is inferred.
