# Family action flow — approved direction, 2026-10-27

Related: #499 (unified UI), #464 (assistant), #450 (routines), #128 (programme).
Cameron approved the competitive critique: reduce choices and connect existing
capabilities before adding more dashboard features. Keep the approved Woven Grove
identity and canonical APIs, role gates, private/shared boundaries and recovery.

## Interaction specification

1. Today has one primary **Add or ask** entry. The same entry remains available
   from the dashboard shell. Controls/configuration stay secondary.
2. A compact shared Dialog offers **Ask assistant**, **Add from a photo** and
   direct manual destinations. Only existing role/feature-authorized destinations
   appear. Photo means existing image capture, not unsupported document formats.
3. Asking leads to the existing text/voice composer first; help/navigation stays
   available in a collapsed disclosure. Existing proposals remain reviewable;
   the UI never treats a proposed write as a saved result.
4. Photo entry opens the existing calendar Capture sheet only after capability
   resolution. An unavailable capability displays a clear explanation and a
   permitted manual fallback. Opening this path must not invoke a provider or
   submit a write by itself.
5. Guided routines show the next incomplete step, progress and completed/waiting
   state. List mode remains available. View choice never changes ownership,
   verification, profile-only permissions or the canonical completion callback.

## Composition and accessibility

Use existing Dialog, typography, surfaces and minimum44px controls. One primary
action per region; secondary help/settings do not displace the composer. Restore
focus on dismissal and preserve pending-work navigation guards. Maintain EN/ES,
long-text wrapping and phone/tablet/desktop layouts. Do not duplicate editable
forms or voice listeners to reposition them.

## Explicit remaining stages

- Recompose Today schedule/attention/dinner hierarchy after rendered comparison;
  this slice changes the action hierarchy, not the full board layout.
- Offer photo/text/voice in one shared review surface rather than destination
  handoff; retain original-owner and idempotency contracts during that work.
- Shared-device assistant: separate paired-device actor/capability contract,
  household-safe read model, reviewed proposals, revocation and role-change
  handling. Do not expose the parent assistant or parent endpoints on /device.
- Native wake listening: explicit microphone state, visible cancellation,
  permissions/lifecycle/offline behavior and physical-device acceptance. Current
  local voice preview is not an always-listening wake assistant.
- Independence settings and custom routine photos remain separate from this
  presentation-only guided/list change.

Competitor documentation informed the principles, not copied layouts or claims
of tested performance: Cozyla CalendarOS release notes, Skylight Sidekick/import
help and Hearth routine help. No merge, production rollout or provider activation
is implied by this interaction specification.

## Local implementation and evidence

Application candidate `05a72a25` implements the entry/composer/capture handoff and
guided/list steps above. First browser run exposed focus restoration to an inert
Today opener; c5f72204 releases the assistant page lock before Dialog cleanup.
Independent source review additionally corrected draft-aware navigation on the
manual fallback and current-step semantics on inline parent routine rows.

Observed: 117 focused tests across host/Today, capture, routines and calendar
suites passed across the slice; final affected ESLint, typecheck and production
build passed. The first browser run passed18 EN/ES parent/teen/child role cases
plus3 photo fallbacks and3 sign-in setups, and failed3 chat dismissal cases.
After the fix, all12 targeted browser checks passed without retries:3 sign-in
setups plus entry/chat, unavailable-photo handoff, and exact routine completion/
Undo at390×844,1280×800 and1366×768. The 1280px run is the personal dashboard at a
tablet-sized viewport, not shared-device assistant acceptance.

Phone action sheet and composer screenshots were visually inspected. Composer
was inside the viewport; collapsed help and restored focus were asserted. No AI
submission occurs simply by opening the flow. Photo-unavailable responses in the
browser test are explicitly stubbed; no provider output was tested. Routine
completion/Undo used real local fixture writes with exact occurrence IDs.

Artifacts: `/tmp/family-action-fixed-report/index.html`,
`/tmp/family-action-phone-390x844-sheet.png`,
`/tmp/family-action-phone-390x844-composer.png`.
The remaining stages above are not implemented or deployed by this slice.

## Today composition follow-through

For #499, keep Add or ask and Today controls as the two visible toolbar entries.
Explore and customization live inside Today controls, with their existing dialogs
and role gates. Portalled dialog interactions must not collapse the disclosure
under its focus-return target. On desktop, give the schedule three fifths of its
row and chores two fifths. Keep phone stacking, saved section order, compact mode,
meal/grocery pairing and the dedicated shared-device board intact. No data,
permission or preference migration; rollback is the toolbar/CSS change only.
This is a bounded hierarchy refinement, not completion of the wider Today redesign.

Local follow-through validation: production build (including TypeScript), affected
ESLint, diff whitespace check and20 focused tests passed. All12 browser checks
passed (3 fixture sign-ins plus3 journeys at390×844,1280×800,1366×768): Add/Ask
composer, unavailable-photo manual fallback, and Today disclosure/Explore/customize
Escape and focus restoration. The photo capability is stubbed unavailable; no AI
provider execution is claimed. Fresh phone closed/open-menu and desktop screenshots
were inspected, including long fixture event text. Layout sync/error messages stay
outside the collapsed disclosure. No API/schema, shared-device or production
change. Evidence: `/tmp/today-hierarchy-report/index.html` and
`/tmp/today-hierarchy-{project}.png`; temporary artifacts may be removed by session
cleanup. Broader Today/dinner composition remains a later stage.

### Wide-board dinner placement

At1280px and wider, if the visible saved order begins Next then Dinner, place
Dinner alongside the schedule/chore row. Next takes two of three columns; Dinner
takes the third. Groceries followed by Coming up share the next row. Other custom
orders retain their existing composition. Phone/portrait stacking, hidden tiles,
canonical meal links and the dedicated fridge board are unchanged. This CSS-only
slice has no write path or preference migration. Revert the wide-board CSS block
to roll back.

