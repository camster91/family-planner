---
version: alpha
name: Herewoven
description: Herewoven household organizer; approved Woven Grove visual identity.
colors:
  chalk: "#F7F4EC"
  forest-ink: "#182D2A"
  evergreen: "#245B50"
  clay-coral: "#D76C50"
  soft-iris: "#C7B8E6"
  pollen: "#E6BD55"
typography:
  display:
    fontFamily: Newsreader
    fontSize: 3rem
    fontWeight: 600
    lineHeight: 1.08
    letterSpacing: "-0.02em"
  heading:
    fontFamily: Newsreader
    fontSize: 1.75rem
    fontWeight: 600
    lineHeight: 1.2
  body:
    fontFamily: Manrope
    fontSize: 1rem
    fontWeight: 400
    lineHeight: 1.5
  label:
    fontFamily: Manrope
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
    backgroundColor: "{colors.evergreen}"
    textColor: "{colors.chalk}"
    rounded: "{rounded.md}"
    padding: 12px
    height: 48px
  link:
    backgroundColor: "{colors.chalk}"
    textColor: "{colors.evergreen}"
  card:
    backgroundColor: "{colors.chalk}"
    textColor: "{colors.forest-ink}"
    rounded: "{rounded.lg}"
    padding: "{spacing.lg}"
---

## Overview

Herewoven remains the product name; Woven Grove is the approved visual direction. Tagline: Everyday life, held together. This is a web display adoption, not legal-name clearance, a new domain or a technical identity migration. Asset provenance and exact runtime semantic roles are in `docs/product/BRAND.md`.

The app is a Monitor/Operate surface: content hierarchy and clear actions beat decoration. Landing/auth are Decide/Learn and Configure surfaces. Preserve the household model, routes, canonical APIs, privacy boundaries, feature flags, safe offline actions and installed-client identity. No functional feature or calendar-view expansion is claimed by this visual adoption.

## Colors

All six selected swatches above are retained. Chalk and Forest Ink carry the structure. Evergreen carries primary actions, links and success. Clay Coral accents, Soft Iris and Pollen support artwork and carefully labelled states; do not use them as ordinary text on Chalk or behind white body text. Semantic status/module shades are contrast-safe derivatives, not deletions/reclassifications of the approved palette.

Existing semantic CSS names and compatibility aliases are retained. Separate text-safe variants, surfaces, fills, separators and focus treatment. No invented `--background` or `--surface-secondary` tokens.

Dark grouped/elevated surfaces: `#11211E` / Forest Ink `#182D2A`; Chalk ink; lifted Evergreen primary actions `#397D6E`, hover `#347365`, pressed `#2E685B`. Plain actions use a tinted pressed background, not faded text. Source token contrast tests are not computed browser-paint certification: themed and pressed paints must still be checked before release.

## Typography

Exact approved Newsreader and Manrope variable TTF sources with SIL OFL licenses are self-hosted via `next/font/local`. Newsreader 600 carries wordmark/display/section headings and editorial moments. Manrope 400 body and real 500/600/700 UI weights carry dense rows, forms, navigation and timestamps. No Google font build/runtime network and no synthetic static-400 bolding.

Retain operational type sizes, line heights and distance-readable tablet scales. Phone tab labels remain at least 12px and five authorized parent tabs remain usable at 320px. Touch targets remain at least 44×44 CSS px; the fridge hub retains its larger contract. Do not fix long text by shrinking fonts.

## Layout and artwork

Use the exact approved transparent Herewoven symbol without tracing, recoloring, filters or a reverse variant. Keep a Chalk backing in both themes. Browser/Apple/PWA icons use approved paper-tile art with truthful dimensions; this does not authorize native app/store changes.

Landing: branded navigation, focused proposition, approved woven hero graphic at its original aspect ratio, clearly labelled fictional household preview, task-oriented explanations and honest onboarding CTA. Auth and household setup use the approved supporting graphic; do not wallpaper operational views. No equal feature-tile grid or invented social proof.

Parent Today: household/setup context, schedule and actual next actions. Tablet/desktop retain glanceable modules, dinner emphasis, board fit, privacy and internal scrolling. Kid/teen retain clear routines, parent-check/Undo and opt-in points. Calendar, meals and routines inherit shared tokens/fonts without changing their canonical state or action logic.

Task-specific legacy spot illustrations/loops remain bounded secondary art, with their existing decorative alt, lazy/priority, intrinsic-size, reduced-motion and data-saver contracts. Legacy kitchen/auth/house-divider artwork is no longer used on landing/auth. Obsolete files stay for compatibility; do not regenerate selected artwork or replace every task-specific illustration with the same abstract banner.

## Components, privacy and compatibility

Reuse production primitives, typed variants and canonical state/mutation hooks. Preserve keyboard/focus, autofill, errors/recovery, empty/loading/offline, pending-dialog guards and reduced motion. Quiet borders and restrained paper-like separation; no glossy/glass redesign or decorative metrics.

Use real data or clearly labelled fictional fixtures. Never fetch parent-only objects on shared screens and merely hide them in CSS. Added-by is not attendance. Preserve roles/device actors, completion/verification, ICS/provider editing and windows, recipe servings/ingredients, grocery idempotency and Undo.

Do not change schema/APIs, Android `com.ashbi.familyplanner`, cookie/storage namespaces, URL paths or production origin. Offline cache version changes only to refresh public recovery/favicon bytes; its namespace, privacy scope and routing are retained.

## Release evidence

No paid generation, provider calls, native release or remote writes are needed for this source adoption. The six-color brandbook exporter limitation is unrelated and must not be solved by dropping colors or supplying a fake export.

Local RAM is constrained: focused tests only, sequentially. `docs/testing/WOVEN_GROVE_ADOPTION.md` records observed RED→GREEN source/SSR/token evidence and deferred gates. Parent/CI owns full build, final phone/tablet/dark/reflow/pressed-paint browser evidence and release checks. Never update visual baselines, masks or tolerances blindly. Passing source checks is not deployment approval or a claim that the rendered app is green.
