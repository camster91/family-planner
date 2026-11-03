# Recipe-to-meal candidate review

## Chore notification follow-through — November 3

Source `2f6ffb368bf15bd20fc0b69934dd73f8c274d1c1` connects ordinary assignment
and post-commit approval/return notices to existing permission-checked chore
focus. Six affected suites / 77 tests, typecheck, scoped lint and Cloudflare
build/dry bundle passed. Actual local Worker/D1 browser acceptance verified
new assignment → stored inbox notice → Open → exact chore on a 390×844 phone.
The rendered target offers existing completion/edit controls without overflow.
Evidence: adjacent `chore-notification-links-*` artifacts. The initial fixture
called the wrong collection endpoint; its corrected canonical create call passed
without another app change. No live data, provider, scheduler or deployment was
changed. Prior broader suite evidence retains its original source identity;
production release status remains **Not ready** for the outstanding gates below.

## Latest scoped follow-up — November 3

Source `3cce250a9351cdbd2e3cda416e07325214a20eae` fixes the unavailable quick-add
state in Review inbox. Six suites / 80 tests, typecheck, scoped lint, the
Cloudflare production build and local dry bundle passed. Authenticated local
Worker/D1 browser checks passed on phone, tablet and desktop: clear unavailable
state, canonical AI settings handoff, empty key, recipe recovery preserved,
no overflow and no API writes after fixture setup. Email-free child/parent
routine creation persisted in an independent page and the Routines destination
rendered. Screenshots were inspected. A first routine script reload raced the
app refresh; the independent-page retry passed without code changes.

The clean-source local archive is `review-availability-runtime/local-runtime.tar.gz`
in the adjacent `artifacts/connected-family-features-20261103/` directory. It is
not a GitHub release artifact. The earlier full suite below belongs to source
`cc91fc8b`, while this follow-up has the scoped checks above. Current source is
39 commits / 119 changed files beyond PR #622's previously verified head.
Production recovery readiness, updated GitHub checks and provider/device
acceptance remain outstanding; release status remains **Not ready**.

## Connected-feature continuation — November 3

**Release state: Not ready for production promotion.** Source candidate
`cc91fc8bda8da91263a77b9830e74fbacb72b19d` on
`feat/connected-family-features-20261103` contains 36 local commits beyond PR
#622's head `6a6c0b611e1deaf345d2e9c25dd059d217867407` (113 changed files).
The earlier recipe-only scope and no-migration statement below do not describe
this expanded candidate. PR #622 was fetched again: open, unmerged, at its old
head. Its automated Codex review did not finish because the account review quota
was exhausted; this is not a completed code review or a source defect finding.

### Included work and configuration

Existing canonical flows now connect native D1 event preparation, schedule
conflict review, responsibility/history, weekly reset, food planning, email-free
profile routines, stock capture/reuse and household-configured food-photo AI.
Follow-ups protect unparsed inbox drafts, typed text during voice input, barcode
camera lifecycle and routine-editor/assistant destinations. Android reminder
links and the iOS package alignment are native source changes; compilation is
not installed-device or store acceptance. Calling remains removed.

The candidate enables twelve existing readiness/recovery variables in
`wrangler.jsonc`. It adds D1 migrations `0017_event_preparation_lifecycle.sql`
and `0018_event_preparation_step_bounds.sql`. These install identity, lifecycle,
counter and step/cue guards. No production migration has run for this candidate.
The previous recipe candidate's code-only rollback statement is insufficient:
verify backup/restore and old-client behavior with these guards, retain the exact
previous Worker and configuration, and record the recovery owner before promotion.

### Verification and outstanding requirements

- Fresh Next/OpenNext Cloudflare build and sequential typecheck passed at the
  source above. Full lint has zero errors and 76 warnings. The local build's
  `.open-next` and D1 input file hashes are retained in
  `final-candidate-build-evidence.json`; manifest SHA-256:
  `fbf3ab5a3c854ec2d7830776d6619078a0817f71c90368eb24958b6613cc37d0`.
  This is a local artifact, not an immutable GitHub production release artifact.
- Full-suite rerun passed: 841 suites and 8,548 tests, with 85 suites/562 tests
  skipped. The first run had one ENOSPC reporter failure (840 suites/8,547 tests
  passed). Both logs are retained; no application defect or fix is inferred from
  the infrastructure failure. After open-file checks, only this task's disposable
  Xcode module caches were removed (253,715,966 bytes); app products, source,
  package pins and evidence remain. The separate typecheck was rerun successfully
  after its first log-open failed for lack of disk space.
- Affected real workerd/D1 and actual-component browser evidence is recorded in
  `docs/engineering/EXECUTION_ORDER.md`. It covers the exercised journeys only;
  fake provider responses do not prove live provider acceptance.
