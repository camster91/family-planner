# Recipe-to-meal candidate review

Status: **Not ready for Google activation or production promotion.** Local implementation and fixture verification exist; exact final artifact/CI and real provider acceptance remain separate.

Repository: `camster91/family-planner`, branch `design/connected-workflows-20261102`. Base is the existing household backend and approved connected-workflow study in this directory. No database migration or additional household data store. No changes to calling/native app scope.

## Requirement audit

| Requirement | Evidence / current result |
| --- | --- |
| Empty meal slot opens discovery with date/type retained | Meal page tests and authenticated local Worker journey; compact slot remains editable. |
| Online, saved, pasted link and quick meal remain accessible | Real component browser fixture at phone/tablet/desktop; quick text and online query survive switching. |
| Preview/Back keeps context | Inline picker tests and browser fixtures; grounded source preview uses the same owner-bound endpoint. |
| Save/reuse without duplicate recipes | Canonical source key + family-bound D1 lookup; actual Worker tracking-link reuse makes no recipe POST. Concurrent source-save race still uses existing duplicate refusal. |
| Plan once despite a lost response | Actual Worker committed-response-loss check: exact key/body retry, independently read one meal. |
| Editable servings, optional cook/notes | Untouched servings default to verified yield; edited values retained; Details hides cook/notes. Tested recipe detail → meal reuse carries portions. |
| Confirmed meal → groceries | Actual Worker confirmation/review; lost committed grocery response retries original intent without extra rows. Separate meals retain separate provenance. |
| Cooking/leftovers/next prep | Actual Worker cooking-stock handoff with no automatic deduction; two-dish prep; eaten/remaining and allocated leftovers persist; next prep reuses original dishes/portions. |
| Google results/citations/suggestions | Native adapter and inline display connected behind explicit flag. Actual Worker with outbound interception renders cited fixture response and sandboxed suggestions. **No live Google result verified.** |
| Search-inclusive cost limits | Actual D1 usage reports two fixture queries + input/output/thought token costs; refuses unpriced and budget-denied searches. Unknown usage retains reservation. Reservation is an admission estimate, not a provider-enforced maximum number of searches. |
| Provider support and pricing | Server-only approval binds rates to endpoint/model/key HMAC and expiry. Supported native endpoints/models checked; configuration absent/expired refuses dispatch. **Real configuration, prices and billing/display acceptance not verified.** |
| Publisher behaviour | Earlier local public reads: BBC Good Food recipe extraction succeeded; Allrecipes/Serious Eats returned 403. This is neither universal coverage nor production Cloudflare egress proof. |
| Household ownership/recovery | Parent access, foreign-household 404 and anonymous 401 in local Worker; source lookup scoped to family; route checks before/after waits; fixture server tests cover revocation. |
| Responsive layout | Source/editor/grocery/grounded-result checks at 390×844, 800×1280, 1366×768. Google iframe screenshot check explicitly awaits frame content. No physical-device/native acceptance claimed. |

Evidence lives in the adjacent local `artifacts/connected-workflows-20261102/` directory; checkpoint details and exact source identities are in README.md. Distinguish publisher/API fixtures from actual auth/D1 writes. The retained Google Worker archive is `6717f5ef`; subsequent harness-label/docs edits and the discovery-timeout correction are not in that archive. Do not deploy it as the final candidate.

## Remaining release work

1. Observe consolidated checks and fix failures. Rebuild/package the exact final source after the timeout correction; verify source manifest/checksum before promotion.
2. Prepare/publish a reviewable PR with exact checks and configuration boundaries. No PR currently exists for this branch; no merge or deployment is claimed.
3. Before enabling Google, verify a real supported provider configuration and current rates, authorize any paid activation, and test citations/suggestion presentation and publisher previews with actual provider output. Keep the activation flag off otherwise.
4. Verify production publisher coverage and post-release household flows only in an explicitly authorized target. Local Miniflare/Chrome evidence does not establish production or native acceptance.

## Configuration and rollback

Default remains publisher discovery. `preferGrounded` is an opt-in response capability; older clients retain the old response. Google requires `FAMILY_GOOGLE_RECIPE_SEARCH_READY=1`, `FAMILY_GOOGLE_RECIPE_SEARCH_PRICING` with current `{configVersion, validUntil, pricing}`, the existing configured provider, adopted usage tracking and a priced household budget. Do not copy fixture keys/rates into production. Expired or incompatible setup fails explicitly; it does not silently send unmetered requests.

Turning the Google flag off restores publisher discovery for subsequent searches without deleting saved recipes, meals or groceries. Existing canonical writes retain their normal recovery paths. No production rollback artifact, backup check or approval is implied by this local review.
