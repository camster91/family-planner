# Family Planner Design

## Source of truth

Significant UX/UI work is Figma-first where practical. The editable source below is **prepared for review**, grounded in merged source `e0c7dac` (2026-10-07). The approved Woven Grove brand remains the visual direction; creation of this file does not approve every journey, legal identity, native icon, or night-mode design.

[Herewoven — Woven Grove foundations and journeys · review](https://www.figma.com/design/s0qsOr91Au0OJ70SCZEWb4)

| Page                            | Review frame                                             | Node                                                                       |
| ------------------------------- | -------------------------------------------------------- | -------------------------------------------------------------------------- |
| `01 · Woven Grove foundations`  | `Woven Grove · source-matched foundations · review`      | [3:2](https://www.figma.com/design/s0qsOr91Au0OJ70SCZEWb4?node-id=3-2)     |
| `02 · Journey and privacy maps` | `Journey maps 1 · review` (onboarding, pairing, morning) | [7:58](https://www.figma.com/design/s0qsOr91Au0OJ70SCZEWb4?node-id=7-58)   |
| `02 · Journey and privacy maps` | `Journey maps 2 · review` (evening, event, grocery)      | [7:140](https://www.figma.com/design/s0qsOr91Au0OJ70SCZEWb4?node-id=7-140) |
| `02 · Journey and privacy maps` | `Journey maps 3 · review` (meal, task, parent mode)      | [7:222](https://www.figma.com/design/s0qsOr91Au0OJ70SCZEWb4?node-id=7-222) |

[Source token map](FOUNDATIONS.md), [review inventory](tokens/woven-grove-review.json), and [IA/journey disposition](JOURNEYS.md) describe exact coverage and remaining acceptance work. The journey cards are state/decision annotations, not production screen components. #131/#152 owns production foundations; #132/#151 owns adaptive journey acceptance.

## Reference and composition review — 2026-10-08

The following additions were prepared against merged source `9058d58`. They preserve the approved Woven Grove identity and compare original layouts inside that direction. [Composition handoff](COMPOSITIONS.md) records the rationale, engineering mapping, exact validation and remaining #150 acceptance. None of these proposals is a production change or a physical-device result.

| Page                                 | Review frame                                                          | Node                                                                       |
| ------------------------------------ | --------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| `03 · Reference principles · review` | Reference principles · source links and original application · review | [31:3](https://www.figma.com/design/s0qsOr91Au0OJ70SCZEWb4?node-id=31-3)   |
| `03 · Reference principles · review` | Woven Grove · five original moods · review                            | [34:2](https://www.figma.com/design/s0qsOr91Au0OJ70SCZEWb4?node-id=34-2)   |
| `04 · Composition studies · review`  | Woven Grove · composition alternatives and adaptive review            | [53:2](https://www.figma.com/design/s0qsOr91Au0OJ70SCZEWb4?node-id=53-2)   |
| `04 · Composition studies · review`  | Study family · eight responsive state examples                        | [54:58](https://www.figma.com/design/s0qsOr91Au0OJ70SCZEWb4?node-id=54-58) |

The study component family is an editable design aid. Its instances receive explicit state text; selecting its `State` property alone does not supply state-specific copy. The existing journey maps cover loading/error branches separately. #150 remains open for the original distance and acceptance criteria; #163 owns original graphic assets.

## Member setup review — 2026-10-11

[Adaptive member setup](MEMBER_SETUP.md) extends the existing composition page with original phone, portrait-tablet and shared-fridge proposals for #480: add everyone by name, email optional, verified account linking later and shared attribution without privilege. [Review board 71:267](https://www.figma.com/design/s0qsOr91Au0OJ70SCZEWb4?node-id=71-267). Static editable designs were visually inspected after reflow repairs; canonical implementation, full state coverage, journey acceptance and native evidence remain open.

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
