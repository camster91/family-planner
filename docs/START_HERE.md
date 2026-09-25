# Start Here

This file defines the repository's documentation authority. It is a map, not a second product plan.

## Authority order

When information conflicts, use this order:

1. `AGENTS.md` — operating rules and approval boundaries.
2. `docs/START_HERE.md` — this authority map.
3. `docs/CURRENT_STATE.md` — dated, verified repository/branch/CI state.
4. `docs/FRIDGE_TABLET_PROGRAM.md` — approved unified product direction and programme.
5. `docs/PRODUCT_PROGRAM.md` — existing release/security/beta gates that the fridge programme must preserve.
6. Accepted ADRs under `docs/architecture/adr/`.
7. Active GitHub issues — scoped execution and current dependencies; Cameron's latest explicit decision controls within its authorized scope.
8. Executable source/configuration — authoritative for actual runtime, dependency, schema, auth, Android and workflow facts.
9. Older planning documents — historical/reference only.

If an active issue conflicts with a higher authority, reconcile the issue before implementation. If executable source differs from prose, do not guess: record the actual source state and update the affected current-state/architecture documentation.

## Canonical programme

- Unified product direction: `docs/FRIDGE_TABLET_PROGRAM.md`
- Existing release/security gate: `docs/PRODUCT_PROGRAM.md`
- Master roadmap: #128
- Repository foundation: #147 / PR #129
- First implementation audit: #148
- Canonical meal/list decision: #149
- Design/IA: #150–#153
- Test foundations: #154–#156
- Shared device, inventory, dashboard, Android, observability, sync and graphics: #157–#163
- Broader programme: #119–#146

## Engineering references

- Execution order: `docs/engineering/EXECUTION_ORDER.md`
- Agent backlog: `docs/engineering/AGENT_BACKLOG.md`
- Definition of done: `docs/engineering/DEFINITION_OF_DONE.md`
- CI/release ownership: `docs/engineering/CI_AND_RELEASE.md`
- Agent workflow: `docs/engineering/AGENT_WORKFLOW.md`
- Architecture: `docs/architecture/**`
- Testing: `docs/testing/**`
- Design: `design/**` and `BRAND.md`
- Release/incident operations: `docs/runbooks/**`

## Historical/reference-only material

`docs/CONSOLIDATION_PLAN.md`, `docs/ISSUE_TRIAGE.md`, everything under `docs/archive/`, old phase implementation files, archived source-app plans and stale branch-specific status notes are superseded for current planning. They may explain history but must not be used as current scope, dependency or runtime truth.

`CLAUDE.md` is only an agent pointer. It must not duplicate or override `AGENTS.md`.

## Reconciliation rule

Do not leave a discovered material conflict unresolved. Fix it in the same safe documentation/governance PR, or record a blocking issue with the exact conflict, owner and next action.
