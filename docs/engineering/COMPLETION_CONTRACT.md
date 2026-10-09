# Herewoven completion contract and durable release plan

Current verified repository/CI state: [CURRENT_STATE.md](../CURRENT_STATE.md). Temporary execution belongs in
live #377/issue/PR records. [Archived dated refreshes](../archive/execution-refreshes/2026-10-09-before-422-completion-contract.md) preserve the earlier observations.
The original contract/checklist/source requirements below remain unchanged; source completion does not
establish production, provider, native/device or household acceptance.

## Definition of done

Each open issue is retained in [the acceptance matrix](COMPLETION_MATRIX.md), including its full source requirements. Epics are umbrella outcomes, never a single implementation slice. Classification is sequencing, not closure evidence. “Already satisfied” candidates remain open until every original criterion is linked to current evidence.

A slice is verified only after regression-first implementation, independent exact-candidate review, applicable passing commands/hosted CI, rendered QA where applicable, normal protected merge, and exact merged revision production acceptance. Tests from a different head are historical. No masks, tolerances, coverage, assertions or protections may be weakened.

The real-family beta is not complete until email delivery/recovery, backup/restore, proxy security, rendered role/privacy/isolation journeys, support and legacy-data disposition pass. Recruitment, hardware, source data, legal/provider decisions and later research remain explicit gates. Four-week beta outcomes cannot be manufactured.

## Scope and preserved contracts

Preserve exact woven H/artwork, Newsreader/Manrope and all six palette roles; use approved assets for #373. Preserve authentication, recovery, autofill, household/child roles, privacy, imports, canonical API/data contracts, shared-tablet relationships and installed Android compatibility.

PR #343 additive network preparation is included under Cameron’s latest “merge all” authorization. The live database cutover in #342 and destructive #254 remain separately gated. Do not resume any Hermes cron or create replacement schedules; #368 can receive preparation only. No destructive migrations, real imports, infrastructure/DNS/provider/secret/security/deployment-policy/retention changes, external mail, paid services or store publication without separate specific approval.

## Execution and ownership — original sequence

The original ownership sequence below describes responsibilities, not permission to start external workers or new chats. Use the current operating instructions and existing task for execution; no worker/scheduler is enabled by this refresh.

Coordinator owns this durable plan, dependencies, integration, merges and live acceptance. Builder writes one scoped slice in its own worktree; Reviewer independently inspects the exact head and concrete risks; QA verifies behavior/rendered accessibility/applicable states. One writer per worktree. Read-only analysis can run in parallel; heavy tests/previews/browsers run sequentially in cloud, leaving personal Windows apps/tabs untouched. Handoffs are completion messages, not repeated polling.

1. Refresh production/main/backlog/instructions; persist this contract and all-issue matrix. **Observed; documentation candidate in progress.**
2. Reconcile #353 against shipped routines, meal-board, recovery and Woven Grove. Integrate only still-needed improvements; review and validate a fresh head. **Independent reconciliation in progress.**
3. Review #351/#352/#355 and #349 actual diffs/security/compatibility; repair or defer failed/stale candidates, never merge old green checks. **Read-only QA preparation in progress.**
4. Execute narrow #374, #375 and #373 slices with original acceptance checks. **Pending contract persistence and builder handoff.**
5. Prepare #103/#365/#367/#364/#105/#104/#372 and support/summary/calendar/Android/store work within owner/data/hardware gates. **Pending safe preparation; decisions requested.**
6. For each permitted verified slice merge exact green reviewed head via protected main, verify Coolify revision/health/assets/safe journeys, update checklist/matrix and close only fully verified issues. **Pending.**

## Release-policy reconciliation

The inherited plan recorded an earlier scoped instruction and the #379 action under that execution. Historical records do not supply current approval. In this goal chat, Cameron subsequently instructed “merge all” after being told that main merges trigger existing Coolify production deployments. That latest instruction authorizes normal protected merges and those existing automatic deployments for the reviewed PRs, including #343's additive network preparation. A live database cutover, settings/credential changes and destructive migrations remain separate actions. [COMBINED_CANDIDATE.md](COMBINED_CANDIDATE.md) records the current integration; initial step statuses and the earlier candidate ledger below remain historical evidence.