Observed for the dinner-placement slice: production build and affected ESLint/
whitespace checks passed. The first two build attempts failed from local ENOSPC;
removing unused older Playwright downloads and inactive npx caches, then limiting
Node heap to2048MB, allowed the final build to finish. All15 browser checks passed:
3 sign-in setups and4 journeys at390×844,1280×800,1366×768. Dinner placement and
real customization preview/cancel were checked without saving preferences.
Fresh desktop and phone screenshots were inspected. Report:
`/tmp/today-dinner-report/index.html`; images:
`/tmp/today-dinner-{project}.png`. This is personal-web evidence, not paired-device
or native acceptance. No merge/deployment occurred.

## Shared-tablet helper: first read-only slice

For #464/#499, add a Household helper entry beside Parent on /device/today.
Four explicit questions use only the already-authorized device-audience board
snapshot: upcoming events today, dinner, remaining chores, and groceries. Reuse
canonical local-day and chore selectors; cap answers at five rows with a truthful
continuation hint. Show snapshot time and cached/error status. No free-form input,
provider, microphone, person-session endpoint, storage, new API or write is added.
The surface explicitly says it is not AI. It is groundwork, not completion of the
requested family AI or wake assistant.

Clear the question on dismissal, page hiding and calm/night cover; disable while
covered or elevated. Existing snapshot purge/revocation unmounts the helper with
the board. Parent elevation does not broaden helper access. Keyboard dismissal,
focus restoration, readable wrapping and EN/ES copy are required. Rollback removes
the helper entry/component and cover-state notification, with no data migration.

Shared-helper local evidence: final production build (including TypeScript),
affected ESLint and whitespace checks passed.18 focused helper/snapshot tests
passed; the3 helper tests were rerun after the final preview-copy correction.
All7 final browser checks passed:3 sign-in setups plus real pairing/helper and
revocation journeys in portrait800×1280 and landscape1280×800. The helper made no
non-GET request while answering all four questions, restored launcher focus, and
showed none of the fixture private-data canaries. Revocation removed an open
helper. Unit coverage checks cached copy and question clearing on inactivity/
page hide; physical-device calm/wake and native voice acceptance remain separate.
Screenshot inspection found a transient contrast issue when swapping filled and
tinted buttons; stable tinted buttons with a selected border fixed it. Fresh
screenshots were inspected after that fix. Final report:
`/tmp/device-helper-final-report/index.html`. Screenshots:
`/tmp/device-helper-{project}.png`. No provider was invoked and no production or
schema change occurred. The feature is explicitly a read-only board helper, not
completion of the requested AI/wake assistant.

### Local question entry and the device-AI boundary

The helper now accepts the documented common EN/ES question phrases for its four
Today topics. This is explicitly local phrase routing, not a model or a general
natural-language assistant. Whole-question matches avoid returning today's dinner
for tomorrow, private topics, multi-part requests or commands to change data.
Unsupported input clears any previous answer and points back to the quick choices.
Question text is bounded to240 characters and lives in component memory only;
dismissal, cover, page hiding and revocation discard it. No microphone is added.

Source inspection found that `AiUsageActor` in `ai-usage-server.ts` requires a
user ID and session generation; reservations and reply checks lock/recheck a
parent/teen user. The device must not impersonate its pairing parent to reuse this.
Before provider integration, extend the existing meter with a distinct device
actor and per-device quota identity, preserving household cost reservations after
revocation/deletion. Require a separately recorded parent opt-in for shared-device
AI (off by default) and show the shared-room data/privacy implications. Both
reservation and reply release must recheck device session, revocation, household,
opt-in revision, provider config and pause/budget state. Never allow elevated
parent mode to widen the shared prompt. Build context server-side from the device
DTO allowlist, use read-only output without tool/write execution, bound output and
revalidate context before showing it. Use deterministic privacy fixtures first;
provider activation and physical-device voice/wake acceptance remain unperformed.
No schema or permission changes are part of local question entry.

Local question-entry evidence:39 focused tests passed across the phrase matcher,
helper and snapshot suites; affected ESLint, whitespace checks and production
build passed. All7 browser cases passed (3 sign-ins, plus pairing/question-entry
and revocation at800×1280 and1280×800). Supported typed grocery questions returned
the shared rows; an unsupported delete request cleared the answer and showed the
fallback without any non-GET request. The final landscape screenshot was visually
inspected for field/button/answer contrast and clipping. Report:
`/tmp/device-question-report/index.html`. This evidence does not establish general
natural-language understanding, model behavior, voice or native acceptance.

## Fridge entry size — user correction

Hide the personal Today Fridge mode entry on phones and small tablet layouts.
Physical diagonal inches are not reliably exposed by browsers, so use a responsive
approximation: both viewport dimensions at least800 CSS pixels for touch layouts,
or at least1024×600 with a fine pointer for desktop use. The rule applies before
hydration and responds to rotation/resizing. Hiding the wrapper also removes the
entry from keyboard/accessibility navigation. Existing direct fridge URLs and
paired-device routes keep working; Exit fridge mode remains reachable at all
sizes to avoid trapping an existing session. No device permissions or API changes.

Fridge-entry validation: production build (including TypeScript), affected ESLint
and whitespace checks passed.7 browser checks passed (3 sign-ins plus4 journeys):
phone portrait/landscape and600×960/960×600 small-tablet entry hidden,800×1280 and
1280×800 tablet entry visible,1366×768 desktop entry visible, and small-screen
manual fridge entry still exposes Exit. Report: `/tmp/fridge-entry-report/index.html`.
This verifies viewport behavior, not measurement of physical screen diagonals.
