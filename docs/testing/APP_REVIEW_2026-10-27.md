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

- List-item delete transport loss can temporarily restore a row that the server
  already deleted. Reconcile the exact item before announcing failure; do not
  treat absence from one paginated page as proof of deletion. Track in #499/#135.
- Meal delete transport loss can remove the meal without exposing Undo. Preserve
  truthful unknown-outcome handling and reconcile against canonical data before
  offering restoration. Track in #460/#135.
- With profile setup enabled, email-free profiles are discoverable inside the
  profile panel rather than the main Family account roster. Roster integration
  remains part of #480; identity/credit/erasure decisions are unchanged.
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
