# App review — 2026-10-27

Baseline: `0960e64d` (PR #602), based on deployed `25957535` (PR #601).
Four independent agents reviewed household/roles, food/lists, calendar/assistant,
and settings/secondary screens/offline source. This is a bounded review, not
certification that every feature, failure mode or device is bug-free.

## Confirmed findings addressed in this follow-through

| Finding | Change | Evidence |
| --- | --- | --- |
| Today controls menu clips off the left of a phone | Anchor the mobile menu inside the navigation container; keep desktop alignment | Chromium reproduced x=-52px at390px; role/viewport regression added |
| Eaten form remains enabled after another device consumes the last portion | Clear and disable exhausted inputs; guard submission; explain no portions remain | Component regression uses canonical reload with zero portions |
| Calendar notification opens the current range instead of its event | Use the authorized target as the fallback navigation date, respecting explicit navigation and viewer timezone | Server/client focused regression |
| Review Inbox drops the selected chore | Pass the canonical chore ID through the existing focus route | Link regression |
| Assistant grocery recovery opens every list | Open the existing grocery destination with localized recovery copy | Unknown-result recovery regression |
| Child/teen reward link redirects home | Show the full-shelf link only to roles authorized for that destination | Child/teen and parent regression; existing reward shelf retained |

The existing all-feature browser journey was also corrected to open the native
Add disclosure before finding its links, and to check the actual Features URL.
Its role, accessibility and visibility assertions remain in place.

## Rendered baseline coverage

27 parent route entries were loaded in local Chromium at390×844 and1366×768,
with fabricated household data and all22 household feature flags enabled:
Today, chores, calendar, lists, family, meals, inventory, notes, anniversaries,
analytics, rewards, budget, projects, messages, wishlist, emergency, locations,
pickups, allowance, travel, handoff, sick days, Settings, notifications, Explore,
Features and Help. All54 valid page loads returned200 with no page exceptions,
horizontal document overflow or serious/critical axe findings in main content.
Screenshots were captured; representative calendar, Meals, Explore and Settings
screens were visually inspected. The menu finding required opening the control;
a clean initial page does not prove every dialog/action is correct.

Two setup mistakes were corrected before counting evidence: the initial local
build lacked its revision label; the exploratory route list included a nonexistent
`/dashboard/family/features` instead of `/dashboard/features`. Those failed runs
are not app regression evidence.

Local baseline artifacts: `/tmp/family-app-render-review/results.json`,
`/tmp/family-features-render-review/results.json`, and adjacent screenshots.
The first file retains the two invalid-route records for transparency; the second
contains the correct Features page results. No production household data was used.

## Retained follow-ups

- Some all-role APIs intentionally have narrower child/teen page access. The
  role matrix and UI policy need reconciliation under #499/#136; this review
  does not grant new permissions.

A proposed missing-migration finding was rejected: historical "unapplied" source
notes do not establish the state of the database after PR #601's release.

## Boundaries

No new provider calls, scheduler activation, production-data changes, native
hardware/store acceptance, real email delivery, or beta acceptance. The review
uses source, targeted tests and local browser evidence. Final commands and
results belong to the follow-through PR. PR #602's required build/test and fresh
image checks passed; it was still unmerged when this review began.

## Final local validation

Application candidate `8c9c33bd` passed typecheck, affected-source ESLint, the
production build, nine focused suites (122 tests), and independent final review.
The revised all-feature browser journey passed21 checks: three sign-in setups
and parent/teen/child × EN/ES at390×844,1280×800 and1366×768. It checks opened-menu
bounds, role controls, navigation, feature toggles and serious/critical axe
findings in the tested navigation/pickup surfaces. No retries were configured.

The phone menu's measured left edge moved from-52px to16px, with its full224px
width inside390px. The after screenshot was visually checked. A separate real
browser/DB fixture check verified that a notification for Monday01:00UTC opens
Sunday December6 in Toronto, and an explicit January12 date still wins. The
fixture event was restored afterward.

Final local artifacts: `/tmp/family-app-review-fixed-report/index.html`,
`/tmp/family-today-controls-after.png`, `/tmp/family-calendar-focus-after.png`.
These are local results, not deployment or native-hardware evidence.

## Follow-up fixes verified

Application candidate `7666791f` addresses the three remaining recovery/roster
findings. Lost list-item and meal DELETE responses use exact household-scoped
reads before offering Undo; unresolved outcomes remain explicitly unknown.
Received DELETE 404 responses remove stale UI without offering Undo for another
device's deletion. Meal recovery deletes bind the captured owner/session context
inside the existing authority transaction. Shared-device permissions are unchanged.

When profile setup is enabled, the Family page lists email-free household profiles
separately from login accounts. Latest-request guards prevent stale reads hiding
newly saved profiles, and authorization loss clears profile cards. The production
profile feature gate is unchanged.

Validation: 129 focused tests across six suites passed; typecheck, affected-source
ESLint, diff whitespace checks and the production build passed. Six browser cases
plus three sign-in setups passed without retries on phone390 and desktop1366.
Real local DELETEs committed before their responses were deliberately dropped;
Undo restored exactly one list item and meal. The profile roster persisted across
reload, with no horizontal overflow. Representative phone roster and Undo plus
desktop meal Undo screenshots were visually inspected.

Local report: `/tmp/family-review-followup-report/index.html`. Browser fixtures
were fabricated and cleaned afterward. The browser spec's initial unexecuted
button selector was changed to exercise the existing list swipe gesture. These
are local results; this follow-up has not been merged or deployed.

## Design-system corrections

Candidate `b8471e1a` replaces undefined surface/border variables with existing
semantic tokens across the affected forms, notices and shared overlays. The
gallery now correctly names Newsreader/Manrope. Grocery left-swipe deletion uses
the red trash treatment and has a visible, localized, keyboard-accessible Delete
button with a minimum 44px target. Both paths retain the existing authorization,
unknown-outcome recovery and Undo. Cancelled pointers do not invoke actions;
ordinary checkbox taps remain functional and reduced motion disables the swipe
transition.

Validation: 47 focused component/gallery/font/palette tests passed; typecheck,
scoped ESLint (four existing warnings, no errors), whitespace check and production
build passed. Browser checks: 45 passed without retries (36 gallery cases on phone,
portrait tablet and fridge; six recovery/profile cases on phone and desktop;
three sign-in setups). Eighteen configured viewport exclusions skipped as designed.
Gallery cases include light/dark/night/long-text, empty states, overflow, axe,
dialog/sheet focus and error focus. Real grocery writes verified checkbox taps,
44px Delete targets and keyboard Enter deletion followed by working Undo despite
a deliberately lost response. Light/dark grocery specimen screenshots were
visually inspected. Local report: `/tmp/family-design-fixed-report/index.html`.

No production settings, permissions, migrations or provider calls changed. These
are local browser results, not native-device or deployed acceptance.

## Returning-session homepage routing

User report: opening the app root showed marketing despite an existing sign-in.
Source cause: middleware validated/redirected login and register, but excluded `/`.
Root now uses the same current-session resolution and routes valid sessions to
`/dashboard`, preserving canonical parent Today, child/teen home and no-family
onboarding. Anonymous, malformed and revoked cookies remain on marketing; database
failure does not grant access or create a redirect loop. Existing paired-device
entry precedence is unchanged. Root responses are private/no-store, including
anonymous and device redirects. No new login/session lifetime is introduced.

Observed:51 focused auth/device/teen middleware tests passed. Final production
build, affected ESLint and whitespace check passed (an initial test-fixture union
typing error was fixed before the final build).9 browser cases passed:3 sign-ins
plus parent, child and anonymous root journeys on phone/desktop, including bookmark
query strings and reload. Report: `/tmp/root-session-report/index.html`. No live
user cookies were inspected, and no merge or deployment is claimed.
