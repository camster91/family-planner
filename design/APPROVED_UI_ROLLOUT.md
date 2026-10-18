# Approved UI implementation program

Cameron accepted the 2026-10-17 cross-feature mockup direction and explicitly
set the implementation goal: all 22 web features/supporting screens, verified
QA, merge and deployment. Canonical work remains #499 / #128, with #132 for
navigation and #455 for contextual forms. No competing roadmap is introduced.

## Design reference and scope

- [Editable review board](https://www.figma.com/design/s0qsOr91Au0OJ70SCZEWb4?node-id=84-7)
- [Core route studies](https://www.figma.com/design/s0qsOr91Au0OJ70SCZEWb4?node-id=86-173)
- [Additional modules](https://www.figma.com/design/s0qsOr91Au0OJ70SCZEWb4?node-id=92-304)
- [Supporting screens](https://www.figma.com/design/s0qsOr91Au0OJ70SCZEWb4?node-id=92-1016)
- [Short form studies](https://www.figma.com/design/s0qsOr91Au0OJ70SCZEWb4?node-id=92-1395)

There are 38 detailed editable Figma studies, with additional overview/state
boards. The isolated interactive review gallery maps 76 physical source pages,
including 62 canonical product routes and nine intercepted sheet presentations;
aliases, internal pages and routing plumbing do not count as new features.
Mockup review is not implementation, production or native evidence. Some static
control examples need real validation/recovery behavior during implementation.

Keep the approved original H, lowercase herewoven, semantic Woven Grove tokens,
Newsreader/Manrope, one clear primary action per context, contextual secondary
actions, progressive optional details, and consistent back/sheet behavior.
Use actual canonical data, never the gallery's fabricated household content.

## Implementation order

1. Shared navigation: five parent destinations with Explore directly available;
   Family is clearly reachable inside it. Preserve teen/child Emergency tabs.
2. Short shared create/edit journeys: required fields first, optional details
   folded, no lost context, localized labels, and existing pending/retry rules.
3. Today, Calendar, Lists, Meals, routines and household setup, then remaining
   modules using the same patterns and real domain records.
4. Coordination review/reset/history and capture/recipe refinements through
   their existing issues. Real AI/voice, provider eligibility/OAuth and native
   hardware/store work retain their independent gates.

## Coverage ledger

Each row needs candidate source identity, affected checks and actual rendered
journeys before being called verified. Existing backend capability or a mockup
does not by itself mark the approved UI adopted. No row is a release claim.

| Feature / surface | Approved direction | Current implementation disposition |
| --- | --- | --- |
| Shared personal navigation | Five parent tabs, searchable Explore, Family within Core | PR #568 verified live at main9d9e6de6 after exact-main QA and protected restore; child/teen tabs retained |
| Today (person home) | A capped Next up card, dinner and a quiet look ahead | PR #570 combines scoped events/chores; bounded rendered/source checks and 117 original browser checks passed; incorporated #574 candidate hosted checks pass and source serves main f1d103a8; wider acceptance pending |
| Chores | Grouped series, selected weekdays, clear owner, contextual actions | Local Today/Week/Series overview with inline routine stacks; 101 focused units and independent review pass; local six-size overview/completion/Undo/budget checks and incorporated #574 hosted candidate checks pass; wider acceptance pending |
| Calendar | Readable week/agenda, duration, clear connections and overlap review | Local timing-overlap advisory and one native source selector passed bounded review; incorporated #574 hosted candidate checks pass; mobile Week/workspace and wider visual acceptance pending |
| Lists | Direct groceries, custom lists, simple create/edit | PR #570 compact overview, short create form and validated Back/create/delete context passed bounded review; incorporated #574 hosted candidate checks pass; remaining detail-copy migration and wider acceptance pending |
| Family | Add everyone, email-free profiles, clear account-link distinction | Local responsive account roster and EN/ES removal/recovery presentation: 44 affected tests, 78 browser checks and independent review pass; Family/Notes #576 candidate hosted acceptance passed and main `768e4170` is merged and production verified; Add Everyone/profile-link and full acceptance pending |
| Meals | Week plan, recipes, several-dish prep, eaten/remaining/next prep | Local shared Plan/Explore/Prep navigation candidate; existing canonical meal/prep behavior retained, incorporated #574 hosted candidate checks pass; wider visual/journey acceptance pending |
| Inventory | Use soon, honest capture review, quantities and locations | Local full-width overview and shared location shortcuts; 121 affected units, exact build and six-size browser 95 passes/10 inherited scope skips; incorporated #574 hosted candidate checks pass; capture-review/wider acceptance pending |
| Notes | Short shared notes and clear visibility | Local shared board/read-only detail and canonical color/recovery alignment: 42 affected tests, 78 browser passes/15 inherited scope skips; Family/Notes #576 candidate hosted acceptance passed and main `768e4170` is merged and production verified; wider acceptance pending |
| Anniversaries | Upcoming dates without duplicate noise | Chronological overview, short permission-aware sheets and recoverable writes: exact application0ed841aa passes89 browser cases/10 declared scopes,103 affected units and9 PostgreSQL cases; f142 test-only Notes/Capture repairs pass42/15 declared scopes; combined #580 hosted and exact-main QA pass; serving main5cf9720b verified; wider acceptance pending |
| Gamification | Optional quiet progress, meaningful dependencies | Parent Progress overview adapted locally; child home/routine EN/ES source19ed and resolved-claim notice follow-up pass92 affected checks, with24 new six-size browser cases prepared; final rendered/hosted and persisted quiet-mode acceptance remain pending |
| Rewards | Clear costs and role-appropriate actions | Canonical receipt/authority and localized role-aware create/claim/approval presentation source-reviewed; appc2c95b60 build and six-size ENES matrix116PASS25declaredscopes0retry,132 captures and303 affected cases pass; API6 PostgreSQL cases pass; independent visual review is conditional on inactive-claim and Spanish recovery/singular fixes; broader child supporting-copy localization and combined hosted/release acceptance remain pending |
| Budget | Private summaries and contextual details | Canonical transaction receipts, category detail, localized parent controls and confirmed-write/GET-only recovery are source-reviewed;144 affected cases and7 PostgreSQL cases pass; full local5833PASS403opt-ins3retained Macbackupfailures; actual rendered/combined release acceptance pending |
| Projects | Next steps, owner and detail context | Existing behavior retained; approved layout review pending |
| Messages | Private conversation linked to work | Existing behavior retained; approved layout review pending |
| Analytics | Useful private trends, dependency-aware | Parent Progress55f417bd uses canonical API and localized strict-response recovery; 102 UI/localization and29 API/isolation/gamification cases pass, exact build and51 browser/startup-budget checks plus final phone visual review pass; combined #580 hosted and exact-main QA pass; serving main5cf9720b verified; broader acceptance pending |
| Wishlist | Capture and compare family ideas | Existing behavior retained; approved layout review pending |
| Emergency | Fast authorized access, private medical/contact fields | Existing behavior retained; approved layout review pending |
| Locations | Saved places with private addresses protected | Existing behavior retained; approved layout review pending |
| Pickups | Explicit responsibility, confirmation and backup | Existing behavior retained; approved layout review pending |
| Allowance | Own balance versus parent administration | Existing behavior retained; approved layout review pending |
| Travel | Trip preparation and deliberate recurrence changes | Existing behavior retained; approved layout review pending |
| Handoff | Scoped brief, expiry and owned responsibility | Existing behavior retained; approved layout review pending |
| Sick days | Role-scoped care, no private shared-display exposure | Existing behavior retained; approved layout review pending |
| Supporting routes | Auth, onboarding, search, notifications, help, settings, devices | Existing behavior retained; approved layout review pending |
| Shared fridge | Sanitized device Today, large targets, privacy boundaries | Existing behavior retained; approved layout review pending |

## Acceptance and compatibility

Check affected empty/loading/error/retry/offline/stale/pending/conflict/success
states, EN/ES/long text, light/dark, keyboard/focus and targets across the six
repository viewport baselines. Preserve canonical models, role/device gates,
email-free profile flags, pending receipts, direct URLs and installed clients.
Do not replace robust domain/recovery logic with a visual-only duplicate.

Merge only after the applicable original checks pass. Verify the exact merged
revision, deployment and runtime separately; do not close #499/#128 on a partial
slice. Rollback should restore presentation without changing household data.

## Bounded Lists overview checkpoint — 2026-10-17

The overview candidate replaces tall type cards with wrapping 44px filters,
keeps Shopping visible when used or explicitly selected, and offers one create
action in empty active types. Existing household scope, child creation limits,
legacy meal-plan readability, item counts and pending-tick recovery are retained.
A failed list read now renders a localized Retry state rather than a false empty
household. No schema/API/permission change is introduced.

At application source `a7ac0f9c`, 23 affected tests, types, full lint and optimized
build passed. Local fixture journeys passed rapid Grocery/To-do filtering and
Back/Forward restoration, with no horizontal overflow and 44px filter targets at
all six viewport sizes in EN/dark and ES/light. Independent delta review passed.
An earlier runtime at `773d3469` exercised an actual isolated list-read failure
and Retry after restoring the read; fixture list count remained seven. Local
captures and source/version records are retained in the task's
`work/ui-plan-approved-2026-10-17/` evidence folder. These checkpoints are not a
hosted or production release claim. Browser assertions for the approved Explore
navigation are subsequently updated without removing role/focus/offline gates;
fresh exact-head hosted checks remain required.

Lists detail back-context/localization and remaining feature rows are still
pending. Do not mark Lists or the all-feature programme complete from this slice.

## Context and Today composition continuation — 2026-10-17

Lists detail Back and successful deletion retain the validated type filter;
creation Cancel retains the origin filter, while successful creation shows the
selected created type (unfiltered entry still returns to All Lists). Direct and
intercepted forms receive validated initial context from the server, avoiding a
transient unfiltered first render. Local fabricated create/delete cleanup
retained all seven original lists. Other detail-copy migration remains pending.

The person-app Today candidate combines the existing scoped upcoming events and
remaining household chores into one Next up card. It caps visible rows at six,
reserves room for both kinds of work, reports separate continuation counts and
keeps full destinations, approval totals, paused-profile status and existing
completion/Undo hooks. Personal-summary exclusions remain in the existing view
model. Shared fridge mode keeps its original separate schedule/chores layout;
no DTO, permission, profile flag, API, scheduler or provider changes are made.
This slice does not invent pickup confirmations or AI suggestions from gallery
example content. Wider Today controls and other coverage rows remain pending.

At the pre-inventory-reconciliation Today source, 64 affected tests/types/lint
and optimized build passed. The full unit run passed 5,698 tests with 387
established opt-in skips, three retained Mac backup-prune failures and one copy
inventory failure. The latter identified two now-localized List detail labels;
only those obsolete literal records were removed and the original five-test
copy guard passed. No guard, baseline, assertion or skip was weakened. Fresh
candidate browser, performance, hosted and release gates remain required.

## Next up runtime and performance checkpoint — 2026-10-17

At source `6dfe3fce`, the original home, core JavaScript budget and retired
meal-plan exclusion browser suites pass: 81 passed, 24 existing project-scope
skips across six viewports. Today initially failed its unchanged 250000-byte
gzip limit at 251341 bytes. Loading the optional routine drawing catalogue only
when a chore has a picture reduces the no-picture initial view to 246945 bytes
at all six sizes. Picture-enabled views still download their actual catalogue;
no functionality or byte threshold is removed. A fixed-size decorative fallback
and local error boundary keep the labelled chore action usable if it fails.
All 121 board unit tests, typecheck, touched lint, optimized build and independent
source review pass.

Chrome captures at the previous same-layout source 84903a3b verify a populated
Next up card with 3 events, 3 chores, additional-item counts and done/approval
totals at all six sizes, without horizontal overflow and with chore targets
>=52px. The original fridge layout is retained. At 6dfe3fce the Spanish/light
empty view also has no document overflow at all six sizes. Local captures and
measurement JSON remain in the task evidence folder. Temporary fixture dates
and language/theme settings were restored after review.

PR #569 is separately frozen at 69b7878c after repairing its stale Grocery-button
assertion to verify the approved native selector, its five allowed values and
retired meal-plan exclusion. Its new original hosted checks are pending.
Wider accessibility/offline/enlarged-text, exact final hosted gates and release
verification remain open. This checkpoint does not complete Today, Lists, any
remaining feature row, or the full 22-feature programme.

## Calendar overlap review candidate — 2026-10-17

The advisory compares real positive-duration intervals already loaded in the
selected source/range. It deduplicates IDs, excludes touching/zero-length
intervals, clips continuing events, counts overlaps and previews at most three
pairs. It makes no attendance or actual-conflict assumption. A compact native
disclosure opens existing event details, retaining parent edit, teen read-only
and subscription read-only rules. Wide desktops place it beside the schedule;
smaller views place it above. Exact build/rendered/browser/hosted acceptance is
still required. The duplicate source button list is removed in favor of the
existing labeled native selector at every width; the same filter values, empty
source recovery and date navigation remain covered. Mobile Week alignment
remains open.


## Meals navigation candidate — 2026-10-18

Plan, Explore and Prep now share one localized route-based navigation, replacing
the planner's parallel recipe link/two view buttons and recipe page's back-only
entry. The selected `start` and existing query context are retained. Plan and
recipe exploration remove the planner-only `view`; Prep uses canonical
`view=bulk`. One current-page link, wrapping 44px targets and a nav-only Suspense
boundary preserve keyboard and responsive behavior. No meal/recipe/prep API,
permission, portion rule, pending sheet or data model changes.

Independent source review and 176 affected Meals units passed. Final exact-source
build/browser and six-size rendered review remain required. The first browser
attempt retained 21 passing cases before stopping for a diagnosed Spanish test
setup error: the English-only login helper was invoked after setting Spanish.
The test now signs in before selecting the localized Meals presentation, keeping
all navigation, context, accessibility, no-write and canonical bulk assertions.
This candidate does not complete Meals or the 22-feature programme.

## Chores overview candidate — 2026-10-18

Today and Week now include routine progress beside ordinary work, with each open
routine occurrence rendered once. Today opens the routine disclosure; Week starts
collapsed. Series keeps the existing canonical recurrence grouping and weekday
labels. A compact More views selector retains All chores/history and the dedicated
Routines workspace; the latter keeps its date-range selector. All does not expand
inline routine cards. Parent rows retain their action sheets, completion/Undo and
focus callbacks. Child/teen steps retain their own-step restrictions; email-free,
paused and unavailable profile rows retain their existing read-only gates.

The overview and routine presentation use typed EN/ES copy. No API, schema,
provider, scheduler, offline protocol or profile activation changes are included.
All 101 affected unit tests pass. Independent source review found and resolved
the initial All-range expansion issue, with a retained regression. Exact-source
compilation, six-size browser journeys and hosted gates remain pending. This
bounded overview does not complete Chores or the all-feature programme.

### Chores rendered checkpoint

At `ba599508`, all 93 six-size EN/ES overview, routine editor, weekly schedule
and canonical series lifecycle browser cases passed, with no skips or retries.
A further populated inline routine probe found a real phone min-content overflow
that made the focus checkbox difficult to tap. The grid now has an explicit
zero-minimum single column on small screens, and the routine disclosure can
shrink. The retained regression uses a valid long routine name and asserts
reflow before focusing, plus exact complete/Undo request IDs and database state.

At `1520ab5a`, the optimized build and all 57 final browser cases pass: 12 EN/ES
overview cases, six populated completion/Undo/focus cases, the 36 original route
JavaScript budgets and three existing sign-in setup cases. Original byte limits
are unchanged. The preceding 101 focused units and 102 domain/component units
pass (counts overlap); four affected mounted layout/role tests pass after the
grid fix. Full lint and types pass. Reports, original failed probe, capture
hashes and local build/source proof are retained in the task evidence folder.

Hosted, production, shared-device/installed-client and wider Chores acceptance
remain pending. Inherited relative-date/history/action copy still needs full
localization; this checkpoint does not claim the entire screen is localized.
The other feature coverage rows and #499/#128 remain open.

## Chores presentation continuation — 2026-10-18

A separate follow-up to #572 covers inherited action-sheet, reassignment,
history, relative-date, rotation/streak and recurrence-summary copy. Household
names, IDs, dates and raw server failure details remain parameters/data. The
shared row sheet localizes only its own More actions/for/Cancel labels, keeping
custom labels, focus, open state and callbacks intact. Reassignment keeps the
selected canonical ID through a locale change. Existing date/cadence helpers
accept explicit presentation labels and preserve their English defaults and
all date-only/grouping policies. Weekday labels reuse the schedule dictionary.
No model, API, role, profile gate, timer, scheduler or provider change is made.

The inventory removes exactly 17 migrated occurrences (897 to 880); its original
guard and other migration records remain unchanged. The full local unit run
passes 5,723 tests with 387 established opt-in skips; the same three inherited
Mac backup-prune cases fail, with no backup script/test source changed. Types,
touched lint and independent source/role/date review pass. New mounted cases
cover raw names, selected weekdays, next dates, zero-write disclosure, dialog
selection through locale change, exact reassignment/snooze IDs and date payloads,
raw history failures and shared-sheet keyboard/focus state.

Rendered review found selected reassignment roles at only 1.28:1 contrast.
Selected roles now inherit the selected foreground. Long names wrap in a bounded
name column, while avatars and translated roles remain visible. No Axe rule or
threshold changed. The contrast repair passed 69 browser checks across all six
sizes, including real series lifecycle and inline completion/Undo. Final
long-name polish at `98be796c` passed its build, 73 affected units and 51 browser
checks (12 EN/ES dialogs, 36 original startup budgets, three setup cases), with
zero failures/skips/retries. Final phone and desktop Spanish captures were
visually reviewed; all 12 captures and hashes are retained in the local evidence
folder `work/ui-plan-approved-2026-10-17/chore-presentation-local-qa`.

Hosted #572 exposed two Spanish fallback-focus selectors still expecting
English Today. Test-only `b986c40d` uses the typed localized label and retains
focus assertions. The presentation follow-up also localizes its verification
queue selector; independent review confirms all notes, exact retry payload,
403/409, pending/network, duplicate-action, focus and privacy assertions remain.
Its exact-source build and all 27 six-size EN/ES verification checks pass
(24 recovery/pending journeys plus three setup cases).
Original hosted gates and production acceptance remain pending. This local
follow-up does not establish #571/#572 release acceptance or completion of
Chores/the all-feature programme.


## Inventory overview candidate — 2026-10-18

The bounded overview reuses canonical items, use-soon data, location filters,
Cook, History, Scan/Add and existing item/scan forms. Safety warnings stay first.
Locations precede Use soon in DOM and visual order, so phone shortcuts appear
before the food list without reordering keyboard navigation. Phones use a 2x2
shortcut grid; portrait tablets and larger screens use a narrow Locations column
beside Use soon. The desktop wrapper uses the available workspace. Main stock
uses three columns at wide sizes; Cook/history are secondary and a single panel
fills its row. No persisted capture-review records or new UPC/provider capability
are fabricated from the gallery's illustrative examples.

Counts use the active display locale. Capped positive values say At least N;
capped zero locations say Count incomplete. Shortcuts share the existing Where
filter, preserve search/category, and make no requests/writes. A selected location
adds an explicit all-locations note to Use soon, which remains a global summary.

Rendered review found selected dark-mode location text at 4.4:1. The owned
label/count now use the approved on-accent token directly; original Axe rules
and thresholds are unchanged. App source `32c72e0b` passes its build, 121 affected
Inventory/scan/localization tests, typecheck and lint. Its final six-size browser
run passes 95 checks with 10 inherited phone-only user-menu skips and no failures
or retries. The formerly excluded large tablet now runs the full Inventory
journey. Coverage includes EN/ES, primary shortcuts above the phone tab bar,
44px/focus/reflow/Axe, real add/edit/remove, consume/discard/Undo readback, offline
refusal, child read-only/API refusal and second-household isolation. Superseded
successful layouts, failed contrast report and final 24 captures/hashes are
retained under work/ui-plan-approved-2026-10-17/inventory-overview-local-qa.

The combined candidate incorporates test-only login-client isolation `492206b0`:
real notification/routine sign-ins retain their assertions and production quota,
with unused test-client addresses after retained traces confirmed shared-bucket
429 responses. App source/API/schema/profile flags/providers/schedulers/native
contracts remain unchanged. Original hosted gates, integration acceptance,
exact-main checks, protected recovery and production verification remain open.
This slice does not complete all Inventory or the all-22-feature programme.


## Bounded Family overview checkpoint — 2026-10-18

Application source `695b6747` improves the existing parent-only account roster:
responsive one/two/three-column cards, wrapping raw names/emails, localized roles
and owned copy, explicit account-member labels and existing invite/settings/
Emergency/Explore destinations. Removal retains encoded canonical IDs, self/last-
parent guards, pending protection, raw server refusals and retry. Successful local
removal returns focus to the roster. Duplicate IDs are rejected; retry clears old
state and missing membership offers the existing create/join routes.

44 affected mounted/API/copy tests, typecheck, full lint, required formatting and
optimized build passed. 63 browser checks cover real roster/privacy reads,
child DELETE 403, cross-household DELETE 404, 44px targets, Axe, reflow, keyboard,
synthetic removal/retry/pending/focus and 36 unchanged startup-budget checks. A
further 15 checks cover EN/ES loading, failure/retry, empty, missing-household and
real browser offline removal/recovery across all six sizes (both totals include
three setup checks). Positive removal uses intercepted responses; canonical
fixture roster readback stays unchanged. 24 captures/hashes, logs and the retained
first state-selector failure are in the task's `family-overview-local-qa` evidence
folder. Independent source and visual reviews pass. A scroll-reachable fixed-tab
viewport overlap on the smallest phone is recorded as nonblocking shared-shell
polish.

This is bounded account-roster alignment, not full Family adoption: Add Everyone,
email-free profile presentation/account linking and their existing capability
contracts remain separate open acceptance. No profile flag, provider, scheduler,
API/schema or permissions change is introduced. Hosted candidate QA, normal
merge, exact-main/recovery and production evidence remain pending.


## Integrated core checkpoint — 2026-10-18

PR #574 and incorporated #569–#573 are merged at `f1d103a8`, with an identical
reviewed candidate tree `641f0714`. Original candidate build/image, Android, all
viewport shards, recovery, Settings, inventory and email-free-profile routine QA
passed. Fresh pre-merge protected recovery restored all 71 public tables and
removed its temporary database. Source deployment 558 finished at 2026-10-18T06:15:35Z; public version/header,
healthy serving image/container revision, startup migrations and private-route
refusals verify f1d103a8. Exact-main build/image and browser QA remain in progress;
Android passed. No authenticated production household/native/customer acceptance
is inferred from runtime health.
These are bounded core/layout checkpoints, not full feature or programme closure.

## Bounded Notes checkpoint — 2026-10-18

Application `fa4948d7` improves the canonical person-session shared Notes board:
full-width responsive grid, one Add action, pinned count and honest household
visibility, five server-supported colors, complete read-only detail for other
members' notes, and wrapped titles/body previews. Short rounded form sheets keep
existing edit/delete permissions, pending/back protection and draft/refusal
recovery. Owned feedback retranslates after locale changes. Confirmed successful
writes followed by failed refresh display a single explicit notice and Retry only
repeats GET; no duplicate mutation is offered. Invalid/duplicate/color responses
enter recovery, while canonical no-household refusals close early drafts and show
existing create/join routes. Save waits for a pending roster read to settle.

42 mounted/API/copy tests, optimized build and independent source review pass.
Original role alignment plus 36 unchanged startup budgets pass in six sizes:
78 cases and 15 inherited desktop-only scope skips. Added EN/light and ES/dark
Axe/reflow, read-only full-body/no-input/no-mutation/focus, real child/teen ownership
refusals, two-household and shared-device boundaries remain intact; 36 actual
overview captures plus 12 household-state captures are retained locally. Expanded
state checks verify malformed/empty responses, real offline refusal and confirmed
writes followed by failed refresh. Feature and seeded-note cleanup are verified.
Final publishing-head checks, visual signoff, hosted acceptance and release are
pending. Gallery private-note/expiry examples need a separate canonical contract;
they are not represented as working controls. No schema/API, permission, profile,
provider, scheduler, native or infrastructure change is introduced.


Final Notes QA resolved two additional real rendered findings before publication:
a flex-growing preview measured 90px against a three-line 61px bound, and successful
save/refresh recovery left focus on the body after replacing the opener. Previews
now retain their three-line height; confirmed save/delete and household recovery
focus the heading, while opening a new form clears old feedback so Cancel restores
its opener. The existing parent deletion case now uses the UI and retains real
DELETE 200, persisted absence and cross-household refusals. Both failed diagnostics
are retained. Actual viewport footer hit tests adjudicate the earlier full-page
capture overlap: after scrolling, each launcher is >=44px, at least 8px above the
tab bar and hit-testable. No shared-shell workaround was introduced. Final source
`fa4948d7` passes 78 browser cases/15 unchanged scope skips, with source and visual
signoff. Wider feature/private-note/expiry, hosted and release acceptance stay open.

## Dates authority and overview continuation — 2026-10-18

The Dates continuation retains `/dashboard/anniversaries`, canonical UTC date-only
storage and viewer-local annual ordering. All four handlers explicitly refuse a
live paired device before person authentication. Additive GET permission grants
match existing parent/all versus teen-child/own-edit authority; delete stays
parent-only. Missing grants open conservative read-only details. Required Name,
Type and Date precede optional Notes in the shared form sheet; localized dates,
wrapping mixed-type chronology and one Add action follow the approved direction.

Initial affected checks and independent source review pass. Exact-source build,
rendered six-size EN/ES state and actual role/isolation journeys remain pending.
This checkpoint does not close the Dates recovery audit: stale refresh and unknown
write outcomes still need a canonical-state recovery slice, and annual wording
does not claim scheduled reminders. Full-feature and #499/#128 acceptance remain
open. No schema, role-policy widening, profile/provider/scheduler activation or
native/store change is included.

At app `7f2e6417` / final test head `7704da0f`, all 128 affected checks and 77 compiled
browser cases passed, with 10 declared desktop-only boundary scopes skipped on
other projects. All six sizes include EN/light and ES/dark, actual role/grant
and two-household checks, a proven live device and all four API refusals,
loading/malformed/empty/form/focus states and unchanged startup budgets. 48
viewport captures are retained. Visual/hosted/release acceptance remains open;
receipt recovery is a separate unaccepted continuation. A stale Dates route
allowlist and missing kid-menu entry were repaired against D9; original APIs
remain role-scoped and no Settings/device/finance route was widened.

Supplemental source e5d2247e passes 15 additional state checks (12 EN/ES journeys
plus 3 setup) with retained phone scroll/focus/hit geometry and 4 footer captures.
Independent review of all 52 captures withdraws the initial apparent 390px clipping:
the expanded list is scrollable, and its final row is fully reachable above the
fixed bar. There is no remaining material visual blocker. Source/UI recovery,
hosted and release acceptance are still separate gates.

## Bounded Progress overview checkpoint — 2026-10-18

The approved Progress study (Figma `84:204`, gallery `gamification`) is adapted
to the parent-only `/dashboard/analytics` workspace. It summarizes weekly
completion, optional points/streaks, semantic seven-day trends and member
contributions using the existing canonical API. Long names wrap and error/empty
states remain distinct. Malformed successful responses show Retry rather than
false zero activity. Scoped EN/ES copy uses existing semantic theme tokens.
The pure presentation parser stays outside the Next page exports.

At application source `20eef6ac`, optimized build, full lint, typecheck, seven
mounted UI cases and eight localization guards pass. API/isolation/gamification
checks pass 29 cases, including parent/teen/child reads through the real helpers,
feature refusal, paired-device refusal and two-household scoping. The page remains
parent-only; this does not widen child/teen routes or parent controls.

The first browser run caught a test selector matching Next's hidden route
announcer as well as the real error card. The corrected selector scopes to main
without weakening malformed/error/empty assertions. The full six-size EN/light
and ES/dark matrix then passed 15 cases, zero failures/retries, at the same
compiled application with that test-only delta. 36 populated/error/retry captures
are retained locally. A full stable-source local unit run passed 5756 cases with
387 established opt-in skips and the three retained Mac backup-prune failures.
Earlier disk-full and selector failure reports are retained; they are not passes.

This is a bounded parent Analytics/Progress adaptation. Persisted quiet mode,
child/teen home gamification, full feature/state acceptance and original hosted
release gates remain open. No API/schema, role-policy, scheduler/provider/profile
activation or native/store change is included.

## Combined candidate boundary — 2026-10-18

The Dates, parent Progress and saved-work recovery heads are normally integrated
with their original history retained. Source review and combined baseline/real
Dates database checks pass at `f9efd20c`. Exact combined build, responsive
journeys, original hosted gates, protected restore, merge and production proof
remain pending. Per-feature wider acceptance and all unadapted rows above stay
open. No constellation of narrow passing checks completes the full22-feature
programme. Saved screenshots and runtime proofs are in the existing task's
`work/ui-plan-approved-2026-10-17/` evidence directories.

## Combined release follow-through — 2026-10-18

The combined Dates, Progress and saved-work slice is merged in #580 and serves
main `5cf9720b`, exactly the reviewed `b342ee24` tree. All original candidate
gates passed, protected restore verified 71 public tables, automatic Coolify
deployment560 finished, and exact serving image/revision/health/startup
migrations were verified. Main Android passes; exact-main Build/E2E are still
running at this checkpoint. See `docs/CURRENT_STATE.md` and the live PR record.
No earlier broader-pending row is thereby marked fully accepted. Rewards and
Budget remain separate subsequent local work; all22feature acceptance stays open.
