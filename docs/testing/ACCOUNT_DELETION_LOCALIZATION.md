# Account deletion presentation localization — #430

## Scope and compatibility
The existing account/household deletion dialog and its lazy/API loading, retry, export and recovery presentation use typed scoped English/Spanish dictionaries. The small eager status dictionary holds only title/close/loading/retry presentation; full destructive copy remains behind the existing lazy control boundary. Household account-count warnings have singular/plural variants. Dialog close labels use the existing optional `Dialog.closeLabel` prop. No new flow, API, schema, authorization, queue, scheduler, provider, native or stored-data contract is introduced.

`ACCOUNT_DELETE_PHRASE` remains `DELETE`, never translated. Private household names and raw server-error strings are rendered unchanged; password/confirmation drafts and exact request bodies stay canonical. Owned recovery feedback stores a discriminated semantic key, rendered using the current locale, rather than a sentence captured by a stale asynchronous closure. An empty raw refusal retains the original absence of an alert. Existing same-key uncertain-outcome retry, close/reopen retention, first-attempt401 refusal, blocked last-parent/member paths and export behavior are unchanged. Busy deletion still prevents dismissal; no destructive action is queued automatically.

Human/legal review of critical Spanish privacy/deletion copy remains open under #142/#372. This implementation does not establish legal acceptance, complete app/store language support or production deletion approval. Surrounding Settings copy is still broader #142 work.

## Actual source and common gates
Actual compiled app: `b388d8b943650849943d6accdf9a7a14448ea986`, built `2026-10-09T07:47:47.424Z`. Both ordinary and expanded loopback `/api/version` readbacks match exactly. Later harness/prose-only changes must remain byte-identical for application/dependency/schema/config/support/script inputs.

Observed against final app source:
- Prisma generate/validate; normal typecheck, lint, formatting and compiled build PASS.
- Full375 suites/4535 tests PASS61.144s;188 existing opt-in skips. Existing Jest force-exit advisory retained unchanged.
- Affected9 suites/93 checks PASS3.016s, including17 new mounted/key/pseudolocale cases. New cases prove current-language late feedback, preserved draft/focus/body/key, same-key unknown-outcome retry across dismissal, lazy retry without locale-triggered reload, export progress/failure, raw nested/top-level/empty refusals, first-attempt401 distinction, blocked permission paths, canonical DELETE and private-name/singular-warning preservation.
- Existing real guarded isolated PostgreSQL deletion/isolation/token-revocation and join-race suites:11 checks PASS7.289s.
- Source tree/history secret scans PASS with unchanged `.gitleaks.toml`. Exported source11.42MB;5 reviewed branch-history commits at that scan. Final publication requires fresh tree/history scans.
- Inventory1555→1524:31 owned records/occurrences removed only from DeleteAccountDialog, AccountDeletionStatus and LazyDeleteAccountDialog; all unrelated objects/order remain unchanged, with zero residual owned records. Copy/key guards unchanged and passing.

Canonical deletion/shared/http/export/API/lazy-loader/Dialog implementations, workflows, Prisma/native/dependency/config files and guards are unchanged. Named review evidence includes430-copy-inventory-review.json and430-unchanged-contracts.json outside the repository.

## Regression and environment evidence
Four new mounted cases failed on original untranslated source, then passed after localization. Initial expanded-label expectations incorrectly used plain ASCII against deliberately transformed labels; corrected expectations use the existing public pseudolocale transformer. No app/guard waiver.

Initial typecheck and a filename-only diagnostic independently stalled in filesystem `stat` at installed Tailwind type declarations. Only verified owned stalled compiler/diagnostic processes were stopped; original session81077 and diagnostic32839 ended143. The affected installed types folder is preserved at430-tailwind-types-stalled-backup. Only the exact locked Tailwind3.4.19 type files were restored from its SHA512-integrity-verified archive, without lock/dependency/config/source changes. Fresh original command types/lint/fullunits passed. Read-only config discovery found1240 files/0 config errors. This is dependency-file restoration, not a skipped compiler gate.

