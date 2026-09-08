# Current State

**Last reconciled:** 2026-09-08
**Repository:** `camster91/family-planner`
**Default branch:** `master`
**Programme branch:** `plan/fridge-tablet-program`
**Agent-foundation branch:** `plan/agent-ready-foundation`

This is a snapshot, not a substitute for inspecting current source before changing it.

## Verified source baseline
- `package.json` currently specifies Next `^16.3.2`, React 18, TypeScript, Prisma 7.9.x, PostgreSQL adapter, Tailwind 3.4, Zustand, Zod and Capacitor 8.
- Android package exists under `android/` and uses Capacitor.
- CI/workflows include web validation/build/deploy paths and an APK workflow.
- Production app/review/deployment history is documented in `docs/PRODUCT_PROGRAM.md`; do not assume current production identity without fresh runtime verification.
- Auth is self-hosted JWT/session based. `src/lib/supabase/server.ts` is a legacy-named compatibility helper, not evidence that Supabase is the active auth platform.

## Existing product domains
The repository already includes household/member roles, chores/tasks/rewards, calendar/events, lists, meals, recipes/meal-plan/import foundations, messages, notifications, budget/finance archives, projects, notes, anniversaries, locations, pickups, allowance, emergency, handoff, wishlist, travel, sick-day/medication and analytics-related code.

## Known architectural cleanup
- The schema contains both older and newer meal/list concepts. Do not add a third path. Canonicalization is tracked in #134 and #143 and must be decided before new cross-domain write flows are built.
- The current parent dashboard contains placeholder presentation behaviour that must be removed during #143; new work must not copy those stand-ins.
- Large-screen/tablet UI currently derives from the general dashboard; the new fridge experience has not yet been implemented.
- Dedicated shared-device identity/session, inventory/expiry, robust offline mutation queue and production-grade Play Store path are planned but not currently proven shipped.

## Active programme
The end-to-end fridge/tablet programme is in `docs/FRIDGE_TABLET_PROGRAM.md` on the planning branch/PR and master issue #128. Cross-cutting issues #130–#146 define design, architecture, scale, Android, QA and operations quality bars.

## Existing release blockers/gates
Do not bypass the pre-existing Family Planner P0/P1 release programme. Issues #84, #85 and #102–#110 remain relevant to security, CI/release, email, migration, QA, beta, calendar validation and commercialization.

## Current implementation priority
1. Make the repository/source-of-truth agent-ready.
2. Complete Phase 0 decisions (#127) and premium design/IA foundations (#130–#133).
3. Inventory current routes/models and establish canonical data contracts (#143/#134).
4. Build the new shell/dashboard as reviewable vertical slices (#119).
5. Add shared-device/Android appliance architecture (#120), then inventory/meal/grocery/sync flows.

## Approval state
Repository planning/docs/non-production implementation may proceed through reviewed PRs. This snapshot does not authorize production deploys, merges, Play publication, secrets/permissions changes, paid providers, billing, participant outreach or destructive production data changes.