Current recorded production release used protected `main` and a Coolify source build. Older `master` / immutable-image promotion documents and #84/#85/#106 are inconsistent with that route. Do not claim a CI immutable image was promoted when Coolify rebuilt source. Do not enable the dormant immutable publisher or change Auto Deploy. Retain exact source/build revision evidence; policy decision is pending with Cameron (#363).

## Historical candidate action ledger — 2026-10-07

| Candidate | Scope and authorization match | Evidence / action at that snapshot |
|---|---|---|
| PR #379 `edd526767b3f89e6707197ed4f6419d8735e26d1` | Two-file kid refill; reviewed/tested, non-destructive; existing Coolify source path at `family.ashbi.ca` | Independent review + QA passed; Build & Test/E2E/checked-image/security checks green. Normal protected squash merged as `a80c4753bba6f9aa5f978d4a9cff4ee039f97d44`; production exact revision/health/26 asset hashes verified; live authenticated child acceptance remains gated. |
| PR #380 `b0ec3acfa5440f7c02695dbbbd7c6591594c7147` | Approved-assets social preview, no schema/API change | Final integrated source review passed; prior focused tests/hosted/browser protocol passes on 506c764 are historical. Fresh b0ec3ac checks and protocol QA must pass before action; live delivery pending. |
| PR #378 documentation | Scoped plan and canonical release-documentation reconciliation | Initial review/QA/CI passed; automated review required canonical-doc reconciliation and candidate approval record. Revised head requires fresh review/QA/CI. |
| PR #352 `10ff777dc68b07d38ec4c21fd9a5840f78f7ce19` | Existing dev dependency patches refreshed onto shipped identity | Independent source review passed; fresh CI/QA pending. |
| PR #351 `ff76f714d798b4de7210fafd05a8a07aab8f729a` | Existing runtime dependency patches refreshed onto shipped identity | Fresh independent review/CI/QA pending. |

Review and action evidence: [PR #379](https://github.com/camster91/family-planner/pull/379), [Build & Test](https://github.com/camster91/family-planner/actions/runs/37656197576), [E2E](https://github.com/camster91/family-planner/actions/runs/37656197563). Rendered QA on the exact source head: 67 passed / 16 deliberate project skips, real five-chore refill/failure rollback/Undo/final celebration, five responsive sizes with zero axe violations, eight individually inspected screenshots; no baseline changes. The owned browser/server stopped and synthetic rows were cleaned. This does not verify live authenticated journeys.

## Owner and access gates

- #103: actual source uses Mailgun (`src/lib/mail.ts`); #103's Resend proposal references decision/runbook paths absent from current main. Recommend retaining Mailgun for this release, pending provider/sender and approved test inbox decision; credentials through secure runtime/vault only. No provisioning or external test sends yet.
- #372/#366: legal entity/copyright, sender display name and approved existing support mailbox pending.
- #365/#367: production backup/proxy configuration and access must be observed and separately approved; no production setting changes.
- #104: approved source exports/identity maps or explicit deferral pending.
- #370/#371/#160/#242/#138: workflow setting changes and representative Android hardware/signing/store gates remain explicit.
- GitHub Projects read access and external persistent-worker/Hermes control access unavailable; no claims about unseen boards/jobs.

## Evidence, cleanup and rollback

Private machine evidence stays outside staged paths. Stage only explicit source/test/docs/assets. Current prior healthy source rollback target is `a243bd5b297bc1c02072451866722dc0c7061402`; actual retained production image/rollback access is not verified. Follow `docs/runbooks/RELEASE_AND_ROLLBACK.md`; never invent a retained image or database rollback. Keep each candidate SHA, review, commands, CI links, deployed version, asset evidence and safe journey result in its issue row and release record. Clean only owned test records/processes/worktrees after evidence is preserved.
