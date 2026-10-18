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
| Shared personal navigation | Five parent tabs, searchable Explore, Family within Core | Candidate in progress; child/teen tabs retained |
| Today (person home) | A capped Next up card, dinner and a quiet look ahead | Candidate combines scoped events/chores; focused checks/source review passed, rendered and hosted acceptance pending |
| Chores | Grouped series, selected weekdays, clear owner, contextual actions | Existing behavior retained; approved layout review pending |
| Calendar | Readable week/agenda, duration and clear connection controls | Existing behavior retained; approved layout review pending |
| Lists | Direct groceries, custom lists, simple create/edit | Candidate compact overview and short create form; bounded source/runtime review passed, hosted acceptance and detail-context review pending |
| Family | Add everyone, email-free profiles, clear account-link distinction | Existing behavior retained; approved layout review pending |
| Meals | Week plan, recipes, several-dish prep, eaten/remaining/next prep | Existing behavior retained; approved layout review pending |
| Inventory | Use soon, honest capture review, quantities and locations | Existing behavior retained; approved layout review pending |
| Notes | Short shared notes and clear visibility | Existing behavior retained; approved layout review pending |
| Anniversaries | Upcoming dates without duplicate noise | Existing behavior retained; approved layout review pending |
| Gamification | Optional quiet progress, meaningful dependencies | Existing behavior retained; approved layout review pending |
| Rewards | Clear costs and role-appropriate actions | Existing behavior retained; approved layout review pending |
| Budget | Private summaries and contextual details | Existing behavior retained; approved layout review pending |
| Projects | Next steps, owner and detail context | Existing behavior retained; approved layout review pending |
| Messages | Private conversation linked to work | Existing behavior retained; approved layout review pending |
| Analytics | Useful private trends, dependency-aware | Existing behavior retained; approved layout review pending |
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
