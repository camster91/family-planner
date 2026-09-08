# Agent-Ready Backlog

Master roadmap: #128. Repository foundation: #147 / PR #129.

## Blocked until repository reconciliation merges

- #147 is implemented on `plan/fridge-tablet-program`, but PR #129 remains blocked by required checks.
- No autonomous coding agent should assume `master` contains this backlog while PR #129 is open.

## Next five execution issues

1. #148 — route/component/domain and placeholder-data audit.
2. #149 — canonical meal/recipe/grocery/list decision, using #148 evidence.
3. #150 — Figma reference board and original premium visual direction.
4. #151 — adaptive IA and five user modes, using #148 and coordinating with #150.
5. #152 — align production tokens/components after #150.

#150 can proceed as design analysis beside #148. #149 and #151 remain evidence-dependent on #148.

## Following foundations

- #153 adaptive shell — after #151 and sufficiently stable #152.
- #154 deterministic two-household fixtures — meal/grocery fixture shapes wait for #149.
- #155 E2E/visual/accessibility — after #154.
- #156 protected design/state gallery — align final variants after #152.
- #157 shared-device contract — after #147, coordinated with #151.
- #158 inventory backend — after #147; remain independent of unresolved meal/list decisions.
- #159 real-data Today dashboard — after #149 and #151–#153; inventory depends on #158.
- #160 Android AAB/lifecycle baseline — isolated platform track; shared-session/kiosk work follows #157.
- #161 observability foundation — narrow privacy-safe slice.
- #162 offline/idempotency — after #154 and #157.
- #163 original graphics — after #150, integrated through #152/#156.

## Existing release gates

#84, #85 and #102–#110 remain active. Planning and refactor work must not bypass security/isolation, hosted/Ashbi CI, email, migration disposition, QA, exact-artifact promotion, beta evidence, calendar validation or pricing/billing validation.

## Human gates

No issue authorizes merge, production deployment, Google Play publication, secrets/DNS/access/billing changes, spending, participant outreach or destructive production data changes. Cameron's explicit approval is required for the exact external action.
