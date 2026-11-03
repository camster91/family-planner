# One path to the next web release

Updated November 3, 2026 at Cameron's request. The automatic completion goal was
cleared; this is the execution queue, not a new automatic goal.

Start with [GitHub #377](https://github.com/camster91/family-planner/issues/377).
Keep one candidate branch, `release/web-shipping`, and one draft PR to `main`.
Do not create a second feature train or count archived umbrella issues as new work.

| Order | Owner issue | Exit condition |
| --- | --- | --- |
| 1 | [#450](https://github.com/camster91/family-planner/issues/450) | Finish confirmed routine-save recovery cleanup and verify create/reopen/pause/resume/stop and independent-step behavior. |
| 2 | [#144](https://github.com/camster91/family-planner/issues/144) | Implement Cameron's Gemini-off decision across applicable server/Settings paths; preserve imports, saved recipes and manual workflows. |
| 3 | [#499](https://github.com/camster91/family-planner/issues/499) | Verify the connected web journey matrix, fix actual failures, preserve features, accessibility, roles and household isolation. |
| 4 | [#137](https://github.com/camster91/family-planner/issues/137) | Current-candidate checks, recovery, migration compatibility, auth/mail, immutable artifact and release readiness. |
| Ship | [#377](https://github.com/camster91/family-planner/issues/377) | Authorized protected merge/deploy, matching live version and successful household smoke checks. |
| Later | [#128](https://github.com/camster91/family-planner/issues/128) | Native/store/device/provider activation, background delivery, owner identity-policy decisions, research/pricing and optional expansion. |

## Candidate facts

- All prior connected-feature commits are preserved. The older PR #622 source
  `6a6c0b61` is an ancestor of this candidate; its passing checks do not prove this
  newer candidate. No merge/deployment is authorized by this tracking cleanup.
- Barcode fallback and invalid-item selection checks are recorded through
  `5b6c2f29` in `docs/engineering/EXECUTION_ORDER.md`.
- The pending routine patch clears an exact local journal entry only after a
  confirmed canonical receipt. Three recovery suites / 15 tests, TypeScript and
  scoped lint passed before consolidation. Manager/browser acceptance is still
  open. The reproduced pre-fix Worker/D1 failure is `routine-controls-*`.
- Gemini must remain off pending clarification, per Cameron's November 3 reply.
  That decision has not yet been implemented: the current config omits
  `FAMILY_GOOGLE_RECIPE_SEARCH_READY`, and unset can permit configured search.
  Do not claim provider inactivity from an absent key or a fixture test.
- Child reward-update placement and profile/account credit/link/unlink semantics
  are unresolved. Do not invent permissions or transfer rules.
- Calling remains removed. Physical device/store/provider/customer acceptance
  is distinct from local browser or mocked-provider evidence.

## Consolidation map

Closed means **consolidated, not completed**. Every original issue retains its
complete body, comments and unchecked acceptance; the destination owns that
scope by reference. Later dependency portions are explicitly routed to #128.

| Closed source issues | Current owner |
| --- | --- |
| #480, #464, #460, #142, #141, #125, #124 | #499 |
| #372, #145, #136, #135, #103 | #137 |
| #473, #470, #254, #138, #110, #108, #107 | #128 |

The six open issues are #128, #137, #144, #377, #450 and #499. Preserve all
existing security/privacy/data-integrity acceptance. Later work is not silently
cancelled, and no requirement is marked shipped merely by consolidating it.

## Recovery and evidence

Before branch cleanup, a full `git bundle --all`, the uncommitted routine patch,
the 25 original open issue bodies and commit list were retained locally under
`../artifacts/shipping-consolidation-20261103/`. Existing evidence remains under
`../artifacts/connected-family-features-20261103/`; it is not a production artifact.
The replacement draft PR must be verified remote before retiring #622 and its
branch. Delete only branches whose tips are retained by the shipping branch.

Old plans and status sections are retained as history. This file selects the
current queue; GitHub issues hold actionable work and exact release evidence.
