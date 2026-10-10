# Deep household QA — 2026-10-10

Scope: authorized isolated live household **Herewoven QA — disposable**, one parent account; personal web session. Root controlled the browser; four existing agents performed disjoint read-only source audits. No real-household edits, invitations, paid AI requests, microphone grant, security changes or fixture-seeding of production paths.

Production baseline: `1454db208e3259a02fe4f6b24e828dbe057579f7`. Source audit: `8b7dc1a`; local lowercase wordmark changes are pending and not claimed live. Parent #128; execution plan [Cross-device roadmap](../product/CROSS_DEVICE_ROADMAP.md).

## Live observations

| Journey | Observed result | Follow-up |
|---|---|---|
| Register, verify, create household | Normal account flow and family onboarding succeeded; “Add Everyone” step present | Earlier #467 closure evidence; no-email child remains #446 |
| Groceries | Disposable list/item create, check and reload persisted; Today opens the grocery list directly | #461 flow verified for this single-list case; multiple-list ambiguity still requires coverage |
| Event duration | 30-minute event persisted and appeared in Calendar/Today after reload | #458; successful create returned to stale Calendar until reload, recorded in #457 comment 6100551148 |
| Weekly schedule | Monday + Saturday accepted; same-day Saturday occurrence visible | #449/#452 positive live evidence; no native or cross-timezone claim |
| Recurrence grouping | Week view collapsed the weekly task to one summary; expanding showed three dated occurrences | #451 foundation works in Week |
| Routines alternate view | The same three recurring occurrences appeared under Other chores with identical titles and no visible dates | #450/#451: keep recurrence grouping and occurrence identity in every view |
| Recurring snooze | More actions explicitly disabled snooze for repeating chores | #451: occurrence exceptions before enabling snooze |
| Adult completion | Parent completed their own task, which moved to To check; Undo restored it | #450/#462: configurable adult approval; observed policy friction, not a security defect |
| Phone Today | Own chore appeared above the header and again in Chores today | #462: combine My/Family context and avoid repeated content |
| Phone Calendar, 390×844 | Agenda selected by default; controls and explanatory text pushed the first event below the initial viewport | #457/#133: compact toolbar and progressive setup disclosure |
| Feature discovery | Enabled Food inventory and Pinned notes in QA household; both persisted in More destination list | #151: grouped/searchable discovery and pinned shortcuts; not all-features-on acceptance |
| AI panel | Reviewed action workflow, provider/transmission disclosure, voice draft and setup link present | No request sent or audio recorded; grounded household help/wake remains planned #123/#125/#144/#464 |

Phone screenshots were visually inspected in the tool during QA. No stored full role/device screenshot pack accompanies this report. Temporary viewport overrides are reset before handoff. QA records are retained for continued testing; no cleanup was performed.

## Source-confirmed gaps

- #446: onboarding invites and code joining still require authenticated user accounts; there is no parent-created name-only child profile.
- #450: routine fields are free-text name and step number, not an atomic builder with anchors, ordering, shared schedule and pause. Turning off rotation while changing to Once can retain the stopped template's prior rotation; add a transition regression test.
- #471: monthly native date arithmetic can move Jan 31 into March. Define last-valid-day behavior and restoration of the original anchor before implementing.
- CaptureBox creates confirmed text/photo events and grocery items without stable replay keys; the event POST route has no replay contract. Source demonstrates retry risk after a committed response is lost; no live fault injection or duplicate production event was performed. Bounded P1 issue #472 under #134/#135.
- #151/#133: More is flat; feature settings long; page width/padding differs; dashboard ordering is not per member. Role filtering exists and must remain enforced.
- #447: Shopping type exists but overview filter cards omit it. Rendered proof remains pending.
- #454/#465: HEIC can be stored while raw image rendering lacks useful unsupported/error feedback. Do not claim cross-browser photo parity.
- #120/#242/#465/#466: native shells do not prove appliance reboot/kiosk, native speech, offline household snapshots, universal-link/permission completeness or physical-device parity. Existing Android back/cookie-flush scope is narrower than appliance acceptance.
- #464: assistant lacks authorized household grounding and stale-target version protection for destructive proposals. Source audit found no new confirmed cross-household disclosure; proposed capability hardening is not labeled a reproduced exploit.

## Remaining evidence

All-features-on busy households, no-email children, teen/child accounts, paired-device authorization, multi-family runtime isolation, light/dark/native option rendering, screen readers, every create/edit form, multiple groceries/custom lists, monthly/DST recurrence, HEIC, provider failures and live AI execution need their own targeted cases. Physical Android phone/tablet/fridge, iPhone/iPad, voice/wake/noise, signing/store and real household usability remain unverified.

Native date/time fields did not accept standard automation fill in this browser; keyboard entry worked. This is a QA-tool limitation, not a product defect. Agent source audits are distinct from the live observations above. Proposed usability/latency targets in the roadmap are not measured results.

## Delivery priority

1. Calendar refresh, capture replay safety and monthly recurrence correctness.
2. Email-free members and adult/child routine/approval semantics.
3. Adaptive navigation, Today personalization, shorter forms and whole-screen QA fixtures.
4. Native reliability and grounded, reviewed AI actions; then platform-specific voice/wake.
5. Physical-device and household comparison/beta evidence before market-leadership claims.
