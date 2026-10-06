---
version: alpha
name: Herewoven
description: A crafted, calm household organizer; working rebrand draft.
colors:
  primary: "#322C43"
  secondary: "#645870"
  tertiary: "#A3452A"
  neutral: "#FBF7F0"
  paper: "#FFFDF9"
  success: "#4E7148"
  decorative-sage: "#8FB283"
  decorative-ochre: "#D9A33A"
typography:
  display:
    fontFamily: Fraunces
    fontSize: 3rem
    fontWeight: 600
    lineHeight: 1.08
    letterSpacing: "-0.02em"
  heading:
    fontFamily: Fraunces
    fontSize: 1.75rem
    fontWeight: 600
    lineHeight: 1.2
  body:
    fontFamily: Inter
    fontSize: 1rem
    fontWeight: 400
    lineHeight: 1.5
  label:
    fontFamily: Inter
    fontSize: 0.8125rem
    fontWeight: 600
    lineHeight: 1.3
rounded:
  sm: 8px
  md: 12px
  lg: 16px
  xl: 24px
spacing:
  xs: 4px
  sm: 8px
  md: 16px
  lg: 24px
  xl: 32px
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.paper}"
    rounded: "{rounded.md}"
    padding: 12px
    height: 48px
  link:
    backgroundColor: "{colors.neutral}"
    textColor: "{colors.tertiary}"
  card:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.primary}"
    rounded: "{rounded.lg}"
    padding: "{spacing.lg}"
---

## Overview

Pilot Herewoven display direction for Family Planner. This rebrand does not create a new legal entity, domain or technical app identity. Tagline: Everyday life, held together.

The app is a Monitor/Operate surface: content hierarchy and clear actions beat decoration. Landing/auth are Decide/Learn and Configure surfaces. Preserve the household model, routes, canonical APIs, privacy boundaries, feature flags, safe offline actions and installed-client identity.

This release covers the display rebrand, landing/auth, app shell and Today/kid/tablet presentation. Day/Week calendar planning remains a separate design/implementation slice; no new calendar views are claimed by this contract.

## Colors

Cream paper and aubergine ink carry the main structure. Clay signals selected/interactive treatments, not danger. Sage supports completed/success states. Ochre and pale sage are decorative only, never ordinary body text. Existing illustrations contain the legacy navy; retain them where compatible rather than generatively redraw approved source art.

Implementation retains the existing semantic CSS variable names. Separate text-safe variants, surfaces, fills, separators and focus treatment; preserve status color semantics. Undefined --surface-secondary and --background references must be replaced by canonical variables rather than inventing unrelated color systems.

Dark draft: grouped surface #171420, elevated #231E2E, warm ink #F5EEDF and lifted aubergine primary actions. Verify actual light/dark contrast pairs with the existing test before claiming compliant. Proposed values may be refined by implementation evidence; keep this contract synchronized with final CSS.

## Typography

Use the project's existing self-hosted Fraunces + Inter setup. Fraunces is for the wordmark, welcome/section display moments and editorial headings. Dense operational rows, forms, navigation and timestamps use Inter. Do not force display serif into every task row.

Use deliberate phone versus distance-readable tablet type scales. Phone tab labels must be at least 12px and clear at 320px without horizontal overflow; keep five authorized parent tabs. Touch targets stay at least 44x44 CSS px; the large fridge hub retains its larger target contract. Avoid solving long text by tiny fonts.

## Layout

Marketing: branded navigation; focused proposition; original existing illustration; a clearly labelled product preview; task-oriented explanatory sections; honest onboarding CTA. Do not build six equal feature tiles or invent social proof.

Phone Today: compact household/setup context, then schedule and actual next actions. Reduce stacked card-before-card treatment. Tablet/desktop: stable, glanceable modules and an intentional dinner emphasis. Preserve landscape board fit, privacy and internal scrolling. Kid view: fewer choices, clear routine progression, parent-check/Undo states; opt-in points remain opt-in.

Use real content or labelled synthetic fixtures. Never fetch parent-only objects for a shared screen and hide fields in CSS. Added-by is not attendance.

## Elevation & Depth

Quiet borders, restrained paper-like separation, limited shadows. Avoid glass blur, glossy gradients, floating decorative metrics and unnecessary icon tiles. Shared displays must remain readable from several feet away.

## Shapes

Friendly but controlled radii. Reuse the existing mark provisionally until a new identity asset is explicitly approved. Do not change Android applicationId com.ashbi.familyplanner, cookies/storage namespaces, URL paths or production origin for a display rebrand.

## Components

Use existing production primitives, typed variants and canonical state/mutation hooks. Maintain keyboard/focus, autofill, error/recovery, empty/loading/offline and reduced-motion behavior. Preserve old CSS aliases supporting the remaining screens. No schema/API rewrite is needed.

## Do's and Don'ts

- Keep primary tasks functional; visual-only controls may not masquerade as actions.
- Preserve original art and editable source. No paid Higgsfield generation or uploads are authorized yet.
- Keep brand facts separate from proposals; no invented pricing, testimonials or results.
- Run local exact-commit checks instead of spending GitHub Actions quota.
- Capture before/after phone, tablet, landscape, dark/night and long-text evidence.
- Record pre-existing failures separately from regressions. Never rewrite Linux visual baselines with Windows captures to make checks pass.
- A build is not deployment approval; an asset-generation approval is not publication approval.
