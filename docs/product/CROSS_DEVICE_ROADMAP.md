# Herewoven cross-device experience and family AI

Date: 2026-10-10. Owner: Cameron. Execution: Codex. Parent: [#128](https://github.com/camster91/family-planner/issues/128).
Status: planned delivery, with a verified web foundation and specific live QA evidence. Market leadership is a target requiring customer comparison, not a claim.
Authority: [Fridge Tablet Program](../FRIDGE_TABLET_PROGRAM.md), repository operating rules and original issue acceptance. This document supplies the current execution sequence; it does not replace the charter or waive older criteria.

## Outcome

A family can add everyone, including a child without an email, and coordinate today using whichever screen is nearby. Parents have controls, teens have useful planning, children have a calm task view, and the shared fridge has only household-safe information. Turning on every feature must not turn Today into a wall of cards. A family helper explains the app, retrieves allowed current information, and proposes reliable actions by text or voice.

One household model, backend, authorization system and set of domain APIs serve all devices. Start from the existing responsive web and Capacitor shells. Add native capabilities where lifecycle, permissions, offline storage, audio, deep links or device management require them; do not promise native parity because a website opens in an app shell.

## Evidence baseline

- Production at QA start: `1454db208e3259a02fe4f6b24e828dbe057579f7`; release #467 and privacy fix #469 closed. Current source audit: `8b7dc1a`, with unrelated lowercase wordmark edits pending locally.
- Live, isolated personal parent session: signup/verification, household onboarding, grocery create/check/reload, direct Today grocery routing, 30-minute event persistence, weekly Monday/Saturday selection including today, collapsed recurrence group, completion/undo and phone Agenda rendering.
- Live gaps: Calendar was stale after returning from successful event creation until reload; Routines reintroduced undated duplicate occurrences; recurring snooze disabled; parent self-assigned completion required a check; phone Today duplicated the same chore and Calendar controls pushed the first event below the initial viewport.
- Source gaps: name-only children absent, multi-step routine builder absent, monthly date overflow, capture retry duplication risk, flat More navigation, incomplete native capabilities. See [dated QA report](../qa/2026-10-10-deep-household-qa.md).
- Existing AI supports limited reviewed proposals and browser voice drafts. It is not yet grounded in household records or capable of passive wake commands. Existing native build evidence is not physical-device, signed distribution, store or customer acceptance.

## Product decisions

1. Keep stable primary navigation. Add a visible compact **Explore** entry on desktop/tablet and a **More features** action from Today/Family on phone; open one grouped searchable destination panel rather than a sixth permanent phone tab. Respect parent/teen/child destination allowlists. Pin favorites and keep enabled destinations within 2–3 decisions. Validate placement in Figma before changing the shell.
2. Separate household feature availability from personal dashboard arrangement. Parents set safe defaults; members choose permitted sections, order, density and preferred views. Provide Preview, Undo and Reset. A child cannot reveal a parent-only module by customizing it.
3. Use a common adaptive page frame and rounded creation sheets. Small forms stay one short sheet; complex chores/routines use clear steps with a sticky action footer, draft retention and predictable Back. Do not stretch text forms across an entire desktop just because the shell is full width.
4. Use one compact recurring-series row outside Today, with schedule, next occurrence, ownership and progress. Expand occurrences deliberately. Preserve dates in every alternate view. Snooze changes an occurrence exception, not the recurrence anchor.
5. Routines belong to every age. Build ordered stacks with anchors, schedule, optional durations, per-step ownership, reorder, pause and progress. Parent approval is configurable for adult tasks; child review rules remain server-enforced.
6. Phone Calendar starts with Agenda; larger screens use a stable source rail and spacious week grid. Collapse setup/help after setup. Duration presets, conflict/error states and immediate data refresh are part of the event workflow. Month view remains tracked separately in #376.
7. Recipe discovery/import/save/curation flows share one recipe model and support meal planning and groceries. Embed a source only if that publisher supports embedding; otherwise offer a clear attributed import or source link, never a blank blocked iframe. Select licensed providers separately after feasibility/cost review (#460/#122).

## Device and role contract

| Surface | Primary experience | Native/platform work | Acceptance evidence |
|---|---|---|---|
| Desktop web | Full-width workspace, persistent navigation, calendar week, keyboard actions, centered editors | Browser permissions, responsive layout, accessible shortcuts | Keyboard/screen reader, 1280/1366/1920 widths, loaded data and all-feature fixtures |
| Phone web / PWA | Compact Today, stable role tabs, agenda, fast add/check, bottom sheets | Honest install/offline states; never depend on background browser microphone | 320/360/390/430 widths, keyboard open, rotation, safe areas, slow network |
| Android phone | Phone experience plus native Back, push/deep links, share/camera/voice, recoverable offline actions | Capacitor adapters, lifecycle, permissions, encrypted scoped storage | Real-device install, process death, permission denial, reconnect, app upgrade |
| Android personal tablet | Split views when space allows, agenda/week, portrait and landscape editors | Multi-window, rotation, keyboard, native adapters | 600/768/800/1024 widths, portrait/landscape and real-device recovery |
| Android fridge / wall | Glanceable shared Today, large targets, attributed safe quick actions, quiet/night state | Pair/revoke, display behavior, local wake feasibility, dedicated-device provisioning | Actual target hardware, 1280×800 and 1920×1200, distance/noise tests, reboot/offline/revoke |
| iPhone | Same core phone contracts, native share/camera/notifications and platform voice actions | Entitlements, deep links, permissions, lifecycle/privacy cover, HEIC conversion | Signed candidate on physical phones, denied permissions, lock/resume and upgrade |
| iPad | Adaptive tablet split layouts and touch/keyboard support | Split View/Stage Manager as supported, scene lifecycle, native integrations | Physical iPad portrait/landscape/multi-window, keyboard and safe-area checks |

Parent: configure household, members and permitted modules. Teen: own planning and permitted shared operations. Child: own missions, allowed lists and emergency access. Name-only members require a new profile/account distinction (#446), not fabricated emails. Shared-device member attribution records who acted; it is not proof of a parent identity. Private parent actions require a fresh elevated personal session. Personal `?mode=fridge` rendering is not paired-device authorization evidence.

## Delivery sequence

Effort bands are planning estimates: S = bounded slice, M = multiple coordinated slices, L = model/platform program. They are not dates or completion claims. Execute one scoped issue per implementation PR; parallel read-only QA/design is useful.

| Milestone | Work and existing issues | Dependency / effort | Exit evidence / owner |
|---|---|---|---|
| 0. Correct and trustworthy basics | Calendar return refresh #457; monthly anchor #471; capture retry keys #472 under #134/#135; AI stale destructive targets #464; summary privacy #470 | Immediate; S–M | Lost-response replay creates one effect; Jan 31 short-month policy; fresh return rendering; privacy checks. Codex. No scheduler enabled for #470. |
| 1. Everyone and real routines | No-email member profiles and conversion #446/#136; atomic routine builder #450; recurring exceptions/grouping #449/#451; adult approval defaults; rotation transition fix; same-day timezone #452 | Identity and recurrence design; L | Parent creates a preschool child without login, assigns a multi-day routine, completes/undoes/snoozes an occurrence without shifting its series. Codex; Cameron reviews the identity UX. |
| 2. Calm adaptive experience | Page frames, Explore/grouped destinations, per-member Today sections #132/#133/#151/#462; sheets #453/#455; dark dropdown #448; lists/custom/images #447/#454; recipe curation #460; calendar #456/#457/#458; alignment #459 | Figma-first significant flows; M–L | Full-feature and busy-household matrices pass; no hidden role controls; first-fold content useful. Codex designs/implements; Cameron reviews visual candidate. |
| 3. Native reliability | Client/server release contract #473 under #145/#138; scoped offline queue #135/#371/#466; Android phone/tablet/fridge #120/#242; iPhone/iPad #465; deep links/push #141; privacy covers/HEIC/permissions | Core contracts; L | Physical lifecycle, reinstall/upgrade, revocation, queue replay/conflicts, compatibility and rollback proof. Codex prepares candidates; Cameron supplies target devices and signing/store access. |
| 4. Useful family helper | Deterministic app help first; authorized context broker #123; structured action proposals #464; evaluation/budgets #144; feedback #146 | Reliable writes before action expansion; M–L | Grounded answers link to current records; role/device filtering before provider call; review, conflict recovery and owned undo; provider failure still leaves usable help. Codex. Provider activation/cost choice: Cameron. |
| 5. Voice and wake | Native push-to-talk and editable transcript #125; Siri/Shortcuts actions; opt-in local foreground fridge wake prototype #120/#125; audio states, cancel, noise/night behavior | Milestones 3–4; hardware feasibility; L | Real audio/device tests and role-safe actions; no write from a wake word alone; no background/global wake promise without platform proof. Codex prototype; Cameron hardware/privacy review. |
| 6. Household beta and release | Whole-screen visual/a11y evidence #139/#150/#152/#163; measured activation/usability #140; support #146; native signing/store #138/#465; external beta #126 | Above feature-specific exits; L | Exact candidate identities, backups/rollback, physical matrix, truthful privacy/store declarations and measured household feedback. Cameron approves outreach and distribution; Codex prepares evidence. |

The lanes overlap: app help, design and deterministic fixtures can begin while identity/native work proceeds. Never use a provider, device or store blocker to stop independent authorized fixes. Existing merge/deploy authorization is evaluated against the actual bounded candidate; this plan grants no new account permissions, paid service, scheduler or store submission.

## Family AI design

### Interaction

A consistent **Ask herewoven** entry opens a small conversation sheet on phone and a side panel on desktop/tablet. Initial prompts: “Help me use the app,” “What is happening today?”, “Add groceries,” “Build a routine,” and “Find a meal.” Suggestions are role-aware. Voice is a second input method to the same workflow.

Help and navigation can be deterministic and work without an AI provider. Questions about household records use an authorized server retrieval broker; send only the fields needed for that question, with date range, limits, timestamps and source references. Responses distinguish known records from suggestions and link to the relevant app view. No silent full-household prompt dump.

An action preview states what, who, when, recurrence/occurrence scope and affected records. Users edit or confirm; execution goes through existing domain APIs with fresh authorization, feature checks and idempotency. Store a scoped receipt and audit outcome. Unknown outcome checks the receipt before retry. Stale records produce a conflict and new preview. Undo is restricted to reversible owned actions and explained when not available. Start with create/read and safe grocery/chore actions; deletion needs explicit current-target selection and version checks.

Natural language is not unlimited authority. Account/role changes, invitations, purchases, external messages and private medical/financial changes remain outside the first tool set. A model-generated record ID is never trusted without server ownership checks. Retrieved recipe/page text is untrusted data, not executable instructions.

### Shared device

Current assistant is hidden on paired/shared surfaces. Add a separate safe capability set, initially read-only Today help. Use the existing sanitized shared-board contract; exclude parent notes, addresses, messages, finance, medical records, contact emails, credentials and unnecessary photos/free text. Later allow only reviewed grocery/task actions with explicit member attribution. Parent elevation must be a real authorization flow, not a spoken name or voice match.

### Voice and wake commands

| Mode | Planned behavior | Constraint |
|---|---|---|
| All surfaces | Tap mic → visible listening → editable transcript → action preview → Confirm | Permission refusal, silence, cancellation and network failure retain touch/text paths |
| Phone/iPad | Native push-to-talk plus supported Siri/Shortcuts/App Intents; Android supported system integrations after feasibility | Web and ordinary native apps cannot assume continuous background mic access |
| Fridge | Explicit opt-in local wake detector while the dedicated app is active; proposed phrase “Hey herewoven,” with configurable activation after hardware validation | Local wake detection first, obvious mic state/mute, bounded command window, night/privacy controls; no provider audio before activation and disclosure |
| Display wake | Separate touch/proximity/display behavior | Screen wake and spoken wake are different capabilities |

A wake phrase opens listening, not a permission grant or automatic destructive action. Handle false wakes from TV/guests/children, accents, kitchen noise, audio playback, interruption, process death and muted microphones. No raw-audio retention by default. Disclose any speech provider and transmission boundary. On-device feasibility, supported device management and background restrictions are release gates, not assumptions.

### Reliability, cost and evaluation

Keep current encrypted server-side provider configuration and bounded request handling. Add household/device usage budgets, rate limits, timeout/circuit-breaker behavior, content-free operational metrics and a kill switch. Choose provider, speech processing and monthly budget with Cameron before activation. No credentials in bundles or plans.

Evaluation uses two isolated synthetic households across parent, teen, child, personal device, shared device and elevated parent contexts. Include ambiguous dates, timezone/DST, “this occurrence” versus series, duplicate requests, response loss, expired previews, stale delete targets, cross-family IDs, malicious source text, denied mic, interrupted audio and provider outage. Every proposed write must remain within capability and fresh role checks.

## Measurable quality bar

Targets below are proposed release criteria; measure baseline and refine through households before claiming achieved.

- At least 90% unaided completion of core tasks in representative household testing: add member, schedule chore/routine, plan meal, update groceries and find a feature. First useful household setup within 5 minutes; same-day task within 30 seconds; grocery quick-add within 10 seconds.
- Identify today's next event, meal and important task within 5 seconds on fridge hardware from normal viewing distance. Common shared actions in 1–2 deliberate decisions; primary fridge targets at least 56px, phone targets at least 44px.
- No overflow, clipped actions, hidden focus, unreadable options, tab-bar/keyboard/toast collisions or hover-only controls at specified viewports. WCAG AA contrast, keyboard/screen-reader flows, large text, reduced motion and long/localized names.
- Visible immediate acknowledgement for touch/keyboard actions; measure a 150ms target for local feedback. Measure fresh household sync toward p95 under 2 seconds where connected, without pretending current polling meets it. Preserve clear pending/offline/conflict status.
- AI tool-selection/grounding target at least 95% on a documented representative test set; 100% of forbidden-access and unconfirmed-write cases denied. Track answer latency separately from execution; proposed p95 answer target 5 seconds with honest slower/failure states and existing hard request bounds.
- Fridge wake prototype target at least 95% intended activations on supported hardware under kitchen noise, fewer than one false activation per 8-hour trial, and zero unconfirmed effects. Validate empirically; never use a confidence score as authorization.
- Exact-once effects under replay, safe household switches/revocation, no private shared-display leakage, and documented recoverable offline conflicts are mandatory regardless of model accuracy.
- Market leadership requires direct household comparisons with relevant alternatives, task completion/friction evidence and sustained retention/reliability. Agent reviews and screenshots do not substitute for customer evidence.

## QA and release matrix

Use fabricated isolated households: empty/new; two adults plus email-free preschool child and teen; all features on; busy multi-week schedules/recurrences; long names/text and localization; large lists/images; multiple groceries/custom lists; provider disabled/failing; slow/offline/reconnected devices. Cross every affected journey with parent/teen/child/shared authorization, light/dark/night, keyboard/screen reader and meaningful viewport boundaries.

Core journeys: add everyone; later account conversion; day/month recurrence and routines; occurrence snooze/undo; calendar create/edit/duration/return refresh/provider disconnect; recipe import/curate/plan/groceries; task review; personalization/reset; image HEIC/failure; notification snooze; AI answer/proposal/confirm/conflict/undo; pairing/revocation; offline concurrent edits.

Native release record must bind APK/AAB or iOS candidate identity to web/server revision, API capability version, migration version and rollback compatibility. `capacitor.config.ts` currently loads the live website: deployment can change behavior of installed binaries. Establish minimum supported client capabilities and staged compatibility checks before expanding native release. Test current and previous supported clients, queued older actions and server rollback; no disconnected fork of the backend.

Physical evidence must include Android cold start/reboot/process death/back/rotation/battery constraints/network loss; fridge pairing/revocation/night/noise/device-management behavior; iPhone/iPad permission denial/safe areas/share/HEIC/universal links/lock-resume/multi-window where supported. Host builds, emulators and web viewport overrides remain separately labeled.

## Reference research (public product claims, accessed 2026-10-10)

Cozi combines shared calendars, lists and a recipe box ([feature overview](https://www.cozi.com/feature-overview/)). FamilyWall advertises broad household coordination ([official product](https://www.familywall.com/)). Skylight describes calendar, chores, meals and capture assistance ([official feature guide](https://skylight.zendesk.com/hc/en-us/articles/48778850390171-Calendar-Features)). These are useful capability references, not a hands-on quality benchmark. Our hypotheses are calmer role-specific views, email-free members, reliable reviewed AI and ordinary Android fridge hardware; validate those with families.

Android restricts background foreground-service starts and while-in-use microphone access ([restrictions](https://developer.android.com/develop/background-work/services/fgs/restrictions-bg-start), [service types](https://developer.android.com/develop/background-work/services/fgs/service-types)). Dedicated kiosk behavior has provisioning requirements ([lock task](https://developer.android.com/work/dpc/dedicated-devices/lock-task-mode)). Apple exposes system actions through [App Intents](https://developer.apple.com/documentation/appintents), with explicit [background lifecycle](https://developer.apple.com/documentation/uikit/about-the-background-execution-sequence), [associated domains](https://developer.apple.com/documentation/Xcode/supporting-associated-domains) and [media permission](https://developer.apple.com/documentation/avfoundation/requesting-authorization-to-capture-and-save-media) contracts. These support platform-specific planning; they do not establish our implementation or hardware compatibility.

## Next bounded action

Fix #457's reproduced Calendar return-refresh behavior and verify create/edit/close/reload in the isolated household; retain and finish the approved lowercase wordmark change separately. Then address capture replay integrity and #471 before expanding AI writes. Name-only profiles and the adaptive design specification follow as larger reviewed slices. No remaining feature/native issue is closed by this planning document.
