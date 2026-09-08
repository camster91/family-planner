# Agent-Ready Backlog — First Build Queue

Master roadmap: #128. Workstream epics: #130–#146.

## Wave A — ready for analysis/design now
- #147 Repository agent-ready/source-of-truth foundation (this branch/PR).
- #148 Route/component/domain + placeholder-data audit.
- #150 Figma reference board + premium visual direction.
- #154 Deterministic two-household test fixtures (may defer canonical meal fixture details until #149).
- #157 Shared-device session/pair/elevation/revoke contract.
- #161 Observability/request/build identity foundation can begin as a narrow non-provider slice.

## Wave A decisions that unblock implementation
- #149 Canonical meal/recipe/grocery/list data decision — after #148.
- #151 Adaptive IA + five user modes — after #148, coordinated with #150.

## Wave B — reusable implementation foundations
- #152 Figma/code tokens/components — after #150.
- #153 Adaptive app shell/navigation — after #151 + sufficiently stable #152.
- #155 Playwright/E2E/visual/a11y harness — after #154.
- #156 Protected development component/state gallery — can start with current primitives; align after #152.
- #160 Android AAB/lifecycle baseline — independent of most product UI, coordinate with #138.
- #163 Original app icon/illustration language — after #150.

## Wave C — first product verticals
- #158 Inventory/expiry backend foundation.
- #159 Real-data Today/fridge dashboard — after IA/shell and canonical meal/grocery reads.
- #162 Offline/idempotency queue foundation — after #157 + fixtures; domain actions opt in.

## Selection rule
Choose the earliest unblocked issue that can be completed in one reviewable PR. If a task grows beyond that, split it before implementation. Every PR follows `AGENTS.md` and `DEFINITION_OF_DONE.md`.

## Human gates
None of these issues authorize merge, production deployment, Play publication, credentials/permissions/billing/spend, participant outreach or destructive production data changes.