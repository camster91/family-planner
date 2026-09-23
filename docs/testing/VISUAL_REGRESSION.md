# Visual Regression Strategy

Visual regression protects the premium design system from silent drift; it is not a substitute for UX review.

## Canonical capture set
Capture approved key components/journeys at:
- 390×844
- 430×932
- 800×1280
- 1280×800
- 1920×1200 where useful

Include light/dark/fridge-night plus meaningful empty/loading/error/offline/success/long-text states.

## Determinism
Use synthetic fixtures from `TEST_DATA.md`. Freeze/normalize dates, time, generated IDs and animation state where required. Do not use production screenshots as test fixtures.

## Review policy
- A visual diff must be inspected by a human/agent and explained in the PR.
- Never blindly update snapshots to make CI green.
- Expected visual changes should link the Figma/spec/issue.
- Unexpected changes to unrelated routes/components are regressions until explained.

## Accessibility
Visual snapshots do not prove accessibility. Pair with semantic/keyboard/contrast/reflow tests and manual checks from `QA_MATRIX.md`.

## Implementation target
#139 child work should select a practical browser screenshot harness (for example Playwright) and a component/state gallery. Android-native chrome/lifecycle still requires device/instrumentation checks.

## Asset stability
Custom illustration/app-icon exports should have documented source/version/export settings so unintentional raster/colour/size changes are reviewable.