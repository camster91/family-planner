# Recipe-to-meal candidate review

## Current revision — household Gemini setup (November 3)

Cameron clarified that entering and saving a Gemini key in Settings should connect recipe discovery without a separate server-price approval. This revision supersedes the activation approach described in the earlier candidate audit below. PR #622 is draft; its older head passed Build & Test but six meal browser checks failed because they still follow the earlier form. The repaired phone meal journeys now pass all 14 checks against a disposable PostgreSQL database, including English/Spanish discovery, inline recipes, saved recipes, meal mutations and child restrictions.

The current working revision adds a parent-only Gemini preset and bounded fixed-host model-metadata validation before storing the encrypted key. It rechecks household authority after the provider wait. Metadata validation is not proof that Google billing/search quota is enabled; real grounded search may still return a provider denial. No real Google key or paid generation was used in development.

A maintained standard-rate catalog for Gemini 3.8 Flash supplies token and per-query estimates and a default US$5 monthly estimate limit, preserving existing lower limits and pauses. Rates were verified against https://aistudio.google.com/docs/pricing#gemini-3.8-flash on November 3; the catalog expires December 3 pending review. No shared Google free allowance is counted as a household entitlement. The atomic D1 admission query uses the effective limit, and the usage screen displays managed pricing instead of asking the family for token rates. Unknown outcomes retain reservations; this is an application estimate, not a provider-enforced billing cap.

The candidate Cloudflare configuration enables the Family AI Settings entry and existing usage ledger gates; tables already exist in D1 migration 0005. It does not add a provider credential. `FAMILY_GOOGLE_RECIPE_SEARCH_READY=0` remains a kill switch; an explicit server pricing override remains supported. Clearing the family key restores publisher discovery unless a separately configured deployment fallback key exists. The Next build, OpenNext bundle and Wrangler dry run passed for source `4e259d68aa15a454ca7d356d5d0f4214c93313c9`. Its local archive is `gemini-runtime/local-runtime.tar.gz` in the adjacent artifacts directory. Authenticated Chrome checks against that actual local Worker/D1 runtime saved a fabricated key through Settings, rejected an invalid key without changing configuration, automatically applied maintained pricing and the default budget, rendered cited search results, and refused another search after lowering the budget. Google outbound responses were intercepted fixtures; this is not live provider or production acceptance. Phone/tablet/desktop captures and `gemini-setup.json` record the evidence. The older c5e22637 artifact below must not be promoted as this revision. Updated GitHub checks remain pending.

## Earlier candidate audit

Status: **Not ready for Google activation or production promotion.** Local implementation, consolidated checks and exact final artifact verification passed; GitHub CI and real provider acceptance remain separate.

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

Evidence lives in the adjacent local `artifacts/connected-workflows-20261102/` directory; checkpoint details and exact source identities are in README.md. Distinguish publisher/API fixtures from actual auth/D1 writes. The final local Worker archive is `final-runtime/local-runtime.tar.gz`, built from clean commit `c5e226377df38cdabe4f08444c2c43191e89588d`. SHA-256: `26258cb8d866513c0be8a716a6eac9c87dda9ca9e7d9900282308e8ccfe3ea78`. Older archives are historical evidence only. This archive is local verification evidence, not a GitHub-built production release.

## Remaining release work

1. Completed locally: 834 suites / 8,455 tests passed (85 suites / 562 tests skipped); production Next build, OpenNext bundle and Wrangler dry run passed. Full lint has zero errors and 76 existing warnings. Exact final Worker authenticated search/cost/budget checks passed using an intercepted fabricated Google response. Obtain the required GitHub Build & Test check for the published candidate.
2. Prepare/publish a reviewable PR with exact checks and configuration boundaries. No PR currently exists for this branch; no merge or deployment is claimed.
3. Before enabling Google, verify a real supported provider configuration and current rates, authorize any paid activation, and test citations/suggestion presentation and publisher previews with actual provider output. Keep the activation flag off otherwise.
4. Verify production publisher coverage and post-release household flows only in an explicitly authorized target. Local Miniflare/Chrome evidence does not establish production or native acceptance.

## Configuration and rollback

Default remains publisher discovery. `preferGrounded` is an opt-in response capability; older clients retain the old response. Google requires `FAMILY_GOOGLE_RECIPE_SEARCH_READY=1`, `FAMILY_GOOGLE_RECIPE_SEARCH_PRICING` with current `{configVersion, validUntil, pricing}`, the existing configured provider, adopted usage tracking and a priced household budget. Do not copy fixture keys/rates into production. Expired or incompatible setup fails explicitly; it does not silently send unmetered requests.

Turning the Google flag off restores publisher discovery for subsequent searches without deleting saved recipes, meals or groceries. Existing canonical writes retain their normal recovery paths. No production rollback artifact, backup check or approval is implied by this local review.
