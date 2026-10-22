# Open issue completion ledger

2026-10-22 source checkpoint: AI household/person quota reservations, estimated-cost handling and parent usage/limits UI are authored with erasure/export and fail-closed pause/adoption gates. Schema/cases are unrun; #123/#144/#128 remain in progress. Details: `docs/architecture/AI_USAGE_CONTROLS.md`.

2026-10-22 AI source checkpoint: `assistant-references.ts` now binds exact canonical Today records to scoped opaque IDs/revisions, negotiates legacy-compatible provider/browser contracts and renews source catalogs before resolving app links. Cases are authored/unrun; the new gate stays off. Confirmed planning-source checks, wider version coverage, semantic evaluations, quotas and usage/cost dashboard remain #123/#144 work before consolidated QA.

2026-10-22 source checkpoint: child/teen personal chore, routine and later-history context now uses the explicit own-account projection, separate from parent links/origins. Current person/generation gates and150-ID batches are authored; cases unrun. Role/rendered/DB acceptance and remaining AI/inbox code precede consolidated release QA.

2026-10-22 source checkpoint: shared/profile online preparation labels now use the canonical board window and current subject gates, without parent capabilities or cache persistence. Reader, disposable-DB, cache and EN/ES cases are authored/unrun; no activation/release. See `docs/plans/event-preparation-v1.md`. #123/#128 remain in progress.

2026-10-22 source checkpoint: routine-copy immutable facts, personal parent chore/editor/history discovery and unrun lifecycle/isolation cases are authored. See `docs/plans/event-preparation-v1.md` and `docs/CURRENT_STATE.md`. #123/#128 remain in progress; no QA, activation or release evidence is claimed.

Updated 2026-10-18. Canonical parents: #128 and #499. This is an execution index of existing issues, not a competing roadmap or evidence of completion.

**Goal:** finish approved source and plans first, then QA one integrated candidate. No issue is closed by generating this ledger. Code, plans, activation, QA, deployment, hardware and customer acceptance are separate.

The GitHub inventory contains **82 open issues**. Older open records may already contain accepted code; reconcile original criteria before duplicating work or closing them. Source pointers below are routing evidence, not runtime acceptance.

## Sequence

1. Complete missing web behavior: personal layout/default sync, Explore favorites, full device localization, account linking and bounded app guidance.
2. Reconcile recurrence/offline recovery and all existing UI request issues against accepted and local code.
3. Complete native adapters and AI/capture/recipe provider groundwork; keep account, permission, hardware and provider activation gates explicit.
4. Update remaining architecture/operations/beta/commercial plans in their existing documents and original issues.
5. Freeze one integrated candidate; then run the applicable consolidated QA and normal release gates.

## Personalization and assistant

