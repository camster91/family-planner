# Build Execution Order

Issue dependencies are authoritative within the source order in `docs/START_HERE.md`. Do not begin the product refactor until #147 / PR #129 is merged through the normal protected flow.

## Gate 0 — repository reconciliation

1. #147 repository foundation and source-of-truth cleanup — implemented in PR #129; awaiting successful required checks and merge.
2. #84, #85 and #102–#110 remain release/security gates and are not bypassed by the fridge programme.

## Wave A — remove ambiguity

1. #148 route/component/domain and placeholder-data audit.
2. #149 canonical meal/recipe/grocery/list decision.
3. #150 Figma reference board and original premium visual direction.
4. #151 adaptive information architecture and five user modes.
5. #157 shared-device contract may be analysed after #147 and coordinated with #151.

#149 must follow #148. #151 must use #148 and coordinate with #150. Design analysis may overlap, but no competing data, navigation or visual contract may be implemented.

## Wave B — reusable foundations

1. #152 design tokens/components after #150.
2. #153 adaptive app shell after #151 and stable #152 direction.
3. #154 deterministic two-household fixtures; exclude unresolved meal/grocery fixture shapes until #149.
4. #155 E2E/visual/accessibility harness after #154.
5. #156 protected design/state gallery; it may begin from existing primitives but final variants follow #152.
6. #160 Android foundation may proceed as an isolated platform track; do not add kiosk/shared-session product behaviour before #157.
7. #161 narrow privacy-safe observability foundation.

## Wave C — first product verticals

1. #158 inventory backend after #147; keep its API boundary independent of unresolved meal/list decisions.
2. #159 real-data Today dashboard after #149, #151, #152 and #153. Inventory remains an explicit unavailable state until #158.
3. #162 idempotency/offline queue after #154 and #157; only explicitly approved domain actions opt in.
4. #163 original graphics after #150, integrated through #152/#156.

## Broader programme

Continue into #119–#146 only when their relevant #147–#163 foundations and #84/#85/#102–#110 gates are satisfied. Evidence-dependent implementation in #109, #110, #124–#126 and beta/commercial work must wait for the beta or usage evidence named in those issues.

## Selection rule

Choose the earliest unblocked issue that fits one reviewable PR. Split oversized work before implementation. Use `AGENTS.md`, `docs/engineering/AGENT_WORKFLOW.md` and `docs/engineering/DEFINITION_OF_DONE.md`.
