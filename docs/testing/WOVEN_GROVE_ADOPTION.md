# Woven Grove adoption — source verification

This is the historical implementation-stage handoff. Its local source/SSR passes and deferred gates are not claims about the current PR or production. Hosted evidence and final acceptance requirements are recorded separately below.

Scope: approved Herewoven/Woven Grove web identity only. No schema/API, role/privacy, native identity, feature or mutation-contract change. Source checkout: `family-planner-woven-grove`, branch `feat/woven-grove-brand`, based on `7a2dcbb24fdf88759b2d82a0e757daba5b291579`. No commit, push, server or remote write was performed by this implementation slice.

## Observed RED → GREEN

Tests were added before implementation, then exercised against actual files/production React components. The initial canonical Jest asset run failed 2/2 for the expected missing approved mark and old favicon bytes. Subsequent new slices failed for Google font loading/old variables, old palette anchors, missing woven graphic, old viewport/recovery metadata, faded pressed plain actions, and 36px rather than preferred 48px mark sizing before their corresponding changes.

Memory deteriorated to approximately 97–98% load (0.43–0.92 GiB free). Further Jest/full typecheck/build/browser work was deferred rather than competing with the user's apps. Final checks ran sequentially using the pinned Node 22.23.3 with a 128 MiB heap, TypeScript transpilation and the project's real `expect` assertions. This small harness executed only these **synchronous, unmocked source/SSR tests**, including the production `BrandMark`, Home/I18n provider and auth frame; it is supplemental evidence, **not a canonical Jest-suite pass**. No mocked provider/database state or fabricated API response was used.

| Test file                                    | Final passed | Failed | Evidence                                                                                                              |
| -------------------------------------------- | -----------: | -----: | --------------------------------------------------------------------------------------------------------------------- |
| `src/__tests__/woven-grove-assets.test.ts`   |            2 |      0 | Actual mark SSR, exact approved hashes, PNG dimensions                                                                |
| `src/__tests__/woven-grove-fonts.test.ts`    |            1 |      0 | Local-font configuration, exact variable TTF hashes and OFL licenses                                                  |
| `src/__tests__/woven-grove-palette.test.ts`  |            1 |      0 | Six exact swatches, semantic roles, unfiltered Chalk-backed mark                                                      |
| `src/__tests__/woven-grove-graphics.test.ts` |            2 |      0 | Actual landing/auth SSR, 48px mark references, exact graphic bytes, setup display wiring                              |
| `src/__tests__/woven-grove-metadata.test.ts` |            2 |      0 | Themes/install/recovery identity, storage/cache/redirect preservation, readable pressed/plain and success-text wiring |
| `src/__tests__/brand-contrast.test.ts`       |          111 |      0 | Existing 110 light/dark contrast pairs plus new approved exact anchors                                                |
| **Total**                                    |      **119** |  **0** | Programmatically counted from actual final outputs                                                                    |

Existing contrast thresholds/pair coverage were unchanged. The old exact palette anchor assertion was updated to the explicitly approved new identity, not weakened. Landing and metadata tests were aligned to the approved static graphic and `next/font/local`, retaining account-route, fictional-preview, origin, metadata and PWA URL assertions.

Additional observed checks:

- `git diff --check`: passed.
- TypeScript syntax/transpilation diagnostics: 16 changed/new TS/TSX files, zero errors. **Not a full typecheck.**
- PostCSS parsing of production `globals.css`: passed. **Not a production build or computed paint check.**
- FontTools inspection: real Manrope `wght` 200–800; Newsreader `wght` 200–800 and `opsz` 6–72.
- Canonical SVG file hash and approved geometry fingerprint are distinct values, both recorded in the adoption manifest/brand docs; no source-geometry mismatch was found.

## Gates deferred at the initial handoff

Run canonical focused Jest regressions (including landing, auth/metadata, GetStarted, DashboardNav and service-worker tests), full typecheck/lint and required full CI/build on the exact candidate. Memory did not support these broader local gates safely. The local scratch harness/logs are supplemental and auto-pruned; committed test sources and this result index are the durable handoff.

Actual browser light/dark/pressed paints, font loading, 320/390px navigation/reflow, long text, tablet/shared-board fit and role-aware behavior still need exact-candidate verification. Header marks are now 48px within the existing 64px app bar; this requires narrow-phone/tablet layout review. No browser, hydration, live API, physical-device or production release claim is made.

Parent owns independent review, commits, CI, merge/deployment authorization and exact production revision/health readback. Native stores and the unrelated six-color brandbook-export limitation remain outside this web implementation.

## Subsequent hosted evidence and final acceptance

- Original source candidate: `5fde7f3f59e56466a512ccc8bc874def7a2ee4cd`. Independent source review and bounded browser QA are distinct from production acceptance.
- Build run `37620946170` passed Build & Test and the checked-image fresh-runner job. The QA record reports 4,155 passing Jest tests/174 skipped and 51 checked-image browser tests, plus separate database/fixture invocations. These are per-invocation counts, not a deduplicated total.
- Commit `7055853428925a5e9ae03dd8b0aa09337963c745` corrected the exact offline product-copy expectation, preserving retry size, accessibility and same-address reconnect assertions. E2E run `37628878276` then passed its journeys/accessibility step with 676 passing tests. Its old-baseline comparison failed, so the overall workflow was not green.
- All 31 Linux visual states were individually reviewed before exact-byte adoption in `13106f275b30cf2bc9a4e2967db9545cf8d41a88`. See [baseline provenance and SHA-256 inventory](WOVEN_GROVE_VISUAL_BASELINES.md). No masks, thresholds, test coverage or permission boundaries were weakened.

Normal Build & Test, fresh-runner checked image, E2E and applicable security/review gates must pass on the final head after all edits, including this document. Historical evidence is not carried forward as a final-head pass. Existing legitimate review conversations must be addressed without bypass.

Production acceptance remains outstanding until the merged state and exact merge SHA are read back, `/api/version` serves that revision, `/api/health` is healthy, and approved branding assets are verified through the authorized Coolify main-push path. The CI image is not asserted to be Coolify's source-build image. This document does not claim a release, physical-device certification, native-store publication or production household mutation.
