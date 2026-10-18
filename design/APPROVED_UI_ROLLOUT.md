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
| Chores | Grouped series, selected weekdays, clear owner, contextual actions | Existing behavior retained; approved layout review pending |
| Calendar | Readable week/agenda, duration and clear connection controls | Existing behavior retained; approved layout review pending |
| Lists | Direct groceries, custom lists, simple create/edit | Existing behavior retained; form simplification next |
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
