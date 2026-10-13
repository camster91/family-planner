## Current capacity correction — PR #537

The original candidate `555e4ae6` run `38296504536` kept all tests but its three-viewport fridge/large-tablet/desktop job `114969314093` exceeded the unchanged 40-minute limit before visual checks. The earlier Linux capture job `114957490425` ended at the same limit. Their incomplete logs are historical evidence, never a complete journey or screenshot pass. A separate intermittent Locations focus failure is repaired in application code; splitting jobs does not substitute for that fix.

The current matrix has four independent jobs: phone390/phone430, portrait800, fridge1280, and large-tablet1920/desktop1366. Every original project occurs exactly once. Each job still owns its service database, checkout, and auth files; Playwright keeps one worker, the 40-minute limit stays unchanged, and matrix concurrency remains two with fail-fast disabled. The strict aggregate still requires every viewport and Password/Inventory/Settings dependency to succeed. Triggers, action pins, permissions, install/build/migration commands, test and visual commands, fixtures, screenshots, and tolerances remain unchanged.

Original final-head hosted checks must pass before merge. Earlier evidence below describes superseded layouts and remains preserved.

# Historical three-shard layout — PR #429 / issue #428

## Verified failure

Original exact8a7c4fed709746ecdc2421b3816503c60b77d574 E2E run37898607134/job113715646229 attempt1 ended CANCELLED. Started2026-10-09T07:22:08Z, completed08:02:28Z. GitHub's check annotation explicitly says the job exceeded its maximum40m0s. The retained log began1791 cases with1 worker at07:24:58 and continued into the final desktop group before cancellation. No terminal complete journey or visual pass is claimed. Visual/report steps were skipped. Original Build/Test37898607117 and fresh checked-image/GitGuardian passed separately. The original cancelled run/log/API/annotations are preserved; no observation-driven rerun was issued.

## Bounded repair

The original two-shard layout is now capacity-partitioned into three matrix jobs while preserving the same six viewport projects: phone390/phone430, portrait800, and fridge1280/large-tablet1920/desktop1366. Each starts a separate ephemeral hosted PostgreSQL service and owns its checkout/auth state; existing canonical-fixture mutations remain serial with unchanged one-worker Playwright config. `fail-fast: false` keeps the other shard evidence running; `max-parallel:2` bounds concurrency. No test, route, fixture, auth/rate policy, screenshot baseline, budget, provider, native, timeout, dependency, deployment or token permission is weakened. Original40-minute shard job limits remain.

The original stable check name `E2E (Playwright)` is a dependent aggregate using `always()` and a strict shell success comparison. Failed/cancelled/skipped/missing dependency results cannot pass. Unique shard labels prevent artifact-name collisions. Original trigger/concurrency/permissions/services/env/action pins/install/migration/build/journey/visual/regeneration/upload behavior otherwise remains unchanged. No branch-protection setting or workflow enabled/disabled state changes.

Reference: [GitHub needs result values](https://docs.github.com/en/actions/reference/workflows-and-actions/contexts#needs-context) and [matrix failure/concurrency controls](https://docs.github.com/en/actions/how-tos/write-workflows/choose-what-workflows-do/run-job-variations#handling-failures). Hosted behavior remains subject to the actual new-source original run, not local structural inference.

## Local verification

Named original workflow/document backups were preserved before replacement. YAML structural comparison proves unchanged top-level trigger/token/concurrency controls, original services/env/runner/40-minute limit and every original step after removing only project partition and artifact label text. Matrix membership contains each original project once, and the mandatory aggregate dependency/result expression is verified. The exact aggregate shell command returns0 only for success and nonzero for failure/cancelled/skipped/empty.

The earlier two-shard candidate's Playwright `--list` comparison recorded all1788 non-setup journey cases and36 non-setup visual cases covered exactly once, with identical source/project/title identities; its per-shard counts belong to that former layout. This follow-up changes only the matrix project grouping: static membership checks verify that the three former groups contain each of the six original projects exactly once, with setup still repeated only because service databases/browser auth files are isolated. A fresh three-group Playwright listing remains a hosted/source gate, not an inferred local execution pass.

Applicable types/lint/format/whitespace and full373 suites/4518 tests PASS61.143s (188 existing opt-in skips). Final unchanged-config tree/history secret gates are required before push; exact publication results are recorded in the PR/current issue. Application/dependencies/schema/config/support/scripts/public inputs remain byte-identical to prior validated8a7c4/actual2986ba4 built06:49:10.800Z; no new local app build or rendered evidence is invented for CI/prose-only changes. The separately completed #430 account-dialog source and2293-image gallery stay preserved on its own branch.

## Acceptance and rollback

New source changes must trigger their own original Build/Test/fresh-image, all three former viewport-shard journey/visual jobs, aggregate and GitGuardian gates. Verify actual terminal totals, exact head, manual source review, current strict/admin/conversation protections and zero unresolved threads before normal merge; then close only original #428 criteria. The initial cancelled source remains history. No test failures/timeout cancellation can be substituted by a required-only green check.

Rollback is the named original single-job workflow; that restores the known40-minute capacity failure on this suite and is not current acceptance. Full #142/#134/#377/device/provider/production/legal/human/household acceptance remains open.


## October 2026 throughput review (#544)

The current four viewport jobs may run concurrently (`max-parallel: 4`). Each still owns an isolated hosted runner, PostgreSQL service, checkout, auth files and shard-named artifacts. The fixture-mutating specs remain serial within each shard (`workers: 1`). All original projects, tests, snapshots, 40-minute job budgets and the strict aggregate gate are retained. This removes inter-shard queue delay without adding jobs; peak hosted capacity is the remaining concurrency constraint.