| Issue | Current disposition | Source / plan | Next required work |
| --- | --- | --- | --- |
| [#567 Evaluate Gemini-native family features and resolve provider eligibility](https://github.com/camster91/family-planner/issues/567) | Provider evaluation/activation dependency | docs/product/CROSS_DEVICE_ROADMAP.md; existing capture/assistant/recipe adapters | Reconcile configured Gemini-compatible adapters and eligibility; prepare evaluations without enabling a paid provider. |
| [#563 Prototype opt-in local fridge wake commands and platform voice actions](https://github.com/camster91/family-planner/issues/563) | Gated Android local draft/phrase prototype coded; native acceptance pending | docs/product/CROSS_DEVICE_ROADMAP.md; src/components/assistant/use-voice-draft.ts | LocalVoice plugin and EN/ES tap-to-listen draft input are coded, off by default. One utterance, 20-second limit, on-device recognizer only, lifecycle cancellation, no automatic submit or voice identity. Foreground phrase experiment shares the draft boundary. Native compile/device noise/lifecycle/privacy acceptance and platform-action follow-ups remain; see LOCAL_VOICE.md. |
| [#562 Finish provider-free family assistant help and guided navigation](https://github.com/camster91/family-planner/issues/562) | Local candidate, bounded documentation guide | src/lib/app-help-topics.ts; src/components/assistant/AppGuide.tsx | Extend canonical help topics as needed; this is documentation lookup, not household AI answers. |
| [#561 Finish role-aware Explore panel and feature favorites](https://github.com/camster91/family-planner/issues/561) | Local candidate | src/components/layout/ExploreBrowser.tsx; ExplorePanel.tsx | Reconcile full role/device criteria after the consolidated QA phase; retain canonical destination allowlists. |
| [#560 Personalize Today sections, order, density and preferred views](https://github.com/camster91/family-planner/issues/560) | Local account-backed candidate; consolidated QA pending | src/lib/display-preferences-server.ts; src/components/fridge/TodayLayoutEditor.tsx; docs/architecture/DISPLAY_PREFERENCES.md | Account/default APIs, revisions, inherited defaults, confirmed Save/Undo and read cache are written. Reconcile original criteria during consolidated QA; no migration/release claim. |
| [#464 Bottom-left AI chat, voice actions and private feedback reports](https://github.com/camster91/family-planner/issues/464) | Original host/action/report source mapped; exact report retry/authority coded; QA deferred | docs/product/AI_ASSISTANT.md; AssistantHost/AssistantPanel/action-client; api/assistant and api/feedback | Existing personal-only host, in-memory tabs, explicit voice, typed fixed reviewed actions/one-attempt uncertainty and private reports map to original criteria. Reports now freeze key/body/original page through retry, require nonempty receipt before clearing, renew membership/session under actor/household locks, and refuse same-key changed content without leaking earlier records. New client/server source cases unrun. Full role/feature/privacy/provider/mic/focus/responsive/endpoint/hosted/native acceptance pending; no arbitrary capability parity, provider activation or forwarding. |
| [#144 [AI Quality] Add evaluation, grounding, cost and safety gates for household AI](https://github.com/camster91/family-planner/issues/144) | References, quota/usage/cost UI source authored; planning/evaluation and QA remain | Original issue; docs/product/CROSS_DEVICE_ROADMAP.md; api/assistant/route.ts; assistant-grounding-lease.ts | Current scoped source catalogs/citations and content-free usage reservations, parent limits/reporting, conservative unknown costs, USD rate binding, pause/reply guards and erasure/export are authored with default-off gates. Unit/API/UI/disposable-DB cases are unrun. See docs/architecture/AI_USAGE_CONTROLS.md. Remaining: confirmed planning-source checks, broader generation coverage, canonical food/recipe/schedule planning and versioned semantic evaluations, then consolidated QA and authorized release. No provider activation or completion claim. |
| [#125 [Fridge Phase 7] Validate faster capture: barcode, receipt, recipe import and voice](https://github.com/camster91/family-planner/issues/125) | Atomic intake, photo/barcode review and private recognition coded; full capture incomplete | docs/product/FOOD_CAPTURE.md; inventory-intake.ts; ScanFridgeDialog | Canonical stock + pointer receipt, current actor/family/role/feature authority and exact uncertain photo-row recovery are coded; QA deferred. Barcode/typed tray, disabled public adapter and atomic private corrections are now source candidates. Manual creates now use intake recovery too. Focused package/date and receipt review are now versioned source candidates, separately off by default. Consume/discard/Undo now use atomic stock/history/receipt transactions and owned recovery. Edit/remove now share canonical primitives, reviewed versions and recovery; post-delete confirmation requires matching completed receipt proof. Link/name provenance, zero-stock exclusion and honest presence-only cooking/grocery/Today copy are now coded with bounded reader contracts. Bounded refresh/DTO readers, actor/household scope binding, stale-generation suppression and explicit failed-history recovery are now source candidates. Owned online-request recovery journal, separate canonical owner/proof and gated private negotiation are now in-progress source foundations. Canonical exact-request receipt/target review, bounded browser negotiation/readers and storage binding are now source candidates too. Gated manual/capture/stock senders, EN/ES explicit review/local dismissal/storage repair and paused-write recovery are now source candidates. Optional EN/ES foreground inventory voice/text description now proposes explicit reviewed fields through the existing canonical form, with typed fallback and no auto-save. Shared foreground description/review now also fills explicit free-text unlinked meal plans through canonical create/recovery, without selecting saved IDs or marking cooked/eaten. Direct restock review/add/Undo backend is now authored with atomic canonical list receipt, immutable inventory provenance and explicit duplicate review. Restock item/history sheet, named target/quantity/duplicate review, result/list-link/owned Undo and adopted restock-add journal/recovered review are now authored. Scoped current/captured recipe/prep stock-lot review is now authored, with expandable per-ingredient lots and explicit handoff into the existing per-lot amount/consume/recovery/Undo editor; no auto allocation or atomic recipe-consumption ledger. Restock Undo uncertainty is open-sheet retry/manual acknowledgement, not a new durable queue. Recovery support stays off; all consolidated acceptance pending. No quantity sufficiency or unit conversion is inferred. Provider licensing/eligibility and native acceptance remain separate. |
| [#123 [Fridge Phase 5] Add grounded contextual AI with confirmation-gated actions](https://github.com/camster91/family-planner/issues/123) | Initial Today/actions and weekly-reset UI/progress/owned recovery/canonical bounded summaries authored; broader coordination remains | docs/plans/weekly-reset-v1.md; docs/plans/responsibility-and-backup-v1.md; docs/product/AI_ASSISTANT.md; weekly-reset*.ts; api/coordination/weekly-reset | New provider-free weekly-review contract and gated person-only API store only own progress metadata on User, bind explicit family/Monday/zone, filter roles/features and support start/restart/review/skip/finish with revision conflicts and atomic existing receipts. Export/member-detachment compatibility source and additive migration authored; no generation/migration/activation. Pure/fake/compatibility cases unrun, not PostgreSQL proof. Bounded single-step canonical schedule/account-chore/pickup/handoff/meal/prep/portion/next-prep/food/open-grocery summary source now authored, with explicit caps/unknowns and current role/session checks; source cases unrun. Adaptive EN/ES short-sheet review/discovery and exact owned request recovery are now source-authored, with same-account command/receipt binding, expiry/current authority checks, staged-before-send immutable intents, explicit inspection/retry and partial-dismissal repair. Profile-routine and recipe-gap summaries are now source-integrated through canonical subject/stock rules, with parent-only gated profile names, own-account child/teen reads, unprepared-meal/recipe ownership/caps/expiry checks and explicit incomplete states. No autonomous grocery/routine writes. Weekly reset remains unverified; broader coordination code and all UI/role/storage/PG/browser/native acceptance remain. Responsibility/backup full design and strict pure consent planner are now source-authored (self vs parent-recorded profile, own slot, source/revision/age holds); Additive FK/schema/migration source, immutable generation/epoch/legacy invalidation and lifecycle retirement, typed state CAS, scoped export and explicit household-delete compatibility are now authored; all unrun. Gated authenticated person API/atomic minimal receipts/owned recovery are now source-authored with current identity/role/source locks, explicit retry and no cached privileged DTO. Compact EN/ES canonical chore/Today/pickup/handoff controls, separate self/profile-parent-recorded statements, backup/coordinator previews and bounded people search, exact pending request UI/inspection/retry/forget, synchronous close guards and stage-versus-dismissal repair are now source-authored. Gated weekly-review target references and bounded current statement previews use separate authorized transactions; fridge/child handoff controls are hidden and no owner context is seeded into layout props. Deleted-target recovery stays independent of target reads; proof requires fresh current read. UI/navigation/storage cases are authored and unrun. Real DDL/PG/concurrency/client compatibility and all QA are unverified. Schedule conflict full contract and strict owner/snapshot-bound pure planner source are now authored: explicit preparation/travel/search windows, half-open actual/buffer-only constraints, three closest gap alternatives, exact duration/instant semantics and partial/role/source/recurrence holds. Planner cases are unrun. Additive Event generation/material epochs, immutable/monotonic legacy-writer trigger/index source, scoped source locks/probes/reads and an internal single-statement whole-range comparison plus canonical time-update primitive are now authored, avoiding a shared collection lock. Range/zone are bound explicitly; selected epoch/family/source/duration are rechecked. Unit/disposable-DB cases are authored and unrun. This helper is not an API and requires fresh candidate/actor/household authority plus same-transaction receipt. Authenticated person snapshot/preview/apply and minimal atomic receipt/replay/owned recovery source are now authored. Current role/token/family/feature/source/candidate/age checks, all-source status/freshness/500-record/100-source coverage, source-metadata fingerprint/atomic comparison, exact bounded browser journal and readonly inspected retry are explicit; no provider refresh or attendance inference. New readiness stays off and existing recovery/rollback gates remain. Runtime/server/client/recovery cases and a new-source atomic-refusal DB case are authored and unrun. Compact EN/ES concrete-event conflict controls, explicit target/other buffers and multi-window search, three options/exact preview, owned stage/pending/close/dismiss/storage repair and calendar/weekly discovery are now source-authored. Strict gap/fold handling, original offset/precision, source changes, child read-only, default fridge omission and pause-time personal recovery are explicit. Weekly state remains mounted while its dialog/scroll/focus ownership is suspended for the child review; confirmed proof refreshes canonical calendar/weekly reads without marking progress. Form/navigation/privacy/recovery/role/draft cases are authored and unrun. Recurrence occurrence/series scope and coverage remain held/open under canonical #124; all real PG/concurrency/lifecycle/client/rendered/native/release acceptance is unverified. Full grounded planning/event-prep/review-inbox/what-changed and #144 telemetry/stale-record requirements remain; provider #567 is separate from internal code. QA/release deferred. |

## Identity and member compatibility

| Issue | Current disposition | Source / plan | Next required work |
| --- | --- | --- | --- |
| [#557 Verified account linking for email-free household profiles](https://github.com/camster91/family-planner/issues/557) | Local source candidate; consolidated QA/activation pending | docs/architecture/PROFILE_ACCOUNT_LINKING.md; src/lib/profile-account-link.ts; src/app/api/family/profile-links/route.ts; src/components/family/ProfileAccountLinkManager.tsx | Parent issuance, owner password/email proof, parent approval, alias-preserving history transaction, expiry/revoke/replay and EN/ES sheets coded. Generate/migrate and exercise the full two-household/lifecycle/client matrix during later QA; keep new gate off. |
| [#480 Support email-free household profiles without granting login identity](https://github.com/camster91/family-planner/issues/480) | Dormant profile foundation + local UI | src/lib/household-profile-http.ts; src/components/family/ProfileSetupPanel.tsx | Complete domain/client compatibility before activating profile flags; no synthetic email/login. |
| [#473 Define native web/API compatibility and all-device release capability contract](https://github.com/camster91/family-planner/issues/473) | Existing capability/identity source reconciled; candidate matrix pending | src/app/api/capabilities/route.ts; src/lib/native-app.ts; docs/architecture/NATIVE_API_COMPATIBILITY.md | Protocol metadata, installed identity helper and exact candidate evidence contract exist. No protocol-2/minimum-native claim. Later QA must fill current/previous binary, web/API/schema and rollback matrix; #564 recovery remains opt-in and unverified. |
| [#254 [Data] Contract legacy meal/shopping tables (ADR-0007) — gated](https://github.com/camster91/family-planner/issues/254) | Scope reconciliation pending | Original issue; docs/product/CROSS_DEVICE_ROADMAP.md | Read original issue and current source, preserve accepted work, then implement the missing bounded slice or document its exact external dependency. |
| [#134 [Platform Architecture] Refactor backend domains, APIs and data contracts for long-term scale](https://github.com/camster91/family-planner/issues/134) | Scope reconciliation pending | Original issue; docs/product/CROSS_DEVICE_ROADMAP.md | Read original issue and current source, preserve accepted work, then implement the missing bounded slice or document its exact external dependency. |

## Native and shared device

| Issue | Current disposition | Source / plan | Next required work |
| --- | --- | --- | --- |
| [#565 Retry recovered earlier queue stores without losing pending changes](https://github.com/camster91/family-planner/issues/565) | Existing bounded retry source reconciled; combined QA pending | src/lib/offline-queue.ts fallbackQueueStore; existing source commit 391844c9; docs/architecture/NATIVE_API_COMPATIBILITY.md | Current authority is tried first, then every other candidate including earlier ones; all readable copies are compared and divergent snapshots fail closed. Existing test source covers fallback-to-primary retry. Exercise recovery/concurrency matrix in later QA; #564 remains a separate durable retirement gap. |
| [#564 Prevent stale pending-work resurrection after failed storage purge](https://github.com/camster91/family-planner/issues/564) | Owned recovery and explicit legacy bridge coded; consolidated QA pending | src/lib/queue-owner-store.ts; src/lib/owned-queue-persistence.ts; src/components/ui/recovered-queue-changes.tsx; docs/architecture/QUEUE_OWNER_RECOVERY.md | Owner-qualified retirement, Web Locks, exact failed intents, canonical EN/ES review and deliberate v1 keep/discard bridge are coded. Original keys/bodies/times retained; unknown-origin device creates locked; copied source retired only after verified persistence. Focused fault-test source added, unexecuted. Exercise actual browser/native/old-reader races and rollback in consolidated QA; keep rollout off. |
| [#466 Add bundled native offline startup recovery for phones and shared tablets](https://github.com/camster91/family-planner/issues/466) | Existing scoped startup-recovery source reconciled; QA pending | capacitor.config.ts; public/native-offline.html | Bundled self-contained page, trusted personal/device links, errorPath and Android Back rules exist. No household snapshot or cold-offline write access. Later sync/build/device offline/process-death/previous-client QA remains; no new replacement implementation needed. |
| [#465 Prepare iPhone app and shared native lifecycle and sharing foundation](https://github.com/camster91/family-planner/issues/465) | Scoped iOS/lifecycle/share source reconciled; native QA pending | ios/; docs/architecture/ANDROID.md; docs/product/CROSS_DEVICE_ROADMAP.md | SPM project and guarded App/Network/Share helpers are wired to resume, offline indicators and explicit sitter-link sharing. Scoped foundation exists. Signing, physical lifecycle acceptance and native builds remain; voice/push/widgets/verified links are separate roadmap work, not missing foundation criteria. |
| [#445 Localize complete parent device management and pairing presentation](https://github.com/camster91/family-planner/issues/445) | Original device presentation source mapped; pairing lifecycle guards coded; QA deferred | docs/architecture/PARENT_DEVICE_LOCALIZATION.md; DevicesManager.tsx; PairTabletDialog.tsx; device-management.ts | Typed EN/ES management/pairing/helpers/missing-household and own-property audit source map to original requirements. Attempt generations now prevent late create/poll/confirm/replacement results from changing a closed/expired/reopened dialog, stop closed polling/countdown and single-flight operations; an abandoned create cancels only its own late-returned code. Functional step guards preserve queued expiry. Fabricated lifecycle source cases authored but unrun. Full mounted locale/native focus/private/role/timer/replacement/ordinary-expanded/build/hosted/gallery/served/hardware/store/customer acceptance remains pending; no protocol/auth/rollout changes. |
| [#371 Android: test the offline page on a real phone, then turn it on in the app](https://github.com/camster91/family-planner/issues/371) | Code / platform reconciliation pending | android/; ios/; docs/product/CROSS_DEVICE_ROADMAP.md | Reconcile current canonical native/session/offline source; finish missing adapters; record signing/hardware dependencies separately. |
| [#370 [Owner] Turn the Android APK build workflow back on](https://github.com/camster91/family-planner/issues/370) | Code / platform reconciliation pending | android/; ios/; docs/product/CROSS_DEVICE_ROADMAP.md | Reconcile current canonical native/session/offline source; finish missing adapters; record signing/hardware dependencies separately. |
| [#242 [Shared Device] Android integration for device sessions](https://github.com/camster91/family-planner/issues/242) | Code / platform reconciliation pending | android/; ios/; docs/product/CROSS_DEVICE_ROADMAP.md | Reconcile current canonical native/session/offline source; finish missing adapters; record signing/hardware dependencies separately. |
| [#160 [Android Foundation] Replace sample Android tests and prove production-style AAB/lifecycle baseline](https://github.com/camster91/family-planner/issues/160) | Code / platform reconciliation pending | android/; ios/; docs/product/CROSS_DEVICE_ROADMAP.md | Reconcile current canonical native/session/offline source; finish missing adapters; record signing/hardware dependencies separately. |
| [#138 [Android / Play Store] Ship a high-quality production Android app with store, signing and policy readiness](https://github.com/camster91/family-planner/issues/138) | Native code + external store/signing acceptance | android/; ios/; docs/product/CROSS_DEVICE_ROADMAP.md | Finish source readiness; signing, store account processing and physical-device acceptance cannot be replaced by a plan. |
| [#135 [Sync & Offline] Build reliable realtime multi-device sync with offline-first household actions](https://github.com/camster91/family-planner/issues/135) | Code / platform reconciliation pending | android/; ios/; docs/product/CROSS_DEVICE_ROADMAP.md | Reconcile current canonical native/session/offline source; finish missing adapters; record signing/hardware dependencies separately. |
| [#133 [Adaptive UI] Build premium tablet + phone layouts that scale across Android form factors](https://github.com/camster91/family-planner/issues/133) | Code / platform reconciliation pending | android/; ios/; docs/product/CROSS_DEVICE_ROADMAP.md | Reconcile current canonical native/session/offline source; finish missing adapters; record signing/hardware dependencies separately. |
| [#120 [Fridge Phase 2] Make Android behave as a dependable household appliance](https://github.com/camster91/family-planner/issues/120) | Code / platform reconciliation pending | android/; ios/; docs/product/CROSS_DEVICE_ROADMAP.md | Reconcile current canonical native/session/offline source; finish missing adapters; record signing/hardware dependencies separately. |

## UI and household workflows

| Issue | Current disposition | Source / plan | Next required work |
| --- | --- | --- | --- |
| [#536 Keep recurring chore anchors and make stopping explicit](https://github.com/camster91/family-planner/issues/536) | Original source criteria mapped; late-session write gap coded; QA deferred | docs/plans/chore-series-lifecycle-reconciliation.md; src/app/api/chores/route.ts | Existing exact-row deletion, active/stopped anchor guards, explicit parent Stop/Save, typed EN/ES and authored lock/viewport cases map to original acceptance. DELETE and edit/stop PATCH now recheck session generation under actor-user then household locks before mutations. PATCH renews assignee membership/subject protection and applies frequency edits to locked current cadence/root/weekdays. Revoked requests return 401; stale subject/assignee writes refuse. Fake/real held-lock cases include revocation and Stop after concurrent series creation; source is authored but unrun. Preserve ordinary assignee rights, anchor 409s, history/cadence, profile/scheduled-routine boundaries and server guards on UI rollback. All runtime/rendered/DB/device/CI and release acceptance remains deferred. |
| [#499 Align all 22 features and supporting flows across roles and devices](https://github.com/camster91/family-planner/issues/499) | UI implementation in progress | design/APPROVED_UI_ROLLOUT.md; docs/CURRENT_STATE.md | Reconcile all 22 feature/supporting rows with actual source, finish missing behavior, then consolidate QA. |
| [#463 Personal notification snooze and resume](https://github.com/camster91/family-planner/issues/463) | Acceptance criteria mapped to existing source; QA deferred | docs/product/NOTIFICATION_SNOOZE.md; notifications/snooze/route.ts; notifications/page.tsx | Source re-read 2026-10-20: all four fixed durations, atomic personal ownership, nullable timestamp plus idempotent migration, active/Snoozed separation, local return time/Show now, unread return, legacy GET filtering and existing delete/Undo are present. Paired-route denial and mounted/route tests exist, unrun in this implementation pass. No scheduler or push/email claim; transport uncertainty reloads canonical inbox rather than silently repeating snooze. Existing 50-row read cap and multi-device/device/browser acceptance remain for consolidated QA. No duplicate implementation added. |
| [#462 Today quick actions and compact controls](https://github.com/camster91/family-planner/issues/462) | Original toolbar criteria mapped to existing source; QA deferred | docs/plans/today-controls-and-event-duration-reconciliation.md; TodayControls.tsx; TodayBoard.tsx | Canonical event/chore/grocery/meals/all-list shortcuts follow parent/teen/child and server feature links. Compact Refresh/features/Settings disclosure uses 44px targets, wrapping, Escape/focus restoration and offline refresh refusal. Mounting excludes fridge mode, devices and absent person viewers. Existing typed EN/ES, role, feature, mounting and dismissal source cases are identified but unrun; rendered/device/offline acceptance remains pending. Personalization/Explore retain their separate issues. |
| [#461 Make Today Groceries open grocery lists and distinguish all shared lists](https://github.com/camster91/family-planner/issues/461) | Original destination/count criteria mapped to existing source; QA deferred | docs/plans/today-controls-and-event-duration-reconciliation.md; lists/groceries/page.tsx; regions.tsx; today-board-data.ts | Current-account household resolver handles zero/one/multiple grocery lists without writes; card/header/overflow and separate All shared lists destinations are source-wired. Today explicitly requests grocery-only counts while generic Shopping keeps its grocery+shopping default. Filtered overview labels/create/back context use typed EN/ES. Existing resolver/query/tile/list/role/device/tick-undo cases are identified but unrun; actual-route and consolidated QA remain pending. |
| [#460 Explore online recipes, import readable previews and save household recipe box](https://github.com/camster91/family-planner/issues/460) | Curation, search, history, direct reuse and cooking-stock handoff coded; QA pending | src/lib/recipe-search.ts; src/lib/recipe-write.ts; docs/product/RECIPE_DISCOVERY.md | Durable source + household-locked duplicate check, Open saved/Edit or explicit copy, named collections/favorites, composite household FKs, revision/timestamp guards and export/erasure wiring are coded. Generate/apply additive schema only in later integrated QA. Prepared recipe snapshots/read-only history and export are now coded, with legacy sessions explicitly unrecorded. Direct saved-recipe meal/prep entry, keyed ordinary meal create/Undo, cooking-portion preview and matching grocery target/recovery ownership are coded. Explicit parser truncation/missing-data review, retained over-limit draft and unknown imported servings are coded. Single/all supported-source discovery, attribution and partial-outage recovery are coded; the current #460 matrix records scope/limits. Reconcile remaining cross-issue source work, then integrated acceptance; optional AI stays under #567 eligibility. |
| [#459 Align Today dashboard cards and reduce empty stretched space](https://github.com/camster91/family-planner/issues/459) | Existing/local source; acceptance reconciliation pending | design/APPROVED_UI_ROLLOUT.md; docs/CURRENT_STATE.md | Reconcile Today alignment with this issue's original criteria; implement only missing behavior before final QA. |
| [#458 Add duration controls to calendar event forms](https://github.com/camster91/family-planner/issues/458) | Original duration criteria mapped to existing source; QA deferred | docs/plans/today-controls-and-event-duration-reconciliation.md; EventDuration.tsx; dates.ts; calendar create/edit forms | All six presets and bounded integer custom minutes derive canonical end instants from start; switching back retains manual end. Existing helper preserves unchanged edit precision/fold and adds elapsed duration across midnight/DST. Typed EN/ES, labelled 44px controls, live preview and imported-source read-only view are source-wired. Date/create/edit-instant cases are identified but unrun; full rendered/localization/role/device acceptance remains pending. No API/schema change. |
| [#456 Add a compact connections menu beside calendar sources](https://github.com/camster91/family-planner/issues/456) | Original connection-menu criteria mapped; QA deferred | docs/plans/calendar-connections-and-form-sheets-reconciliation.md; CalendarPlanner.tsx; SettingsClient.tsx | Existing parent-only source disclosure links to configured Google/Outlook or read-only calendar subscriptions in canonical Settings. Loading/hash-aware Settings group/disclosure/scroll handling, typed EN/ES and semantic 44px/focus/wrapping styles are present. Role/configuration/localization/delayed-anchor source cases identified but unrun. No new OAuth/token/provider/API/permission path. Actual routes/device/provider acceptance and #369 owner accounts remain separate. |
| [#455 Use contextual rounded sheets for list and chore forms](https://github.com/camster91/family-planner/issues/455) | Original sheet/disclosure criteria mapped; chore shell localization coded; QA deferred | docs/plans/calendar-connections-and-form-sheets-reconciliation.md; docs/product/FORM_SHEETS.md; DashboardFormSheets.tsx | Existing canonical list/chore forms use route-backed rounded overlays with inert background, focus/scroll restoration, pending navigation and null slot clearing; standalone routes and prefills remain. Consolidated #453 maps essential fields plus mounted optional summaries/invalid expansion and canonical schedule behavior. Chore sheet titles/close/draft/save-upload notices now use typed EN/ES via the same canonical forms/busy callbacks; wrapper cases authored but unrun. Full actual Next interception/Back/reload, form/upload/role/series, responsive/accessibility/native and consolidated QA remain pending. |
| [#454 Add private household images to list creation and display](https://github.com/camster91/family-planner/issues/454) | Original cover criteria mapped; transaction/session gap coded; QA deferred | docs/plans/custom-lists-and-private-covers-reconciliation.md; ListImagePicker.tsx; api/lists/create/route.ts; upload-housekeeping.ts | Existing folded private upload/preview/replace/remove, saved overview/detail covers, nullable additive schema and cleanup reference/locked recheck are source-wired. Creation now shares actor/household locks and current member/role/token checks with no-cover creation; image ownership reads through the same transaction delegate. Fake and disposable-Postgres authority/cleanup-order/uncommitted-upload source cases authored but unrun. UI/file-isolation/quota/role/migration/type/build and full rendered/native acceptance deferred. No eager deletion/new service/public URLs. |
| [#452 Allow same-day chores after UTC midnight in local timezones](https://github.com/camster91/family-planner/issues/452) | Original criteria mapped to existing source; QA deferred | CreateChoreForm.tsx; use-hydrated.ts; take-turns-form.test.tsx | Create date min uses hydration-safe useTodayKey with no pre-hydration guess; submit keeps the selected date. Existing mounted source case covers Toronto evening after UTC midnight. Edit remains without a minimum. Weekly controls use selected weekdays with optional start, not mandatory due date. No new API/schema; no current test/build/live proof claimed. |
| [#451 Collapse repeating chores into schedule rows in Week and All](https://github.com/camster91/family-planner/issues/451) | Original grouping/action contract mapped to existing source; QA deferred | chore-series-groups.ts; RecurringChoreRows.tsx; chores/page.tsx; ChoresContent.tsx | Group key is household + recurrence_id, never title; canonical scoped template frequency/weekdays are serialized because copies are once. Week/All use native disclosure and loaded count/next/cadence, Today renders individual actions. Expanded rows retain their own existing action payloads; durable stacks retain stack/date identity, filters/check/history paths remain. Existing source tests mapped; no rendered or API acceptance run. |
| [#450 Routines for everyone: ordered chore stacks and habit-stacking controls](https://github.com/camster91/family-planner/issues/450) | Integrated future-routine source authored; lifecycle/UI reconciliation remains, QA deferred | docs/plans/routine-schedule-v1.md; docs/CURRENT_STATE.md; routine-schedule-runtime.ts; routine-independent-runtime.ts | Authored shared and independent future schedule/edit/pause/resume/stop flows renew parent/token/family/features/subjects under locks, bind exact intent/version/day to atomic receipts and preserve started work/history/evidence. Canonical bounded expansion handles known metadata; inactive/unknown definitions and legacy future writes hold. Private parent catalogs/editors, EN/ES review, independent legacy handoff, owned exact-request recovery and durable partial drafts are source-wired with conflict/discard/repair/hidden-points rules; only originating drafts clear on confirmation. Verified same-person link/erasure rewrites exact private future aliases and invalidates versions; stored-only tombstones require explicit replacement. Account deletion retains future plans on anonymous retired controls while personal rows are deleted, preserving surviving occurrence/credit identities and exact stack order. A handover-only once checkpoint recovers after write pause, settles occupied/missed slots and never enrolls ordinary deleted once work. Focused and protected DB cases are authored but unrun. Archived own-household unlinked profile history now has compatible read projection and explicit inactive actions, with separate active verification guards and EN/ES archive reasons; new cases are unrun. Profile edit/archive and membership removal now invalidate exact prepared routine versions without reassignment or repeated replay effects; historical personal-root discovery/handover covers accounts with no current household. Actual account role/token/family remain authoritative. New cases are unrun. Historical message/audit erasure now discovers locked scopes, redacts exact member/actor/read references and queues sent-message files post-commit while retaining household photos; focused/current/historical source cases are unrun. Dashboard-link navigation now flushes the owned draft, awaits sentinel release and checks controller visibility/epoch before leaving; dirty Back protection persists through storage errors, and repair refs avoid stale foreground overwrite. Link-handler cases are authored but unrun. Personal import-target provenance now joins sorted historical household locks and is removed by exact model/id pairs in bounded predicates before personal cascades, preserving other-model/household collisions; current/former-member cases are authored but unrun. Remaining: other non-FK field reconciliation, link/rollout, programmatic/non-link navigation and remaining async boundaries, and full rendered/native/EN/ES/device/lifecycle acceptance. All QA/typecheck/build/schema/client/native/CI and release validation remain deferred; rollout gates unchanged. Not complete or activated. |
| [#449 Choose one or multiple weekdays for weekly chores](https://github.com/camster91/family-planner/issues/449) | Weekday source mapped; optional start-date gap coded; QA pending | CreateChoreForm.tsx; EditChoreForm.tsx; chore-weekdays.ts; recurringChores.ts | Seven labelled multi-select choices and required selection, current template metadata, UTC date-only generation/legacy seven-day cadence, series/rotation path and additive weekly_days source are present. Create now offers collapsed EN/ES optional Start later; account/rotation/profile payloads use the first selected day on/after that date. Existing mounted future-start case authored; all exact schema/client/DB/rendered/native acceptance deferred. No API field, migration execution or scheduler. |
| [#448 Fix unreadable native dropdown options in dark mode app-wide](https://github.com/camster91/family-planner/issues/448) | Identified native/custom surfaces reconciled; foreground gaps coded; QA deferred | docs/plans/native-select-source-inventory.md; globals.css; Dialog/LongPressRow/DashboardNav/CommandPalette/ProjectDetailActions | Inventory maps 69 native selects in 45 non-test TSX files plus the RoutineFields datalist and custom menu/disclosure/dialog implementations. Datalist options now share solid themed option colors; account/project/command/action/shared-dialog containers pair explicit primary foreground with elevated surfaces while preserving action/danger/disabled colors. Source menu/role/anchored-popup/suggestion scans are documented with lexical limits. Actual compiled CSS/contrast/closed-open/keyboard/light-dark/role/device and Android/Windows popup proof remains deferred; no behavior/API/schema/data/permission changes. |
| [#447 Add general-purpose Custom lists to household lists](https://github.com/camster91/family-planner/issues/447) | Original Custom criteria mapped; locked create authority coded; QA deferred | docs/plans/custom-lists-and-private-covers-reconciliation.md; CreateListForm.tsx; api/lists/create/route.ts; list-type-filter.ts | Custom is selectable and accepted by shared/server types, with literal names and typed EN/ES overview/filter/empty presentation. Existing plain-checklist/item behavior and single-flight form submission remain; no new replay guarantee. All creates now renew membership/create-role/session under actor then household locks, including no-cover requests. New stale-authority source cases unrun; full custom/API/role/item/localization/rendered/CI acceptance pending. |
| [#446 Prompt adding all household members after family creation](https://github.com/camster91/family-planner/issues/446) | Original Add Everyone criteria mapped; immediate create/readback guards coded; QA deferred | docs/plans/family-onboarding-source-reconciliation.md; OnboardingFlow.tsx; family/create/page.tsx | Canonical dashboard/standalone flow reaches Add Everyone after confirmed/reconciled family creation, with explicit account-role invite controls, optional gated no-login profiles and finish later. Immediate ref guard prevents same-turn duplicate POST; composing Enter is ignored. Read-only membership reconciliation bounds fetch+body and late results cannot advance after timeout. Source cases authored but unrun. Full creation/invite/role/profile/roster/locale/history/rendered/native acceptance deferred; no automatic invitation or activation. |
| [#443 Localize mounted Settings, calendars and parent controls](https://github.com/camster91/family-planner/issues/443) | Original owned source mapped; subscription load recovery coded; QA deferred | docs/testing/SETTINGS_LOCALIZATION.md; settings-copy.tsx; SettingsClient/CalendarSubscriptionsSection/CalendarSyncSection/SharedDeviceSettings/BetaMetricsSwitch | Typed EN/ES, stable load effects and semantic/raw feedback source map to original mounted draft/busy/private/no-replay requirements. Subscription list reads now distinguish failure from empty, catch network/JSON/HTTP/malformed-list failure, offer explicit single-flight GET retry and retain editable drafts while holding add until a valid snapshot. New recovery cases and existing actual-selector/role/credential/callback/timer/key source are unrun. Historical artifact counts are not current proof; exact copy-manifest/scanner, ordinary/expanded build/browser/device/hosted/protection/merge/gallery gates remain required. No provider/policy/credential/rollout or migration-manifest change. |
| [#376 Later: month grid for tablet and desktop](https://github.com/camster91/family-planner/issues/376) | Local month-grid candidate | src/lib/calendar-planning/view.ts; src/app/dashboard/calendar/CalendarPlanner.tsx | Retain 42-cell bounded reads, monthly navigation, Day details and partial/error states; evaluate in the final QA pass. |
| [#163 [Graphics] Create the original Family Planner app icon + illustration/empty-state visual language](https://github.com/camster91/family-planner/issues/163) | Scope reconciliation pending | Original issue; docs/product/CROSS_DEVICE_ROADMAP.md | Read original issue and current source, preserve accepted work, then implement the missing bounded slice or document its exact external dependency. |
| [#152 [Design System] Align production tokens/components with the approved Figma foundations](https://github.com/camster91/family-planner/issues/152) | Scope reconciliation pending | Original issue; docs/product/CROSS_DEVICE_ROADMAP.md | Read original issue and current source, preserve accepted work, then implement the missing bounded slice or document its exact external dependency. |
| [#150 [Design] Build the Figma reference board and lock the premium visual direction](https://github.com/camster91/family-planner/issues/150) | Scope reconciliation pending | Original issue; docs/product/CROSS_DEVICE_ROADMAP.md | Read original issue and current source, preserve accepted work, then implement the missing bounded slice or document its exact external dependency. |
| [#142 [Internationalization] Make dates, language, units and layouts localization-ready from the start](https://github.com/camster91/family-planner/issues/142) | Scope reconciliation pending | Original issue; docs/product/CROSS_DEVICE_ROADMAP.md | Read original issue and current source, preserve accepted work, then implement the missing bounded slice or document its exact external dependency. |
| [#132 [UX Architecture] Redesign information architecture, onboarding and core household journeys](https://github.com/camster91/family-planner/issues/132) | Scope reconciliation pending | Original issue; docs/product/CROSS_DEVICE_ROADMAP.md | Read original issue and current source, preserve accepted work, then implement the missing bounded slice or document its exact external dependency. |

## Operations and activation

| Issue | Current disposition | Source / plan | Next required work |
| --- | --- | --- | --- |
| [#470 Bind morning-summary email to original household through delivery](https://github.com/camster91/family-planner/issues/470) | Plan / operator dependency reconciliation pending | docs/runbooks/; original issue | Read current implementation/configuration and original acceptance; prepare exact remaining plan/code; keep production/provider/scheduler decisions separate. |
| [#372 Finish the Herewoven rename: legal pages, emails, Settings and the sender name](https://github.com/camster91/family-planner/issues/372) | Plan / operator dependency reconciliation pending | docs/runbooks/; original issue | Read current implementation/configuration and original acceptance; prepare exact remaining plan/code; keep production/provider/scheduler decisions separate. |
| [#369 [Owner] Create the Google and Microsoft sign-in apps for calendar sync](https://github.com/camster91/family-planner/issues/369) | Owner/provider account dependency | src/lib/calendar-sync/; docs/product/CROSS_DEVICE_ROADMAP.md | Prepare exact OAuth callbacks/scopes/configuration; Cameron supplies approved provider apps/credentials through protected storage. |
| [#368 [Owner] Turn on the morning summary](https://github.com/camster91/family-planner/issues/368) | Plan / operator dependency reconciliation pending | docs/runbooks/; original issue | Read current implementation/configuration and original acceptance; prepare exact remaining plan/code; keep production/provider/scheduler decisions separate. |
| [#367 [Owner] Set TRUSTED_PROXY_HOPS in production](https://github.com/camster91/family-planner/issues/367) | Plan / operator dependency reconciliation pending | docs/runbooks/; original issue | Read current implementation/configuration and original acceptance; prepare exact remaining plan/code; keep production/provider/scheduler decisions separate. |
| [#366 [Owner] Add the support email address](https://github.com/camster91/family-planner/issues/366) | Owner decision | src/lib/support.ts | Cameron chooses the support address; never invent a deliverable inbox. |
| [#365 [Owner] Turn on daily backups and prove a restore works](https://github.com/camster91/family-planner/issues/365) | Operations acceptance and specific scheduler approval | docs/runbooks/BACKUPS.md | Reconcile existing backup configuration and restore evidence; do not add a new scheduler without exact authorization. |
| [#364 [Owner] Smoke-test the live site after the next deploy](https://github.com/camster91/family-planner/issues/364) | Plan / operator dependency reconciliation pending | docs/runbooks/; original issue | Read current implementation/configuration and original acceptance; prepare exact remaining plan/code; keep production/provider/scheduler decisions separate. |
| [#363 [Owner] Decide on Coolify Auto Deploy](https://github.com/camster91/family-planner/issues/363) | Plan / operator dependency reconciliation pending | docs/runbooks/; original issue | Read current implementation/configuration and original acceptance; prepare exact remaining plan/code; keep production/provider/scheduler decisions separate. |
| [#342 Prepare Family Planner database migration into Coolify](https://github.com/camster91/family-planner/issues/342) | Plan / operator dependency reconciliation pending | docs/runbooks/; original issue | Read current implementation/configuration and original acceptance; prepare exact remaining plan/code; keep production/provider/scheduler decisions separate. |
| [#146 [Operations & Support] Prepare customer support, incident response, account recovery and public-scale operations](https://github.com/camster91/family-planner/issues/146) | Plan / operator dependency reconciliation pending | docs/runbooks/; original issue | Read current implementation/configuration and original acceptance; prepare exact remaining plan/code; keep production/provider/scheduler decisions separate. |
| [#145 [Developer Platform] Harden CI/CD, environments, migrations and release automation](https://github.com/camster91/family-planner/issues/145) | Plan / operator dependency reconciliation pending | docs/runbooks/; original issue | Read current implementation/configuration and original acceptance; prepare exact remaining plan/code; keep production/provider/scheduler decisions separate. |
| [#141 [Notifications] Build useful, restrained reminders, deep links and background delivery](https://github.com/camster91/family-planner/issues/141) | Plan / operator dependency reconciliation pending | docs/runbooks/; original issue | Read current implementation/configuration and original acceptance; prepare exact remaining plan/code; keep production/provider/scheduler decisions separate. |
| [#137 [Reliability] Define SLOs, observability, performance budgets and scale tests for millions-ready growth](https://github.com/camster91/family-planner/issues/137) | Plan / operator dependency reconciliation pending | docs/runbooks/; original issue | Read current implementation/configuration and original acceptance; prepare exact remaining plan/code; keep production/provider/scheduler decisions separate. |
| [#136 [Security & Privacy] Build a consumer-grade trust model for households, children and shared devices](https://github.com/camster91/family-planner/issues/136) | Plan / operator dependency reconciliation pending | docs/runbooks/; original issue | Read current implementation/configuration and original acceptance; prepare exact remaining plan/code; keep production/provider/scheduler decisions separate. |
| [#104 [P0][Migration] Reconcile approved ChoreChamps, Meal Planner, and Budget exports](https://github.com/camster91/family-planner/issues/104) | Plan / operator dependency reconciliation pending | docs/runbooks/; original issue | Read current implementation/configuration and original acceptance; prepare exact remaining plan/code; keep production/provider/scheduler decisions separate. |
| [#103 [P0][Email] Configure and prove verification and password recovery delivery](https://github.com/camster91/family-planner/issues/103) | Plan / operator dependency reconciliation pending | docs/runbooks/; original issue | Read current implementation/configuration and original acceptance; prepare exact remaining plan/code; keep production/provider/scheduler decisions separate. |

## Release and household acceptance

| Issue | Current disposition | Source / plan | Next required work |
| --- | --- | --- | --- |
| [#566 Plan native household finance views for preserved imported records](https://github.com/camster91/family-planner/issues/566) | Requested plan authored; advanced product slices remain planned | docs/plans/finance-archive-product.md; schema.prisma; imports/budget-app.ts; imports/persist-budget-app.ts | Current native budget APIs/Float/USD/UTC limits, all 11 archive source keys, provenance, parent export/erasure are mapped. FIN-0 through FIN-7 separately scope archive/money bridge, accounts, bills/payments, goals/contributions, income schedules, receipt references, daily periods and no-spend views, with exact currency/date, isolation, reviewed adaptive UI and additive promotion/rollback contracts. No new finance model/API or archive promotion claimed; bank/OCR/spend/live imports remain outside this planning issue. No QA or real finance data access. |
| [#377 Launch to-do: what is left before real families (Oct 2026)](https://github.com/camster91/family-planner/issues/377) | Plan / acceptance reconciliation pending | docs/FRIDGE_TABLET_PROGRAM.md; docs/engineering/DEFINITION_OF_DONE.md | Read the original issue and reconcile its named source, evidence and external dependencies; prepare missing code/plans without claiming acceptance. |
| [#140 [Analytics & Growth] Define privacy-safe activation, retention, experimentation and product learning](https://github.com/camster91/family-planner/issues/140) | Existing count source mapped; reporting scope coded; additional collection remains review-gated | docs/product/PRODUCT_MEASUREMENT.md; beta-metrics.ts; beta-scorecard.ts | All requested metrics/funnels map to current evidence or explicit not-collected denominators. Versioned scorecard JSON/text distinguishes D-6 count statuses from ordered/cohort/beta acceptance; recording remains opt-in, best-effort, content-free. Event owners/replay limits, prohibited fields, retention/erasure, experiment and research policy documented. Authored test source, no QA/collection expansion/provider/activation. Future counters need reviewed consent/schema/disclosures and exact dedup/denominator design; no unavailable measure is claimed implemented. |
| [#139 [QA & Accessibility] Build automated journey, visual, accessibility and device-quality gates](https://github.com/camster91/family-planner/issues/139) | Existing QA infrastructure; execution deferred | e2e/; .github/workflows/ | Reconcile focused coverage and remove only proved duplicate work later; do not weaken protection or falsely count skipped cases. |
| [#128 [Program] Fridge tablet household command centre — end-to-end roadmap](https://github.com/camster91/family-planner/issues/128) | Active goal / canonical program | docs/FRIDGE_TABLET_PROGRAM.md; docs/product/CROSS_DEVICE_ROADMAP.md | Finish issue-specific source and dependencies, then one consolidated QA phase; do not close this parent on code-only work. |
| [#124 [Fridge Phase 6] Validate and implement calendar interoperability](https://github.com/camster91/family-planner/issues/124) | Existing ICS/OAuth source and required contracts mapped; discovery/QA/activation pending | docs/product/CALENDAR_INTEROPERABILITY.md; docs/architecture/CALENDAR_IMPORT.md; docs/architecture/CALENDAR_SYNC.md | Stable source IDs, duplicate-safe markers, recurrence/exception/DST policy, conflict/tombstones, reconnect/outage/rate states, role/family/device enforcement, source UI and disable/rollback paths map to existing source and authored coverage. Apple is ICS-link interoperability, not CalDAV/OAuth/native store. No provider call/config/sync/QA; household demand gate, #369 account setup and actual provider/native acceptance remain separate. No duplicate calendar backend or tracking added. |
| [#110 [P2][Commercial] Validate packaging and price before implementing billing](https://github.com/camster91/family-planner/issues/110) | External commercial evidence | docs/product/BETA_OPERATIONS.md | Prepare packaging hypotheses and interview plan; do not implement billing or spend from assumptions. |
| [#108 [P1][Beta] Run four weekly scorecards and five exit interviews](https://github.com/camster91/family-planner/issues/108) | External customer evidence | docs/product/BETA_OPERATIONS.md | Prepare scorecards and interviews; complete four weeks with real consenting households. |
| [#107 [P1][Beta] Recruit, consent, and onboard five design-partner households](https://github.com/camster91/family-planner/issues/107) | External household recruitment | docs/product/BETA_OPERATIONS.md | Prepare consent/onboarding packet; Cameron authorizes and owns invitations to real households. |
| [#106 [P0][Release] Approve, merge, and promote the exact Family Planner candidate](https://github.com/camster91/family-planner/issues/106) | Deferred release gate | docs/engineering/CI_AND_RELEASE.md | After implementation freeze, perform consolidated QA, normal protected merge and exact-source deployment verification. |
| [#105 [P0][QA] Validate notifications, privacy controls, and mobile journeys on the final candidate](https://github.com/camster91/family-planner/issues/105) | Deferred consolidated QA | docs/engineering/DEFINITION_OF_DONE.md | Run final notifications/privacy/mobile journeys against the integrated candidate, not repeated partial batches. |
| [#85 P0: Restore required release validation for calendar, task, and database changes](https://github.com/camster91/family-planner/issues/85) | Current main policy read; missing DB suite wiring authored; execution deferred | docs/engineering/RELEASE_VALIDATION_RECONCILIATION.md; .github/workflows/release.yml | Historical master issue is mapped to current main. Read-only GitHub policy currently requires strict Build & Test with admins enforced and force/deletion off; no settings changed. Eighteen omitted existing DB suites join the required job; three catalog/backfill suites get independent disposable migrated databases with post-suite drift and cleanup. No new cases, hosted dispatch or QA run. Exact integrated-head local/hosted/E2E/native/image proof remains required before acceptance. |
| [#84 [Shipping Plan] Consolidate Family Planner into a reliable family release](https://github.com/camster91/family-planner/issues/84) | Plan / acceptance reconciliation pending | docs/FRIDGE_TABLET_PROGRAM.md; docs/engineering/DEFINITION_OF_DONE.md | Read the original issue and reconcile its named source, evidence and external dependencies; prepare missing code/plans without claiming acceptance. |

## Consolidated QA handoff

No new QA rounds run during this implementation phase. At code freeze, bind the candidate commit/tree and preserve prior failures; update affected assertions/selectors, run the appropriate original gates once against the combined candidate, repair real failures, then normally merge/deploy after passing. A later repair still requires its affected checks. Never report an unsigned binary, an unactivated integration, a plan or viewport simulation as production/hardware/customer acceptance.


### #123 event preparation continuation — 2026-10-20

Authored strict canonical transition planning, due-day cues, honest checked versus
marked-done summaries, bounded deterministic reviewed-scope tokens, additive
EventPreparation/Step Prisma+SQL lifecycle source, old-client storage probes,
explicit optional household cleanup and parent scoped portability. Authored unit
and isolated disposable-DB lifecycle cases; all unrun. Full authenticated source
loading/mutation/receipts/recovery/EN-ES sheet and canonical discovery remain code
work. See `docs/plans/event-preparation-v1.md`. No activation/schema execution or
QA/release claim; #123 stays open. QA follows all remaining implementation.


### #123 event preparation API/effect continuation — 2026-10-20

Authored bounded fresh parent canonical source loader, actor/profile/routine/
Chore/Event lock ordering and dependency-change refusal, explicit private-safe
projection, exact-source preview/read routes, once-only canonical Chore/date/
link mutation and same-transaction minimal receipt/replay. New default-off gate
is unchanged. Additive completion/proof continuity source catches complete/undo
without changing consent epoch semantics. Cases authored, unrun. Strict client/
recovery envelopes, 1 MiB exact-body owned journal/inspection, pickers, compact
EN/ES UI and canonical entry/backlinks remain code work. No API/schema/SQL/DB/
client generation, tests/build/browser/native/CI, activation or release evidence.


### #123 event preparation exact recovery/client continuation — 2026-10-21

Authored strict explicit DTO/effect/recovery schemas, current-parent owned receipt
inspection independent of deleted target/feature pause, equivalent browser/server
command digest, pure preview/effect comparison, exact foreground client and
2-entry/6 MiB owned journal. Exact body is up to 1 MiB; unknown/expired/stale/
paused/owner/quota states hold. Receipt creation uses createdCount/full digest,
keeping proof below generic 8 KiB storage truncation. Source cases authored and
unrun. Pickers, compact EN/ES sheet, close/stage/storage repair and canonical
entry/backlinks remain code work. No QA/schema/API/native/activation/release claim.


### #123 preparation pickers and compact sheet continuation — 2026-10-21

Authored parent-scoped task/account/gated-profile/routine ID-window discovery,
five-row picker/list/review UI, lazy EN/ES rounded sheet, canonical chore-editor
links, normal Back/direct-URL navigation, independent calendar/weekly entry
controls and sibling modal coordination. Task edit/link/reorder/unlink, explicit
keep/retime/cues, stale-source acknowledgement and stored routine-step copy with
person/points/day overrides use canonical commands. Exact owned stage/inspect/
retry/forget/storage repair includes close-during-hash/stage and owner guards.
Source tests authored, all unrun. Broader role/device reader and canonical Today/
task/routine provenance/backlinks plus remaining #123/ledger code remain. No
schema/API/QA/native/activation/push/merge/deploy evidence; QA stays deferred.


## Personal Today and chore preparation discovery source — 2026-10-21

Personal parent Today now has preparation entry points on its bounded event rows,
in both configurable and fallback personal layouts. Linked tasks in the personal
summary, Next up and open chore board rows have an event-preparation backlink.
The existing Chore completion/check/Undo controls remain canonical; the backlink
is a separate button, outside the completion control. EN/ES labels and a hydrated,
validated viewer IANA zone feed the existing reviewed preparation host. No zone
is guessed if the browser cannot supply one. Opening renews canonical authority;
a link is not a freshness, due-day or whole-event readiness assertion.

The additive server projection renews parent/household membership in the same
scoped relationship SELECT, joins both canonical Event and Chore household keys,
filters to already-visible non-template Chore IDs and active domain features,
and returns only Chore-to-Event IDs. Readiness/schema absence omits discovery.
It deduplicates/bounds the supplied window at 300 IDs; absence from this map is
not an exhaustive assertion that a task has no preparation relationship. Older
history fetched later and non-open chore presentations still need their own
explicit bounded discovery integration.

The personal map is a separate prop: it is never added to shared/persisted board
DTOs or device responses. Fridge, device, child/teen and cached-snapshot entry
controls are omitted, and the parent host remains default-off. No linked Event
content, cue details, private task content, progress or names are copied into the
relationship projection. Confirmed preparation writes continue using the existing
content-free canonical refresh; no polling, scheduler or alternate task store was
introduced.

Projection role/readiness/schema/window/source case code is authored, unrun. Only
source inspection and explicit-file formatting occurred; no tests/types/lint/build,
rendered/browser/native/API/schema/SQL/DB/client generation/CI, activation or
push/merge/deploy occurred. Remaining code includes narrower authorized reader
projections, dated-routine/canonical-editor provenance and remaining task views,
unified review inbox/what-changed, grounded planning/evaluation and broader ledger
scope. Consolidated QA remains deferred; neither #123 nor release is complete.



## Role context, routine links, initial review inbox and AI source renewal — 2026-10-21

Child/teen personal home source now adds read-only event-preparation context to
its already-selected own canonical tasks and picture-routine steps. The scoped
SQL renews the exact account role/household and requires Chore assigned_to to
match that account, no profile subject, no erased subject and no template. Only
shared-schedule Event title is projected (bounded); no Event ID, plan tokens,
other people's work/verification, cues, assignment or edit capability is sent.
This is optional context, not a whole-plan summary or completion claim. Empty
context does not imply no relationship. Default-off preparation/schema/domain
gates apply. Profile subjects are not authenticated actors; paired/shared-device
readers and profile-targeted context remain separate unfinished scope.

Parent routine-stack views now receive the existing bounded exact task-ID
backlinks, including concrete dated steps and history where present in the
initial page. Embedded canonical rows keep their existing action gates. No
routine-label matching, source-history copying or promotion of a copied one-off
back into a routine was added. Durable source-routine provenance for new copies,
canonical-editor context and later history-page discovery still need code.

The initial parent Review inbox is authored at /dashboard/review, linked by a
labelled 44px header control. It renews current parent household scope in every
canonical query and has two sources: actual completed Chores awaiting a check,
and Event preparation whose stored reviewed source differs from current Event
generation/epoch. Invalid/saturated Event source versions remain review items.
It reads 21 candidates per keyset window, returns 20 and displays five at a time;
filtered empty preparation windows retain their next cursor. No all-clear or
whole-household pending count is inferred. Items open canonical chore checks or
the existing reviewed preparation host; no bulk approval, second completion store,
new automatic action, provider call or migration is introduced. Optional missing
preparation substrate is a paused section. Source errors retain the normal page
error boundary. EN/ES copy describes current inbox scope. Notice/recipe/capture
and saved-request adapters are NOT yet a unified review inbox; see its new plan.

Assistant replies now renew person authentication/role/household/token, provider
configuration and normalized features after provider latency, before returning
private reply/action content. Opt-in Today responses must still be within the
original 60-second lease, with the gate on and a fresh canonical typed projection
identical to the original. The second read anchors the original day/window while
reading current source values; failures, changed/deleted projected records and
expired context withhold the old answer with a content-minimal refresh response.
Provider credentials are compared only in memory and never logged/returned.
Canonical actions still require their own target authorization and confirmation.
This is projected-value freshness, not a signed reference/citation protocol,
semantic hallucination proof, source-generation/ABA guarantee or snapshot-wide
transaction isolation. Wider grounded planning and #144 evaluation remain open.

New role/projection, inbox window/stale-plan and delayed-provider source cases
are authored, all unrun. Only source reads/edits and formatting occurred. No
tests/typecheck/lint/build/browser/rendered/API/native/schema/SQL/DB/client/CI,
provider/flag activation or push/merge/deploy occurred. QA stays after remaining
code. #123/#144/#499 and the integrated goal remain in progress.



## Read-only saved-request inbox adapters — 2026-10-21

The parent Review inbox now has a Saved requests section. Preparation and schedule
journals are checked only after an explicit click, one type at a time, using
current server-authorized person context and the exact same owner-scope lease
as their domain writers. It does not initialize/reconcile a second journal,
inspect receipts, copy request bodies into inbox storage, retry, dismiss or send.
No automatic mount/focus discovery or write is added.

A new bounded snapshot reader validates both current context and all candidate
stores, strict v2 owner envelope and the domain journal/matching entries. Retired,
corrupt, oversized, unreadable, mismatched or divergent replicas hold discovery;
no replica is cleaned, selected over another or called empty after a read failure.
After the asynchronous projection it renews full owner/generation/household and
rereads every store under the lease. Any change withholds the earlier projection.
Successful reads register only the content-free owner for existing logout
retirement; queue data is never written. Existing store adapters may open their
normal IndexedDB infrastructure; no queue entry is created. Unsupported/blocked
IndexedDB or local storage holds this adapter rather than silently guessing.

Adapters project fixed request-kind labels, original issued time and constructed
allowlisted recovery URLs only. No task/event names, exact bodies, request keys,
hashes, source tokens or credentials enter inbox component state. Preparation
also verifies the canonical browser digest before projection. All outcomes stay
explicitly unchecked; even committed/expired/deleted-target requests are retained
for the original recovery screen to inspect. Paused writes do not hide saved
work. Existing preparation/schedule URL hosts mount recovery before fresh target
reads, so discovery does not require a current target or new write readiness.

The compact EN/ES view displays at most five items. It clears on hidden/blur,
owner prop or selected type changes, owned-store notifications and related
preparation/schedule/responsibility overlays. No automatic refetch occurs. An
operation epoch, synchronous current identity/type/overlay check and render-time
projection identity mask suppress late responses and old-person projections.
Signed-in fridge mode is redirected from the private inbox; paired sessions
remain refused by the canonical server session helper. No shared/device DTO or
reader capability is widened.

Snapshot conflict/retirement/paused/owner/store/read-only cases and component
explicit-click/late-owner cases are authored, all unrun. No tests/typecheck/lint/
build/browser/rendered/API/native/schema/SQL/DB/client/CI, activation or push/
merge/deploy occurred. Only source inspection/edits, formatting and local source
work. Capture's existing recovery loader rewrites/prunes storage while loading,
so it was deliberately NOT reused for read-only inbox discovery. Capture/recipe/
notice drafts, responsibility/other-domain saved work, full grounded references,
shared/profile readers and broader ledger code remain. QA stays deferred.



## Responsibility saved-request discovery and paused host source — 2026-10-21

The parent inbox saved-request adapter now includes responsibility/backup commands.
It uses the existing strict responsibility recovery context/journal, exact person
owner lease, 128 KiB bound, current parent identity checks and both snapshot store
reads. Only fixed kind/time and the canonical target recovery URL are projected;
no request key/body/source hash, subject identity/name or consent statement enters
inbox rows. Unknown/expired/possibly committed requests are not dropped or sent.
The original responsibility recovery endpoint remains the receipt authority.

ResponsibilityProvider now separates personal recovery hosting from new-control
readiness, matching preparation/schedule. A valid direct personal target URL can
mount the existing recovery-first sheet while new changes are paused. New buttons
and statement previews still require readiness; all writes keep existing server/
journal gates. Child handoff, paired/device/fridge and sibling-overlay restrictions
remain. The sheet may navigate between recovery targets while paused; this grants
no write permission. Recovery initializes before current/deleted-target reads.

Paused adapter, cross-household command/current-role refusal and paused-host/child
handoff case source is authored, all unrun. Only source reads/edits and formatting;
no QA/test/typecheck/lint/build/API/browser/native/schema/SQL/DB/client/CI,
activation or push/merge/deploy. Capture/recipe/notice draft adapters, wider role/
shared readers, grounded references/evaluation and other ledger code remain.
Consolidated QA stays deferred; #123/#144/#499 and the full goal remain open.



## Canonical capture review inbox host and normalized drafts — 2026-10-21

The parent inbox has a Quick add reviews pane that lazily mounts the existing
CaptureBox only after that category is opened. This is the actual domain editor
and receipt recovery, not a second read-only adapter that prunes legacy data just
to count it. Existing setup/role/private-session checks and exact canonical sends
remain authoritative. No provider call occurs merely to open the pane. Normal
legacy capture initialization still runs its existing local recovery housekeeping.

Once opened, its in-memory draft stays mounted while switching inbox categories
or beneath preparation/schedule/responsibility overlays. A user/household identity
key resets the host before another identity can inherit the old form. The recipe
handoff opens the existing Meals explorer/import editor with its current unknown-
servings/source/duplicate review. The handoff warns before leaving an unfinished
capture preview; it does not copy form content or pretend it is durable. Other
route exits/reloads and full owned draft navigation protection still need work.

One browser-safe strict capture review schema now owns normalized text/photo
proposal types for server and client. Null provider optional fields remain unknown;
missing confidence is conservatively low. Unsupported kinds/types/timestamps,
private extra fields, overlong text and >20-event batches are refused rather than
silently guessed, truncated, filtered or rendered as an empty batch. Syntax/Date
parse checks do not prove named-zone DST validity or semantic source accuracy;
existing canonical confirmation remains required. Recipe's existing typed preview
contract/editor stays canonical; no duplicate parser is introduced.

Failed replacement extraction keeps the previous typed/photo draft and note.
Only valid success replaces it. Generation guards suppress late extraction
responses after revocation/unmount; post-provider server renewal rechecks original
actor/token/role/household and provider configuration before returning proposals.
Changed access/configuration withholds the result. Credentials compare in memory
only. No canonical record or receipt is created by extraction. Source/photo result
accuracy and injection resistance still require the deferred evaluation pass.

Photo review displays five remaining proposals at a time, preserves actual object
identity/removal and original exact pending keys, and explicitly says Add covers
all remaining events, including other pages. Confirmation still uses the original
whole remaining batch; no duplicated or alternative canonical write path is added.
EN/ES pagination, scope, draft-warning and handoff copy are authored.

Normalized malformed/null/bounds/privacy cases, failed-replacement preservation,
post-provider household change and inbox pane/identity case code are authored,
all unrun. Only source inspection/edits and selected-file formatting. No tests/
typecheck/lint/build/browser/rendered/API/native/schema/SQL/DB/client/CI,
activation or push/merge/deploy occurred. Unsent drafts are still in memory:
durable owned capture/recipe draft persistence, exact submission/unknown-result
lifecycle, wider role/device views, grounded references/evaluation and other ledger
scope remain. QA stays deferred; #123/#144/#499 and the full goal remain open.



## Owned review-document lifecycle foundation — 2026-10-21

Source now defines separate bounded editable and frozen capture/recipe documents.
Editable forms preserve all ingredient lines, partial numeric strings, empty fields,
source/confidence/unknowns and evaluation time without saving prompts, photo bytes
or raw provider responses. Strict bounds refuse a document rather than shortening
it. A seven-day editable lease is fixed at creation; freezing creates a separate
24-hour retry lease. Expiration holds the document for review, never automatically
prunes it or permits a fresh key.

The existing owned journal gains an atomic exact-predecessor promotion from local
editable document to immutable submitted intent. Persistence/replica verification
finishes before transport can run. Review-document adapters reuse its owner lease,
CAS, uncertain-write recovery and erasure inventory. One document per domain is
held; a new begin cannot overwrite existing submitted work. Exact keys and encoded
canonical request bodies survive interrupted sends. Recovered retries first inspect
receipts and then renew ownership/storage/gates before transport; committed deleted
or opaque results cannot become creates or be automatically retired. Current record
presence is required for the explicit completion cleanup. This is infrastructure
source; domain hosts still must supply the actual canonical transport.

A new authenticated context endpoint returns a person-only domain namespace and
current write readiness. Parent/teen only; paired sessions use existing refusal.
Historical ownership remains stable through a write pause. New edits/freezes/sends
require existing queue recovery/rollback readiness plus the new default-off
`FAMILY_REVIEW_DOCUMENTS_READY=1`; no flags were changed. Missing/inaccessible
browser storage is a hold, with no unowned fallback.

Recipe create receipts now have a state-only inspection endpoint that reuses the
canonical recipe actor/household locks, role, generation and feature authority.
It distinguishes absent, pending, expired, conflicting, present, removed and opaque
results without returning cached recipe content or changing receipts. Capture and
recipe receipt clients hash parsed canonical inputs using a shared serializer;
existing capture/server fingerprint serialization is preserved. Recipe and grocery
write schemas move into browser-safe modules and remain reexported/used by their
existing canonical routes, without introducing another domain write model.

Storage/lifecycle and recipe receipt case code is authored, unrun. Only source
inspection/edits and selected-file formatting occurred. No tests/typecheck/lint/
build/browser/API/SQL/DB/native/CI, flag activation, push/merge or deployment.
CaptureBox and RecipeEditor are not yet connected to this document lifecycle;
their unsent forms remain in memory. Next: canonical transport owner binding,
recipe/capture host restore/freeze/retry controls, explicit refusal/duplicate-source
resolution, read-only inbox discovery and full navigation/failed-flush protection.
Wider role/routine/AI and ledger scope remains open; QA stays deferred.



## Recipe draft host and bound canonical submission source — 2026-10-21

New-recipe editors (including Meals quick-add and imported recipes) now share an
owned document boundary around the existing labelled form. Adoption is explicit:
`FAMILY_REVIEW_DOCUMENTS_ROLLBACK_READY=1` opts into historical document recovery;
keep that on through write pauses until data is retired. New writes additionally
require `FAMILY_REVIEW_DOCUMENTS_READY=1` and existing queue/rollback readiness.
Before adoption the legacy editor does not depend on Web Locks/IndexedDB. No flags
were changed. Once adopted, inaccessible storage or ownership uncertainty holds
new work rather than falling back to a new unowned create.

A saved unsubmitted recipe offers explicit restore/discard instead of merging into
an incoming import. Full ingredient lines, notes, source-copy choice, unknown
servings and partial numeric strings survive in the form contract; numeric text
inputs avoid the browser silently sanitizing those partial strings. Restored source
links are validated before becoming clickable. Autosave retains the full document;
Cancel and dashboard-link exits flush it before leaving, existing Back/unload
protection is reused, and parent close controls are notified while draft writes
are pending. Focus/visibility/storage renewal retains the original person owner,
masks private form content and suppresses late replies. Ordinary refresh checks
the exact known journal baseline instead of adopting another writer's version.
Explicit recovery preserves conflicts for restore review; uncertain storage writes
require exact transition recovery. These are source paths, not observed UX evidence.

Submission freezes the original canonical body/key before the new foreground
`/api/review-documents/submit` compatibility boundary dispatches to the existing
recipe/event/grocery handler. The dispatch and canonical handler both check current
person/domain owner metadata, readiness and the frozen retry deadline. Older servers
have no dispatch endpoint; the client never downgrades to an ordinary create. No
second recipe/event/grocery effect implementation or background replay was added.
The recipe host uses canonical receipt inspection before an exact retry and before
completion cleanup; committed/removed/opaque/expired/pending outcomes remain
separate. An interrupted success cannot be turned into a fresh create by editing.

Source duplicate/check-unavailable refusals for durable recipe requests now commit
a compact terminal 409 receipt under the existing recipe actor/household/receipt
locks. The shared helper's non-success cleanup only removes pending receipts, so
these completed refusals survive and replay. No recipe title/source/id is cached
in that refusal. State-only inspection exposes a fixed refusal reason. Returning
to editing requires that exact terminal receipt, not a transient response plus an
absent key. The rejected request is retired into a fresh editable document in one
CAS persistence transition; all fields remain durable. A delayed old request stays
terminal even if the previously duplicate recipe was removed in the meantime.

The import explorer refreshes canonical summaries and checks the created recipe's
source before marking its incoming preview saved; a restored draft may represent a
different source. Existing saved-recipe PATCH edits remain on their existing path.
EN/ES recovery, paused, conflict, expiry and saved-work controls are authored.

Added source cases for explicit full restore, unknown-result exact retries, current
household changes, pre-adoption compatibility, dispatch owner/deadline/write gates,
foreign-writer refresh refusal, atomic refused-intent succession and a disposable-
Postgres delayed-request/terminal-refusal scenario. All are unrun. Source inspection,
edits and selected-file formatting only: no tests/typecheck/lint/build/browser/API/
SQL/DB/native/CI, activation, push/merge or deployment. CaptureBox unsent drafts still
need this lifecycle, inbox draft discovery and wider routine/role/AI code remains.
Full programmatic/host exit handling and acceptance of rendered Back/failed-flush/
background/process-loss behavior remain open; do not treat authored paths as proof.
The full goal and #123/#144/#499 stay open; consolidated QA remains after the code.



### #123 / #499 draft discovery checkpoint — 2026-10-21

Read-only recipe/capture document adapters, fixed phase/time/recovery projections,
current parent renewal and direct `/dashboard/meals/review` original-editor entry
are authored. Recipe recovery-only pages avoid importing or creating a blank
replacement. Task capture no longer silently creates calendar events; canonical
chore handoff is currently manual. Capture's owned host/automatic chore handoff,
full navigation, role/routine/timeline/AI scope and consolidated QA remain open.
See `docs/plans/review-inbox-v1.md` dated checkpoint. Cases authored/unrun; no
activation, push/merge/deploy or closure claim.


### #123 / #499 owned capture source — 2026-10-22

The owned capture host, normalized extraction handoff, full editable fields,
provider-off recovery/manual rows, whole-batch freezing, exact partial/unknown
retry, current-record proof and acknowledged removed-result finish are authored.
Legacy envelopes stay in a separate original recovery-only pane. Hidden hosts
release navigation ownership; current person/family/role and source epochs renew.
Helper, partial-batch storage and owned UI cases are authored/unrun; no activation,
QA or release claim. Integrated chore handoff, full exits/read cancellation and
remaining role/routine/timeline/AI scope are still open. See the dated inbox plan.


### #123 / #499 captured chore review — 2026-10-22

Canonical chore form review is now inside owned capture, with explicit parent
assignment/schedule, full partial state and whole-batch exact submission. Account
chore/series creation and pointer receipts commit atomically; state-only canonical
receipt reads handle account/profile recovery without cached private contents.
Legacy no-key and profile-gated callers retain their paths. Source/mounted/API/
disposable-DB cases are authored and unrun. No QA/activation/merge/deploy/closure
claim. Navigation/cancellation and wider role/routine/timeline/AI scope remain open.


### #123 / #499 exit and source-read coordination — 2026-10-22

Owned capture/recipe preparation, global route barrier and history release are
connected to all 27 current non-session route-changing callers. Hidden-host and
retired-owner behavior, provider/overlay refusal handling, bounded cancellable
text/photo/metadata reads and late-response suppression are authored. Existing
sign-out privacy cleanup stays separate. Focused helper/mounted cases are unrun;
source is not Back, native bridge, process-loss, isolation or visual acceptance.
Full QA/release and role/routine/timeline/grounded-AI work remain open. No flags,
provider/DB/native/CI execution, push/merge/deploy or issue closure.


### #123 / #499 authorized change timeline — 2026-10-22

Parent-only What changed now reads existing Activity/AuditLog with current
actor/session/household renewal, stable bounded cursors, canonical target links,
five-row EN/ES windows and private projection clearing. Current record proof
replaces historical private text/URLs; ambiguous/tablet subjects are not claimed
as actors. New chore/recipe/preparation/schedule/responsibility facts commit with
their existing canonical effects/receipts and stay out of older member feeds.
Source/API/helper/component and replay/privacy cases are authored, all unrun.
No activation/QA/merge/deploy/closure claim. Routine provenance/history, broader
role/profile/shared readers, other history coverage, refusal UX and grounded AI
references/planning/evaluation/usage remain open; full goal remains active.