- Local migration/restore rehearsal now passes from 0016 through 0017/0018,
  comparing all 98 application tables and restoring exact schema/index/trigger
  definitions and prior migration ledger. It also covers preserved invalid legacy
  steps, explicit repair, repeated migration apply and restore-then-upgrade.
  Raw export import failed on forward table references; the local procedure
  installs tables/indexes before data and triggers afterward. See BACKUPS.md.
  Fresh production D1/R2 recovery evidence and installed old-client acceptance
  remain separate requirements; no production migration or restoration ran.
- Current-candidate CI, immutable release artifact, integrated browser workflow,
  independent review and migration/recovery proof remain release work.
- #141 still needs asynchronous delivery/provider registration, revocation and
  background-device acceptance. Existing native incoming-link handling is not
  push delivery. No new scheduler or messaging provider is activated here.
- #144/#125/#124 live model/search/photo/calendar eligibility and provider
  behavior remain unverified. #473/#138 still need installed-device lifecycle,
  camera/microphone, signing/store and current/previous-client evidence.
- #480/#450 credit ownership and former-account/profile retention decisions
  remain unresolved; existing ordinary profile routines do not settle them.
  Broader #499 role/device/accessibility and #464 assistant scope remain open.

Read-only production checks returned health200 on herewoven.com and
family.ashbi.ca. The primary `/api/version` still reports
`18a58fee45aceeda251a494518900c19d1c5db9e`, consistent with the November 2
release recorded in #604. An initial default Python client was refused; the
explicit readiness-check User-Agent returned healthy responses. These public
checks prove neither current-candidate deployment nor authenticated household
acceptance. No live data, credentials, billing, push, merge or deployment changed.

## Current revision — household Gemini setup (November 3)

Cameron clarified that entering and saving a Gemini key in Settings should connect recipe discovery without a separate server-price approval. This revision supersedes the activation approach described in the earlier candidate audit below. PR #622 is draft; its older head passed Build & Test but six meal browser checks failed because they still follow the earlier form. The repaired phone meal journeys now pass all 14 checks against a disposable PostgreSQL database, including English/Spanish discovery, inline recipes, saved recipes, meal mutations and child restrictions.

The current working revision adds a parent-only Gemini preset and bounded fixed-host model-metadata validation before storing the encrypted key. It rechecks household authority after the provider wait. Metadata validation is not proof that Google billing/search quota is enabled; real grounded search may still return a provider denial. No real Google key or paid generation was used in development.

A maintained standard-rate catalog for Gemini 3.8 Flash supplies token and per-query estimates and a default US$5 monthly estimate limit, preserving existing lower limits and pauses. Rates were verified against https://aistudio.google.com/docs/pricing#gemini-3.8-flash on November 3; the catalog expires December 3 pending review. No shared Google free allowance is counted as a household entitlement. The atomic D1 admission query uses the effective limit, and the usage screen displays managed pricing instead of asking the family for token rates. Unknown outcomes retain reservations; this is an application estimate, not a provider-enforced billing cap.

The candidate Cloudflare configuration enables the Family AI Settings entry and existing usage ledger gates; tables already exist in D1 migration 0005. It does not add a provider credential. `FAMILY_GOOGLE_RECIPE_SEARCH_READY=0` remains a kill switch; an explicit server pricing override remains supported. Clearing the family key restores publisher discovery unless a separately configured deployment fallback key exists. The Next build, OpenNext bundle and Wrangler dry run passed for source `4e259d68aa15a454ca7d356d5d0f4214c93313c9`. Its local archive is `gemini-runtime/local-runtime.tar.gz` in the adjacent artifacts directory. Authenticated Chrome checks against that actual local Worker/D1 runtime saved a fabricated key through Settings, rejected an invalid key without changing configuration, automatically applied maintained pricing and the default budget, rendered cited search results, and refused another search after lowering the budget. Google outbound responses were intercepted fixtures; this is not live provider or production acceptance. Phone/tablet/desktop captures and `gemini-setup.json` record the evidence. The older c5e22637 artifact below must not be promoted as this revision. Updated GitHub checks remain pending.

### Consolidated verification

- Full local suite: 836 suites / 8,471 tests passed; 85 suites / 562 tests skipped.
- Phone meal journeys: all 14 checks passed. Wider meal run: 21 passed; four discovery checks initially rejected the earlier build identity. After a clean build at `236c3eba143f25f468b3d944fabd9e43152f6513`, all four English/Spanish tablet/desktop discovery journeys passed (7 checks including auth setup).
- Current-head Next production build passed. The subsequent patch only formats the two browser test files and updates evidence.
- GitHub found formatting differences in those test files; corrected locally. Updated required CI checks remain necessary before release.
- No merge or deployment performed. No live Google key, billing eligibility or production publisher acceptance is claimed.

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
