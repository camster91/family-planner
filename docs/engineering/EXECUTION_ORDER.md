# Build Execution Order

Use `docs/START_HERE.md` for authority and the live GitHub issue records for scope.
This document orders work; it does not replace acceptance criteria or create a
second backlog. The current issue directory is in
`docs/engineering/ISSUE_COMPLETION_LEDGER.md` and programme issue #128.

## Current continuation — 2026-11-03

Cameron requested completion of the advanced connected features after the
recipe-to-meal release preparation. The historical code-only/no-QA restriction
below is superseded by the later request to verify fixes before release.
Continue the existing issues, not another feature backlog.

- Consolidated release review — source `cc91fc8b`: fresh Cloudflare build,
  sequential typecheck and full-suite rerun pass (841 suites/8,548 tests;
  85 suites/562 tests skipped). Lint: zero errors, 76 warnings. The first suite
  run encountered one ENOSPC reporter failure; after verified-unused disposable
  Xcode module caches were removed, the unchanged-source rerun passed. Retained
  iOS app products and evidence were not removed. Local build/input file hashes
  are recorded in `final-candidate-build-evidence.json`; logs use the
  `final-candidate-*` prefix. Current PR #622 is still open at `6a6c0b6`, 36
  commits behind this local source, with an incomplete automated review caused
  by the review-account quota. Production health is 200 on both app hosts and
  primary version still reports `18a58fee`. The expanded review packet explicitly
  covers migrations 0017/0018 and twelve configuration gates; old recipe-only
  no-migration/rollback statements do not apply. Fresh CI/immutable artifact,
  integrated browser acceptance, migration/recovery, independent review and
  release authorization remain open. No push, merge or deployment occurred.
