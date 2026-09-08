# Start Here

This document tells humans and agents where truth lives.

## Authority order
When information conflicts, use this order:
1. Explicit current issue/PR acceptance criteria and Cameron's latest approved decision.
2. `AGENTS.md` for repository operating rules and approval boundaries.
3. `docs/CURRENT_STATE.md` for verified implementation/runtime state.
4. `docs/FRIDGE_TABLET_PROGRAM.md` and issue #128 for product direction and programme sequencing.
5. Architecture ADRs/contracts under `docs/architecture/`.
6. `docs/PRODUCT_PROGRAM.md` for the existing Family Planner release programme.
7. Older planning/implementation documents only as historical context.

Source code and executable configuration are authoritative for exact dependency versions, schema fields and build commands; when prose disagrees, update the prose as part of the work.

## Canonical programme
- Product/release baseline: `docs/PRODUCT_PROGRAM.md`
- Fridge/tablet expansion: `docs/FRIDGE_TABLET_PROGRAM.md`
- Master roadmap: GitHub issue #128
- Premium design: #130–#133
- Existing-app migration: #143
- Backend/scale/sync/security: #134–#137
- Android/Play/QA: #138–#139, #141–#142, #145
- Analytics/AI/operations: #140, #144, #146

## Engineering references
- Definition of done: `docs/engineering/DEFINITION_OF_DONE.md`
- Agent workflow: `docs/engineering/AGENT_WORKFLOW.md`
- System: `docs/architecture/SYSTEM.md`
- Canonical data: `docs/architecture/DATA_MODEL.md`
- API contracts: `docs/architecture/API_CONTRACTS.md`
- Authorization: `docs/architecture/AUTHORIZATION.md`
- Offline/sync: `docs/architecture/OFFLINE_SYNC.md`
- Android: `docs/architecture/ANDROID.md`
- QA matrix: `docs/testing/QA_MATRIX.md`
- Test data: `docs/testing/TEST_DATA.md`

## Design references
- `design/README.md`
- `design/REFERENCES.md`
- `BRAND.md`

## Operations/product readiness
- `docs/runbooks/RELEASE_AND_ROLLBACK.md`
- `docs/runbooks/INCIDENT_RESPONSE.md`
- `docs/product/PLAY_STORE_READINESS.md`
- `docs/product/DATA_INVENTORY.md`

## Historical documents
`CONSOLIDATION_PLAN.md`, `ISSUE_TRIAGE.md`, old phase implementation files and archived source-app plans may contain useful history but do not override the current programme.

## Rule for stale docs
If you discover a material mismatch, do not work around it silently. Fix the documentation in the same PR when safe, or open/link a blocking issue.