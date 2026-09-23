# QA Matrix

This is the default representative matrix. Individual issues may require more.

## Viewports/windows
- 390×844 phone
- 430×932 large phone
- 768×1024 tablet
- 800×1280 portrait tablet
- 1280×800 fridge landscape
- 1920×1200 large tablet
- 1366×768 support desktop
- Android split-screen/resized window where relevant

## Visual/data states
For visible user journeys test relevant combinations of:
- normal/populated
- first-use/empty
- loading/skeleton
- validation error
- server error
- offline/cache
- stale/pending sync
- conflict/retry
- success/undo
- long text/pseudolocale
- light/dark/fridge-night
- reduced motion

## Roles/contexts
- parent
- teen
- child
- shared device
- unauthenticated/expired/revoked where applicable

## Critical journeys
1. register -> create/join household -> first useful action;
2. invite/member role path;
3. pair/revoke shared tablet;
4. dashboard schedule/meal/grocery/task rendering;
5. calendar create/edit/recurrence/timezone;
6. chore/task complete -> parent verify -> reward;
7. inventory add -> use soon -> meal -> missing ingredient -> grocery;
8. phone grocery change -> tablet sync;
9. offline safe action -> restart -> reconnect -> exactly-once server result;
10. permission denial/deep link/notification destination;
11. account export/deletion and last-parent protections;
12. old Android client/server compatibility for supported window.

## Accessibility
- semantic headings/landmarks
- accessible names/labels
- keyboard/focus order and visible focus
- >=44×44 CSS px primary targets
- colour contrast
- no colour-only meaning
- reduced motion
- 200–400% zoom/reflow where web applicable
- Android high text scale
- screen-reader sanity checks for critical actions

## Android lifecycle
- cold/warm launch
- background/foreground
- rotation/configuration change
- process death/WebView restart
- network loss/reconnect/flapping
- permission denial/revocation
- install/update over previous build
- system back/deep links

## Security negative matrix
For each family-owned domain:
- foreign-family read
- foreign-family write
- foreign related-ID injection
- teen/child parent-only route
- shared device prohibited field/action
- revoked/expired session
- direct API bypass attempt

## Evidence
PR/release evidence should identify exact commit/artifact and test environment. Visual diffs require review; never update baselines blindly just to get green.