- Calendar interoperability acceptance (#124): extended the existing native D1
  fixture through real parser → reconciliation → read-back for weekly Toronto
  spring/fall DST, stable IDs on replay, moved exception identity, individual and
  whole-series cancellation, and preservation of local/history/foreign events.
  Both calendar sync and subscription slices pass in disposable workerd/D1; the
  same run covers revoke-during-fetch, source replacement, atomic rollback,
  truncated-input preservation and the subscription access/privacy/cap controls.
  Five focused Jest suites pass (126 tests). The smoke runner now allows these
  two existing slices individually. See CALENDAR_INTEROPERABILITY.md for exact
  scope and `calendar-interop-*` artifacts. Fabricated feeds/provider responses
  do not establish live-provider, physical-device or full #124 acceptance.
  No application behavior, credentials, production or external state changed.
- Routine handoff connection (#464/#450/#499): the assistant now opens the
  dedicated routine view, and the chores server honors the fixed `view=routines`
  destination. Routine editor save/return and schedule-manager return links use
  that same destination. Client state follows changed destination props without
  resetting a person's tab choice on ordinary refresh. Existing role, feature,
  draft and save-recovery gates remain intact; no new write path is introduced.
  Three affected suites pass (54 tests), typecheck passes, and browser component
  checks pass EN/ES across six sizes for direct routine selection and returning to
  Today without horizontal overflow. The Spanish phone rendering was inspected.
  These use an isolated actual-component fixture with a router adapter, not a
  production household or native device. Evidence: `routine-handoff-*` in the
  sibling continuation artifacts. Nothing was pushed, merged or deployed.
- iOS native dependency/build follow-through (#473/#138): `cap sync ios`
  corrected the generated Swift package from Capacitor 8.5.2 to the installed
  8.5.3 runtime; Xcode regenerated the exact resolved pin. Candidate `1efe4fc7`
  passes generic iOS Simulator Debug compilation with distribution signing
  disabled, source plist/project validation, and six shared-native suites (41
  tests). Actual Xcode 27.2 was available; no simulator runtime/device is installed.
  Version 1.0/build 1 are developer defaults, not distribution identity. The first
  resolver run ultimately failed from disk exhaustion, not source compilation;
  retry passed after removing six stopped duplicate QA bundles only after exact
  source/archive/file-SHA verification. Archives and previous QA evidence remain;
  627,925,179 bytes of duplicate files were reclaimed. `ios-space-recovery.json`
  records the retained archive hashes. `ios-build-evidence.json` records current
  source/input hashes and binary metadata. Native installation/permission/lifecycle,
  signing/store, old-client/rollback and live web identity acceptance remain open.
  No paid service, live data, signing credential, push, merge or deployment changed.
- Review-inbox unfinished-input protection (#464/#499): compatibility capture
  now reports nonblank typed input and in-progress text/photo extraction to its
  existing host guard, not just parsed previews. Opening Recipes therefore asks
  before discarding unparsed input; clearing that input removes the warning.
  Only a boolean is reported, with no duplicate draft store or automatic parse.
  The normal owned-document boundary and canonical request recovery are unchanged.
  Six capture/review suites pass (79 tests), typecheck/changed-source lint pass,
  and the Cloudflare build passes. Chromium checks of the real compatibility
  editor inside CaptureInboxReview pass EN/ES across all six baseline sizes:
  cancelling keeps input, confirming opens the recipe destination, no POST is
  sent, and no horizontal overflow occurs. The Spanish phone screenshot was
  inspected. Availability and navigation are fixture adapters; this is not live
  provider, persisted-owned-document, device or complete inbox acceptance.
  Evidence is in `review-draft-*` in the sibling continuation artifacts. No
  external state changed; nothing was pushed, merged or deployed.
- Barcode camera lifecycle (#125): the foreground scanner now refuses hidden
  starts, explicitly stops on `pagehide`, and retires late permission/detection
  results without reopening on return. Missing/busy hardware is distinguished
  from denied permission; EN/ES notices retain typed barcode entry and explain
  deliberate retry. No background scan or new permission request is introduced.
  The affected inventory suites pass (19 suites/126 tests), typecheck and the
  Cloudflare build pass, and changed-source lint has zero errors with three
  existing BarcodeFoodDialog hook warnings. Actual Chromium rendered the barcode
  sheet in EN/ES across six baseline sizes with simulated camera denial/missing
  hardware: manual code → local product read → editable food review works with
  no write or public product lookup and no horizontal overflow. The phone
  screenshot was inspected after settling the existing button colour transition.
  Tests also cover page exit during active preview and pending permission, late
  detection rejection, no automatic restart and deliberate retry. Evidence is
  in `camera-lifecycle-*` in the sibling continuation artifacts. Camera/media
  and product responses are fabricated; actual decoding/permission/hardware,
  native Back/lock and provider coverage acceptance remain open. No live data,
  provider, production or store changes occurred.
- Assistant voice recovery (#464): ordinary browser dictation now has a
  default 20-second deadline, retires failed/successful recognition callbacks,
  handles constructor/abort failures and synchronous browser errors, and accepts
  a final transcript only once. Permission errors stop listening even if the
  browser never emits an end event. The assistant preserves text edited while
  listening and explains the retained draft in EN/ES; a later successful draft
  clears the old voice notice. No transcript auto-sends or mutates household data.
  Four focused suites pass (64 tests), changed-source lint/typecheck pass, and
  the Cloudflare build passes. Real Chromium rendered the actual assistant panel
  across EN/ES and all six baseline sizes: typed-draft preservation, denied-access
  recovery, successful draft insertion, zero network requests and no horizontal
  overflow all pass. Phone success and retained-draft screenshots were inspected.
  This browser fixture uses a simulated speech recognizer and stub router, not
  physical microphone, native speech, provider, noise/distance or background-wake
  acceptance. Evidence is in `voice-recovery-*` in the sibling continuation
  artifacts. Full-suite results below precede this focused follow-up. Nothing
  was pushed, merged, deployed or enabled externally.
- Consolidated local candidate check — source `6fe314a1`: the full suite
  initially found one translation-audit integration failure. Native reminder
  copy now lives in its own small EN/ES catalog, explicitly checked for key
  coverage and equal locale keys without loading the legacy catalog into the
  shell. Its focused component/catalog checks pass (six tests). The full suite
  rerun passed (841 suites, 8,534 tests; 85 suites/562 tests skipped); see
  `candidate-tests-repair.log` under the continuation artifacts. Cloudflare
  production bundling and final typecheck passed. Whole-repository lint reports
  zero errors and 76 warnings; changed-source lint passes without warnings.
  An earlier concurrent typecheck raced the build's generated `.next/types`;
  the sequential post-build rerun passed. No source change was needed for that
  race. Logs are retained in the sibling
  `artifacts/connected-family-features-20261103/` directory. This is local
  candidate evidence, not release CI, provider/device acceptance or deployment.
  PR #622 remains open at its earlier candidate; these continuation commits
  are local. Exact release review/approval and the outstanding original issue
  acceptance remain open. No provider, account, production or store mutations
  occurred in this check.
- Connected review follow-through: native weekly reset now includes eligible
  email-free profiles, preserves child-only chore visibility, filters inactive
  routine occurrences, and offers event timing/preparation entry points.
  Its captured source and authority reads are checked before returning a summary.
  Responsibility mutations now atomically add a minimal “What changed” fact;
  unchanged answers do not produce duplicate history. Failed history writes
  roll back the responsibility update and receipt together.
  Local D1 responsibility, weekly-reset and review-inbox checks passed, including
  archived-profile exclusion, child isolation, no-op history and failed-write
  rollback. The affected 23 test suites passed (146 tests; eight existing
  PostgreSQL integration tests skipped). Typecheck/lint and the Cloudflare build
  passed. Candidate `9a8c5b34` passed real local Worker/D1 browser checks:
  weekly review progression/finish/reload and responsibility acceptance,
  email-free backup, lost-response recovery and reload. Responsibility sheets
  fit phone/tablet/desktop, and the phone screenshot was inspected. The newly
  linked weekly-summary entry points also passed rendered round-trips from
  the review to preparation, timing and responsibility, returning to the same
  review. Release CI remains outstanding. Nothing was deployed.
- Food capture #125: native intake now checks the saved item and current
  authority before confirming new/replayed success. Replaying a deleted item
  reports `INTAKE_ITEM_REMOVED` without recreating stock; original receipts
  remain intact. Typed product-conflict/owner/expiry errors match the scanner
  recovery contract. Native checks pass barcode intake/replay, private product
  reuse/isolation, correction conflicts, deleted-item retry, consume/Undo and
  restocking recovery. Eight focused suites pass (25 tests; five existing
  integration tests skipped), with typecheck and changed-source lint passing.
  Candidate `ba99cbb9` passed the Cloudflare build and real local Worker/D1
  browser flow: provider-disabled typed barcode, duplicate-frame-equivalent
  rescan preserving one draft/quantity, save/reload, private product reuse with
  fresh stock quantity and removed-item retry. Phone/tablet/desktop did not
  overflow horizontally; the phone review screenshot was inspected. Broader
  photo, camera hardware, provider and native acceptance remain outstanding.
  No product provider was activated or called; no production changes ran.
- Stock lifecycle follow-through: actual local Worker/D1 browser at `ba99cbb9`
  passed partial consumption (three cans to two), owned Undo (back to three),
  and replacement creation in a selected grocery list. The phone screenshot
  exposed a stacked editor behind the replacement sheet. The editor now
  suspends while replacement is open, retaining its unsaved fields for return;
  a regression covers one visible dialog, draft restoration and no stock write.
  Replacement success also drops the redundant setup hint/list-index link and
  spaces its remaining Open list/Undo controls. Focused inventory/restock tests
  passed (28 tests). Candidate `5459fda5` passed the Cloudflare build and real
  phone browser checks for consume/Undo, one visible replacement dialog, save
  to the selected grocery list and return to the editor. Updated success-state
  screenshot inspected. Typecheck passes; changed-source lint has zero errors
  and four existing hook warnings. Nothing was merged/deployed.
- Food-photo Settings integration (#125/#144): parent inventory capture now
  resolves the existing encrypted household AI configuration before the legacy
  deployment scanner, without switching providers after a failed photo request.
  It reuses the bounded image transport, usage observer/admission and output
  parsers. The existing hourly/daily ceilings and separate receipt/package gate
  remain; revoked sessions or changed settings suppress the returned proposal.
  The picker names the selected provider and enforces its 5 MB upload limit.
  No raw image is saved and stock still requires explicit review/intake.
  Configured does not mean image-capable: unsupported models fail visibly with
  manual entry available. Local mocked-provider/API/component checks pass 145
  tests, including shared accounting, quota refusal, no fallback on bad keys,
  settings changes, no unreviewed writes and provider/size disclosure. Typecheck
  passes; changed-source lint has zero errors/five existing hook warnings.
  Candidate `1a9287be` also passed the Cloudflare production build, including
  TypeScript and Worker bundling. This does not establish a live provider call
  or rendered photo capture against that artifact.
  Real provider/model capability, privacy eligibility and hardware acceptance
  remain separate; no live provider call, key change or deployment occurred.
- Notification follow-through (#141): the current notification/quiet-hours
  suites pass (31 suites, 320 tests). Added saved-IANA-zone DST checks to the
  existing real D1 delivery fixture: both repeated Toronto 01:30 instants stay
  quiet, the end is exclusive, and spring-forward skips the nonexistent hour.
  The local Worker/D1 inbox, preferences and exact-calendar-target slices pass,
  including participant/preference races, revocation, receipt rollback,
  snooze/delete ownership and unavailable/foreign calendar targets. These slices
  can now run directly through `read-smoke.mjs --only=notification-inbox,notification-preferences,calendar-events`.
  No interruptive delivery, provider acceptance or native opening is proven.
  Source review confirms no `appUrlOpen`/`getLaunchUrl` handler and no Android
  VIEW intent registration; native cold/warm/sign-in/Back routing remains an
  implementation gap. Next native work must use the existing strict destination
  parser and current session/role readers, preserve pending forms and retain
  OS association/signing/physical-device acceptance as separate gates.
- Native notification ingress (#141/#473): the shared App plugin adapter now
  listens before reading the cold launch URL, drops stale launch results after
  a newer warm event, and cleans up late registrations. Only exact existing
  notification destinations on the two deployed HTTPS hostnames are admitted;
  credentials, ports, external origins, encoded aliases and action query data
  refuse. The root native lifecycle offers a neutral EN/ES Open/Dismiss notice
  without automatic navigation or persisted link/account data. Opening uses a
  normal document link, retaining unload guards and canonical access checks.
  Sign-in now preserves approved notification focus queries; unrelated queries
  still drop. The affected eight suites pass (122 tests), including superseded
  launch responses, unsafe links, form retention and signed-out return targets.
  Typecheck, changed-source lint and the Cloudflare build pass. This is source/component verification,
  not an installed-device journey. Android VIEW registration, domain association,
  iOS entitlements, native cold/warm/Back and current/previous binary acceptance
  remain required. No OS setting, provider, permission, signing or rollout changed.
- Android reminder registration (#138/#141/#473): the manifest now declares
  verified HTTPS filters on both supported hosts for the existing reminder
  path families, retaining the strict raw-URL validator and fresh server access
  checks. Source/merged manifest tests prevent login/API/shared routes, HTTP,
  wildcards and unrelated hosts from entering this contract. A compiled device
  test covers positive and negative package-scoped intent resolution; it does
  not prove domain verification or actual cold/warm delivery.
  Capacitor sync, 13 JVM tests, instrumentation compilation, unsigned release
  APK and AAB builds pass on JDK 21/SDK 36. The first build exhausted local disk;
  four stopped, packaged QA runtime copies were removed with archives/evidence
  preserved, then the exact Gradle gates passed on retry. Signing inputs were
  absent and explicitly unset for the retry. `connectedDebugAndroidTest` was
  attempted and failed with “No connected devices”; no device case passed.
  Production signing fingerprints,
  approved per-host Digital Asset Links publication, device acceptance and iOS
  entitlements remain separate; no native binary or association was published.
- Routine history/accessibility (#450/#499): retained legacy `approved` chores
  now count as done/checked in routine progress and cannot become the guided
  next step or an open-row completion action. No stored status, history, credit
  or permission changes. The Guided/List switch now has 44px targets, arrow/
  Home/End keyboard selection and one tab stop. Six focused suites pass (73
  tests), with typecheck and changed-source lint passing. A local browser
  component fixture passed EN/ES at all six required sizes (12 cases), checking
  truthful progress, unfinished guided selection, no document overflow and no
  completion writes on view changes; the updated Spanish phone screenshot was
  inspected with bundled app fonts. Router and data were fixtures, not a live
  backend or installed app. Exact release build/CI remains part of final QA.
  Fresh issue reads preserve unfinished profile rotation/credit/linking scope;
  existing unresolved credit/retention decisions were not inferred or bypassed.
- Calendar connection recovery (#124/#499): picker replies now require valid,
  distinct remote calendars; malformed data is not an empty-calendar result.
  Save/sync replies require the same connection and valid projection; successful
  sync counts must be nonnegative safe integers. Disconnect requires explicit
  success before removing the visible row. Malformed replies, transport failures
  and server errors retain confirmed rows and hold further controls behind the
  existing canonical refresh action. An uncertain disconnect closes only its
  confirmation dialog so recovery remains reachable; no automatic write retry.
  Provider-reported unsuccessful sync uses typed localized feedback rather than
  rendering raw result text. A refresh is an observation, not proof that an
  earlier unknown server operation stopped; no new delivery/exact-receipt claim.
  Four suites pass (34 tests), plus typecheck/lint. Local mocked-response browser
  checks pass EN/ES at all six sizes (12 cases), including hold, visible retained
  row, refresh, no repeated write and no horizontal overflow. Phone screenshot
  inspected. No live provider/OAuth/credential, external calendar or production
  change occurred; exact release build/CI and provider acceptance remain.
- Release candidate PR #622 remains separate from this continuation. Its passing
  checks do not mean it is merged or deployed.
- Start with #464/#499 connected food planning: existing D1 preview, review,
  apply and recovery code must be exercised together. The local-only runtime
  option `--exercise-connected-planning` enables food planning, weekly review
  and the two queue-owner recovery flags without enabling provider calls or mail.
- Fresh meal/prep entries now initialize an empty local draft directly; existing
  drafts and unresolved requests take precedence. Recovery-only links do not
  create a new draft. This does not send or save a meal automatically.
- Local checks: typecheck and production build passed; 28 food-planning suites
  passed (121 tests), with four existing suites/20 tests skipped. An isolated D1
  browser journey previewed, reviewed and saved a recipe-linked meal. These are
  local checks, not production activation or full feature acceptance.
- D1 smoke checks passed for food preview/review/apply/replay, grocery outcomes
  and undo, source-version guards, weekly progress/recovery, and review-inbox
  household isolation. Weekly review also passed 64 tests in nine suites.
- Candidate configuration enables food planning, weekly review and both
  queue-owner recovery flags. No production configuration has been changed.
  The updated planner component passed phone/tablet/desktop browser checks and
  preview/review/save against isolated D1 (router stubbed; backend artifact
  `6a6c0b61`). Weekly review passed start, step completion, finish and reload
  against that same isolated runtime. Before release, finish candidate
  multi-meal/prep journeys and exact-candidate CI; production approval remains
  a separate gate.
- D1 migration `0017_event_preparation_lifecycle.sql` now ports preparation
  identity, source/revision and lifecycle guards. Local native-schema checks
  cover immutable relationships, plan delete/recreate, task status changes,
  household movement and failed-batch rollback. Event/chore mutation and
  deletion, assistant deletion, review inbox and archive/export smoke checks
  passed with the migration. No production migration has run.
- Migration `0018_event_preparation_step_bounds.sql` adds canonical 1–99
  ordering and all-or-none timing-cue validation. Real D1 checks prove stable-ID
  atomic reorder and rollback to the original links/revision on failure.
  Chore reads, archive export and assistant-delete guards pass; the oversized
  legacy-data fixture explicitly restores its temporarily disabled insert guard.
- The native preparation storage check now requires all 34 source/lifecycle
  triggers on their expected tables. Parent context reads event backlinks and
  copied-routine provenance in one primary snapshot with household, role and
  session-generation checks. Chore context and personal Today now use this
  reader; fridge mode does not receive parent links. Native checks cover missing
  guards, stale sessions, foreign households and corrupt/removed routine origins.
- Preparation source projection and strict state parsing are now shared between
  PostgreSQL and D1. Native source reads use captured query witnesses and refuse
  authority/content changes before returning. The native writer commits canonical
  chores, stable preparation link identities, provenance and its replay receipt
  in one batch. Real local D1 checks pass for create/reorder/detach, stale review
  refusal, repeat receipt replay, replay after pause, failed-batch rollback and
  authority races. Domain tests: 13 suites/66 tests passed, 1 suite/8 tests skipped;
  TypeScript passed. These are local backend results, not rendered acceptance.
- Native preparation HTTP context/read/preview/write/picker/recovery now dispatch
  without PostgreSQL. Discovery preserves literal search and bounded pagination;
  inspection checks committed receipts before age, pause or target availability.
  Real D1 checks additionally pass recovery, pickers, profile pagination and
  routine-copy creation/provenance for an email-free profile. API/domain/component
  tests: 17 suites/76 tests passed, 1 suite/8 tests skipped; typecheck/lint passed.
- Built Cloudflare candidate `6741841b` and exercised its real local Worker/D1
  in Chromium: calendar event → preparation task → review/save → reload passed;
  phone/tablet/desktop sheets fit the viewport. Dropping the committed PATCH
  response then using rendered Check status recovered success with exactly one
  canonical task. Screenshots and evidence are retained under
  `artifacts/connected-family-features-20261103` beside the checkout. No external
  provider/mail/network was enabled. The preparation release flag is now enabled
  in the candidate config only; no production activation or merge has occurred.
  Profile/routine candidate flags are now enabled after the following local checks:
  mixed account/profile routine creation and duplicate-safe expansion; foreign
  profile refusal; archived profile stops new occurrences; native shared-device
  profile completion/replay and parent authorization checks. The real Worker
  phone flow created an email-free age-three profile, assigned child and parent
  steps, reviewed/saved a daily routine and retained it after reload. Removed the
  repeated review-scope paragraph seen in the screenshot (shared dialog header
  retains that explanation). Harness `--exercise-profile-routines` is local only.
  Physical-device acceptance and production rollout remain separate.
  Continue routine/profile
  parity and connected capture/review journeys through their existing issues.
  Do not bypass disabled capability checks to expose incomplete work.
- Live issue #464 reconciliation found schedule-conflict HTTP still PostgreSQL-only.
  The existing bounded planner now has native D1 context/read/preview/save/recovery.
  Complete comparison witnesses guard event identities, newly inserted conflicts,
  calendar-source status and current actor authority; event/timeline/receipt commit
  atomically. Real local D1 checks pass stale/phantom conflict refusal, canonical
  move/epoch, exact replay, cross-family and child restrictions, failed-write
  rollback, recovery after target deletion/pause, and revoked-session refusal.
  API/domain/component checks pass 16 suites/141 tests (one PostgreSQL suite/six
  tests skipped); typecheck and changed-source lint pass. The schedule readiness
  flag was subsequently enabled in candidate configuration after building
  `aa5bdc67` and testing the real local Worker/D1 calendar → timing review →
  alternative → confirm flow. Phone/tablet/desktop confirmation fit, a dropped
  committed response recovered through Check saved request, and canonical event
  times persisted after reload with duration unchanged. The phone screenshot
  exposed redundant zero-minute buffer details; confirmation now omits those
  when no buffers were entered. Production activation remains separate.
  No provider refresh, external calendar write, production migration or deployment
  was performed. Evidence: `schedule-*` in the continuation artifact directory.
- Responsibility/backup native review found real gaps in #464: hidden/filtered
  picker results incorrectly determined canonical participation, recovery loaded
  a possibly deleted target before its receipt, and source/member/feature reads
  were not all guarded at commit. Eligibility now resolves actual participants
  and requested subjects independently of bounded discovery. Scalar source reads
  (including empty eligibility sets, recurrence roots, actor/family and metadata)
  are witnessed in the effect/receipt batch; reads/recovery validate together.
  Storage readiness requires all 25 lifecycle guards on their expected tables.
  Local D1 verifies child self-acceptance, parent-recorded age-three profile intent,
  archive retirement, search/hidden-picker preservation, feature-change rollback,
  absent-guard refusal and recovery after deletion/pause/intent expiry. Revoked
  sessions cannot inspect receipts. Domain/API/components: 62 tests passed;
  eight PostgreSQL tests skipped. Expanded real D1 checks also cover pickup
  acceptance/closed refusal, handoff coordinator naming without implied consent,
  own acceptance and child/private-field isolation. Built candidate `2d91a16d`
  passed the actual browser chore → own answer → email-free backup →
  parent-recorded answer flow, including lost-response recovery and reload.
  Phone/tablet/desktop fit. The screenshot then prompted a smaller answered state:
  existing answers keep their provenance while change controls collapse, and
  technical success/link wording is replaced with plain language. Candidate
  responsibility is now enabled; production activation and exact final-candidate
  rendering/CI remain distinct. Evidence is retained as `responsibility-*` in the
  continuation artifact directory. Completed temporary runtimes were stopped and
  disposable extracted copies removed only after their archives were verified.
- Keep live Google/provider eligibility, signed native builds, physical-device
  behavior and store publication explicit. Existing source is not evidence
  those external requirements are complete.

## Historical execution basis — 2026-10-25

A fresh GitHub metadata read confirms **all seventeen foundation issues
#147–#163 are closed**. In particular, #150/#151/#152/#160/#163 are no longer
open as the older refresh below states. Do not recreate those foundation tasks
or use their historical status to block current bounded source work. Preserve
their accepted work and provenance; closure alone is not current candidate,
physical-device, restore, production or household-beta acceptance.

There are **37 open issues**. No issue is closed by this reconciliation. Queue
recovery defects #564 and #565 keep their separate original acceptance; existing
source does not prove restart/storage/concurrency behavior. The current pass
continues code and planning work only: QA, tests, builds, lint/typecheck, browser,
CI, database/migration/generation, push/merge/deployment and activation remain
deferred by Cameron. Authored fixtures are unrun source, not completion evidence.

## Work from the existing canonical slices

| Existing work | Canonical issues | Execution and dependency boundary |
| --- | --- | --- |
| Product flows and calm connected UI | #450, #480, #557, #460, #464, #499, #125, #142 | Continue existing chore/profile, recipe/capture, assistant and compact-view source through their existing plans and canonical APIs. Preserve selected Glance and act behavior. Missing original visual references are not recreated approval; source work is not rendered acceptance. |
| Shared architecture, sync, privacy and quality contracts | #134, #135, #136, #141, #144, #140, #137 | Finish bounded domain/read/write/recovery work without a second backend or queue. Keep privacy/grounding/cost/telemetry requirements separate from feature completion. Do not start deferred evaluations, scale runs or delivery. |
| Native compatibility and lifecycle | #138, #465, #473, #563, #564, #565 | Author only bounded contracts/source that do not require hardware or permission/provider activation. Keep actual binaries, current/previous server compatibility, storage faults and physical lifecycle acceptance open. |
| Household-bound summary defect | #470 | Retain the authored binding/day-claim source and explicit no-delivery state; actual two-household/concurrency acceptance must precede enabling delivery. |
| External inputs and specific owner decisions | #124, #567, #103, #104, #254, #372, #363 | Complete independent adapter/contracts/plans, but do not fabricate provider eligibility, callbacks/secrets, delivered mail, approved legacy exports, legal identity or Auto Deploy decisions. Destructive contraction/restore remains separately gated. |
| Final release and operations | #377, #139, #145, #146 | Preserve final-candidate acceptance, reusable quality gates and operations evidence as distinct work. No source checklist, closed foundation issue or old passing result authorizes a release or proves this local candidate. |
| Real household and commercial learning | #107, #108, #110 | Keep consented recruitment, four scorecards/exit interviews and packaging decisions dependent on real approved participants/evidence. Do not replace them with fabricated households or add billing. |
| Programme and checkpoint | #128 | Record exact local source identity, scoped issue progress and genuine remaining dependencies. Close only evidenced completed or redundant tracking while preserving all original requirements. |

## Selection and handoff rule

Choose a bounded unresolved requirement in the current issue/source, preserving
existing changes and original scope. Finish independent work while owner inputs
are pending. The unresolved profile deletion/credit ownership decisions in
#557/#480 must not be inferred from routine/profile source work; do not repeatedly
ask the same question. External/provider/hardware dependencies do not block
unrelated ordinary code or planning.

Before a later QA pass, retain each issue's original assertions and identify the
exact candidate and required commands/journeys under the definition of done.
After QA is resumed, its results must refer to that candidate; old results and
metadata reconciliation are not substitutes. Keep source, hosted QA, production,
physical devices and customer acceptance separate. No deployment permission is
implied by this execution order.

## Historical dependency map — not current issue status

The following 2026-10-08 sequence is preserved for dependency history. Its open/
closed assertions and execution restrictions are superseded by the current
basis above and live issue records. Do not select work from its stale status.

Issue dependencies are authoritative within the source order in `docs/START_HERE.md`. The foundation gate #147 / PR #129 is complete: #129 merged normally on 2026-09-23 as `2538499`. The sequence below preserves the original dependencies; it is not a list of currently open issues.

### Execution refresh — 2026-10-08

GitHub issue state was checked against source `bfb74e6d` before this refresh. #148/#149/#153–#159/#161/#162 are closed foundation issues; do not restart their implemented work or treat their original dependency gates as pending. #150/#151/#152/#160/#163 remain open. A closed foundation issue does not establish the broader Android, release, household-beta or product acceptance criteria.

Use the current issue records and #377 for remaining acceptance and owner dependencies. #150 now has source-linked foundations, journey maps, reference/mood studies and composition proposals; native reading-distance and composition acceptance are still open. #135 has a bounded grocery-check queue and a merged shared-board cache (#389) validated locally and in CI for API-outage restoration after the shell loads. Fully offline navigation, native WebView restart, queue metrics and broader multi-device acceptance remain open. #160/#242 retain physical Android evidence. Choose one bounded, unblocked slice from these current gaps; avoid recreating the foundation plan.

### Gate 0 — repository reconciliation

1. #147 repository foundation and source-of-truth cleanup — closed; PR #129 merged on 2026-09-23 (`2538499`).
2. #84/#85 and the remaining open #103–#108/#110 acceptance are release/security gates. #102/#109 are closed records; closing them does not establish missing production, household-beta, email or hardware evidence.

### Wave A — remove ambiguity

1. #148 route/component/domain and placeholder-data audit.
2. #149 canonical meal/recipe/grocery/list decision.
3. #150 Figma reference board and original premium visual direction.
4. #151 adaptive information architecture and five user modes.
5. #157 shared-device contract may be analysed after #147 and coordinated with #151.

#149 must follow #148. #151 must use #148 and coordinate with #150. Design analysis may overlap, but no competing data, navigation or visual contract may be implemented.

### Wave B — reusable foundations

1. #152 design tokens/components after #150.
2. #153 adaptive app shell after #151 and stable #152 direction.
3. #154 deterministic two-household fixtures; exclude unresolved meal/grocery fixture shapes until #149.
4. #155 E2E/visual/accessibility harness after #154.
5. #156 protected design/state gallery; it may begin from existing primitives but final variants follow #152.
6. #160 Android foundation may proceed as an isolated platform track; do not add kiosk/shared-session product behaviour before #157.
7. #161 narrow privacy-safe observability foundation.

### Wave C — first product verticals

1. #158 inventory backend after #147; keep its API boundary independent of unresolved meal/list decisions.
2. #159 real-data Today dashboard after #149, #151, #152 and #153. Inventory remains an explicit unavailable state until #158.
3. #162 idempotency/offline queue after #154 and #157; only explicitly approved domain actions opt in.
4. #163 original graphics after #150, integrated through #152/#156.

### Broader programme

Continue into #119–#146 only when their relevant #147–#163 foundations and #84/#85/#102–#110 gates are satisfied. Evidence-dependent implementation in #109, #110, #124–#126 and beta/commercial work must wait for the beta or usage evidence named in those issues.

### Selection rule

Choose the earliest unblocked issue that fits one reviewable PR. Split oversized work before implementation. Use `AGENTS.md`, `docs/engineering/AGENT_WORKFLOW.md` and `docs/engineering/DEFINITION_OF_DONE.md`.
