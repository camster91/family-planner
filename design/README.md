# Family Planner Design

## Source of truth
Significant UX/UI work is Figma-first where practical. The canonical Figma file/link should be recorded here once created/approved. Until then, issue #130 defines reference research and #131 defines the production design-system deliverables.

## Required design artifacts
- reference/moodboard board with borrow/avoid notes;
- foundations: colour, type, spacing, grid, radius, elevation, motion;
- components with variants/states;
- tablet/phone navigation and information architecture;
- key journey flows;
- original graphic/illustration language;
- light/dark/fridge-night modes;
- accessibility annotations;
- responsive frames and long-text states.

## Frame baselines
- 390×844 phone
- 430×932 phone
- 800×1280 portrait tablet
- 1280×800 fridge landscape
- 1920×1200 large tablet

## Component handoff
Every production component should define:
- purpose and when to use;
- content hierarchy;
- variants/sizes;
- default/pressed/selected/disabled/loading/error/offline states as relevant;
- responsive behaviour;
- accessibility semantics;
- motion/haptic behaviour;
- code token/component mapping.

## Graphic handoff
Original assets need a clear owner/source and export rules. Prefer vector/resolution-independent artwork when appropriate. Keep text out of illustrations unless localization variants exist. Optimize exported images for Android/web performance.

## Engineering mapping
Figma foundations map to semantic CSS/design tokens; components map to typed React variants. Avoid per-screen one-off tokens. The dev visual gallery/visual regression issue should display canonical component states.

## Reference policy
Read `REFERENCES.md`. References are pattern research only, never permission to copy compositions/assets.

## Completion principle
A screen is not “designed” until happy, empty, loading, error, offline/stale and permission states relevant to that journey are accounted for.