Initial pre-browser runtime assertion incorrectly read nonexistent `sha`; it failed before any browser launch. Corrected guard uses actual canonical `commit`, preserving original JSON/error evidence. A later harness patch assertion failed before writing; the shell accidentally launched an unchanged redundant ordinary run. Only its verified Playwright PID was interrupted (5PASS/1interrupted/12notrun, terminal130), with output preserved. The reviewed harness was subsequently changed under set-e and passed.

Initial18 ordinary journeys PASS1.6m/144PNG are retained separately. Reviewed final harness adds real browser offline/online state plus controlled request aborts, same-key recovery after two dropped sends, new key after an earlier refusal and native password→confirmation Tab focus. App/build inputs remain unchanged. Reviewed harness types/lint/format PASS.

Completed own build cache461891152bytes was removed only after successful build14429 and confirmed empty app port3161; compiled outputs, logs, screenshots and all unrelated work remain preserved. No other project's cache/configuration was altered.

## Rendered evidence
Final18 ordinary journeys PASS1.8m/162PNG; final18 artificial expanded-copy journeys PASS1.8m/162PNG. Three person roles × EN/ES ×390×844 phone,800×1280 portrait and1280×800 fridge sizes. Expanded mode uses the existing two explicit local runtime QA flags on the same compiled app, with actual HTML marker asserted. It is not a supported public language.

All new-suite DELETE requests are intercepted as synthetic refusal/drop responses before reaching the server. Real own-fixture identity and deletion options are read and verified unchanged. The suite verifies API loading/failure/retry, ready warning/export controls, export failure, canonical confirmation, pending non-dismissible submit, same-key in-progress recovery, actual offline/online and unknown-outcome retry key retention, raw refusal, exact payloads, Escape, native Tab focus,44px full-bounds/hit targets, no horizontal overflow and scoped serious/critical WCAG checks. Screenshots precede Axe and show viewport portions of scrollable content with intentional focus.

Separate unchanged existing actual browser deletion/export flows PASS6 cases14.4s on spec-owned disposable households at phone/desktop. They prove actual household/member/teen deletion and preserve canonical fixture households. This is separate from the new simulated-refusal suite and from real-world approval.

All36 unchanged cold-JavaScript budget checks PASS across all6 original viewports:18 checks19.0s at phone/portrait/fridge and18 checks19.0s at remaining phone/large-tablet/desktop sizes. No thresholds, guards, auth policy, timeout or screenshot baseline changed.

Ordinary Spanish parent portrait warning and child phone offline recovery, plus expanded Spanish child phone confirmation, were visually inspected. Long expanded content naturally scrolls; all primary controls were individually checked in bounds. No complete native/zoom/RTL/human/full-app acceptance inferred.

## Gallery and handoff
Verified gallery/ZIP:2293 unique source-labelled images, including324 final account-dialog viewport frames. All1969 prior manifest objects/pixels unchanged; new hashes/dimensions, unique paths, exact archived manifest and ZIPCRC pass. Initial/interrupted stages remain separate outside the delivered append. The historical overview.png remains outside the manifest. Named1969-record gallery backups preserve prior HTML/manifest/README/ZIP.

Owned ordinary/expanded servers and guarded PostgreSQL are stopped; ports3161/55437 verified empty. Primary dirty and auxiliary worktrees remain preserved. Final source/head publication, original hosted gates, exact manual review/current normal protections/resolved threads and normal merge remain required before checking/closing original #430 criteria. #429's own original hosted acceptance is a separate prerequisite; never substitute local/source passes for it.

Rollback: revert presentation/dictionaries and their scoped inventory removals together. No data/API migration. Full #142/#128/provider/production/legal/human/native/store/household acceptance remains open.

## Local CI-source integration — 2026-10-09

Reviewed429 CI repair6cbd81d is locally integrated without claiming protected-main acceptance. All application/dependency/schema/config/support/scripts/public inputs remain byte-identical to actualb388d8b and the existing compiled/rendered source above; workflow bytes match6cbd81d exactly. Only the dated CURRENT_STATE prefix conflicted, and both full prefixes are archived verbatim with the original baseline tail unchanged. Current complete candidate case enumeration/secret/source checks remain required before publication; original429 hosted acceptance remains pending. No local tests/build/browser results are invented for this workflow/prose-only integration.
