# ADR-0003: Use one Figma-first adaptive design system across phone and tablet

**Status:** Accepted
**Date:** 2026-09-08
**Related:** #119, #130, #131, #132, #133, #143

## Context
The existing app has an Apple-HIG-inspired token/component foundation, but the new fridge experience requires an intentionally designed large-screen hierarchy and original visual personality. Forking separate phone/tablet component systems would create drift and maintenance cost.

## Decision
Use one semantic token system and reusable component library mapped from Figma to code. Components may adapt composition/size/navigation pattern by available window class, but business logic and visual language remain shared.

Use Apple HIG and curated Dribbble work as research inputs for clarity, hierarchy, interaction and delight; create original compositions/graphics and respect Android platform behaviour.

## Consequences
Requires stronger component variants, responsive layout rules, design handoff, visual regression and a component state gallery. Reduces one-off screen styling and makes large-scale UI work agent-friendly.

## Accessibility
Tokens/components must encode target size, focus, contrast, reduced motion and non-colour status alternatives. Accessibility overrides aesthetic imitation.

## Validation
A new screen should be implementable primarily by composing documented tokens/components; representative phone/tablet frames and visual states pass #139.

## Revisit trigger
Only if a future native platform surface proves that a shared system cannot meet platform UX/performance needs without harmful abstraction.