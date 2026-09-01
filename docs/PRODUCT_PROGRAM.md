# Family Planner Product Program

**Owner:** Cameron Ashley  
**Last verified:** 2026-09-01
**Authority:** This document is the product and release source of truth. Detailed
implementation and migration mechanics remain in `CONSOLIDATION_PLAN.md`.

## Charter

Family Planner is the single household operations app for busy families with
school-age children. It should turn shared plans into clear action: parents can
coordinate schedules, meals, money, chores, and handoffs while children and
teens see only the responsibilities and rewards relevant to them.

The initial focus is families already juggling multiple calendars, chat threads,
lists, and chore systems. The wedge is not the number of modules; it is a
dependable daily loop connecting **plan -> assign -> complete -> verify ->
reward**, with family roles and private financial data handled correctly.

### Product principles

1. One calm daily home, with optional modules progressively disclosed.
2. Every shared record is family-scoped; sensitive finance is parent-only.
3. Parent, teen, and child journeys are explicit and tested separately.
4. Core actions survive retries, timezones, upgrades, and partial failures.
5. No feature is called shipped without runtime evidence and a recovery path.

## Current verified state

| Area          | Evidence on 2026-09-01                                                                              | State       |
| ------------- | --------------------------------------------------------------------------------------------------- | ----------- |
| Source        | Production remains on reviewed commit `9c9e315`; launch-gap work is isolated in open PR #101        | Controlled  |
| Consolidation | ChoreChamps, Meal Planner, and Budget App domains and import foundations merged in PR #95           | Merged      |
| Review        | Exact PR head `f3cffd3` deployed from its workflow artifact; authenticated core-loop smoke passed | Degraded    |
| Production    | `https://family.ashbi.ca/api/health` is healthy on image `family-planner:9c9e315`                   | Shipped     |
| Required CI   | Protected `master` requires strict Ashbi, build/test, and Android APK checks for PRs                | Enforced    |
| Ashbi runner  | Dedicated `familyci` runner executes the complete release/recovery gate and cleans disposable state | Operational |
| Local gate    | Prisma generate, typecheck, lint, 49 active tests, syntax checks, and clean diff checks pass        | Verified    |
| Runtime QA    | Automated role/isolation and core-loop smoke plus authenticated 320px core-surface audit pass       | Complete    |
| Source apps   | GitHub repositories archived; local checkouts retained for rollback/reference                       | Complete    |

### Access and capability

- Repository administration and GitHub issue access are available.
- Ashbi review and production health endpoints are reachable.
- GitHub Actions orchestration is active; the release gate itself runs on the
  dedicated Ashbi VPS runner.
- Production promotion requires explicit approval and an immutable reviewed
  candidate; PR #97 satisfied both conditions.
- Review and production both use HTTPS, so `Secure` authentication cookies are
  exercised under production-equivalent transport.
- Review is intentionally reported as degraded, not healthy, until an approved
  transactional-email provider credential and verified sender are configured.

## Market and pricing baseline

Research below uses vendors' official pages, checked 2026-08-28.

| Product                                                                                  | Current offer                                                                                          | Implication                                                                          |
| ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------ |
| [Cozi](https://www.cozi.com/compare-plans/)                                              | Free shared calendar/lists/recipes; Gold $39/year; Max $79/year with AI import and meal planning       | Basic coordination is expected free; automation can support a higher tier.           |
| [FamilyWall](https://www.familywall.com/premium.html?lang=en)                            | Free core; Premium $4.99/month or $44.99/year adds calendar sync, meals, budget, location, and storage | Family-wide planning bundles cluster near $40-$50/year.                              |
| [Skylight Calendar Plus](https://www.skylightframe.com/products/calendar-skylight-plus/) | $79/year for software features including magic import, meals, and rewards, alongside paid hardware     | Premium pricing needs a visibly easier household routine, not a longer feature list. |

### Position and commercial hypothesis

Position Family Planner as the private, role-aware family operations hub: the
place where a shared schedule becomes assigned work, meals, purchases, money,
and verified rewards. Do not compete first on location tracking, hardware, or
generic AI.

Keep the product free during a small design-partner beta. Do not activate paid
plans until five non-owner households complete the core weekly loop for four
weeks and at least three independently indicate willingness to pay. Test a
family-wide annual plan in the **$39-$49/year** range; this is a hypothesis based
on current competitor anchors, not a validated price.

## North-star journey and metrics

The launch journey is:

`parent creates family -> invites member -> plans week -> assigns chore -> child
completes -> parent verifies -> child claims reward`

Instrumentation must use privacy-safe family and role identifiers, never chore
photos, message content, financial descriptions, or child names.

| Metric                      | Initial launch criterion                                                               |
| --------------------------- | -------------------------------------------------------------------------------------- |
| Activation                  | 5 independent households complete family creation, invite, and first assignment        |
| Weekly core-loop completion | At least 3 of 5 beta households complete the full loop in each of four weeks           |
| Reliability                 | >=99% successful core mutations in beta; zero cross-family data exposure               |
| Time to first value         | Median <=10 minutes from registration to first assigned chore                          |
| Recovery                    | Backup restored in isolation and review rollback rehearsed before production promotion |

These are acceptance thresholds, not claims about current performance.

## Authoritative roadmap

### Now — prove a safe daily loop

1. **P0 release gate (#85).** Owner: release engineering. Make one Ashbi CI
   command reproducible from a clean checkout: frozen install, Prisma generate,
   typecheck, lint, unit/integration tests, migration twice, audit, image build,
   and health smoke. Acceptance: immutable commit/image evidence and readable
   failure output. Rollback: keep the last healthy review image.
2. **P0 role and family isolation.** Owner: application engineering. Add API
   integration tests for parent/teen/child permissions and two-family isolation
   across chores, rewards, calendar, wishlist, handoff, meals, and budget.
   Acceptance: unauthorized reads and writes fail without revealing records.
3. **P1 core-loop E2E.** Owner: product QA. Automate the north-star journey on a
   clean review database, including retry/error states and mobile viewport.

### Next — migration and recovery

1. Obtain approved source exports and explicit identity maps.
2. Back up review, rehearse restore, run dry-run imports, reconcile counts and
   balances, then persist one module at a time.
3. Add audit evidence and rollback instructions to every migration release.
4. Recruit five design-partner households and instrument the beta criteria.

### Later — breadth and monetization

- Improve calendar interoperability and fast event import after the core loop
  is reliable.
- Validate whether meal-to-shopping and budget-to-allowance loops increase
  weekly retention.
- Test packaging and willingness to pay before implementing billing.
- Defer location tracking, broad AI features, and hardware integrations until
  customer evidence changes the priority.

## Decision register

| Date       | Decision                                      | Reason                                                                                    | Revisit trigger                                        |
| ---------- | --------------------------------------------- | ----------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| 2026-08-28 | Family Planner is the sole destination app    | Avoid duplicate auth, family, and deployment systems                                      | A source app contains an irreplaceable capability      |
| 2026-08-28 | Archived source repositories stay recoverable | Consolidation is merged, but data cutover and rollback are not finished                   | Migration rollback window closes successfully          |
| 2026-08-28 | Use Ashbi VPS for current CI/review           | GitHub-hosted runners are blocked by billing                                              | Hosted CI becomes reliable and required                |
| 2026-08-28 | Focus on the role-aware plan-to-reward loop   | It connects the strongest consolidated capabilities into daily value                      | Beta evidence shows another repeated journey dominates |
| 2026-08-28 | No paid launch yet                            | No external retention or willingness-to-pay evidence exists                               | Design-partner thresholds above are met                |
| 2026-08-28 | Promote reviewed head `9c9e315` to production | Authenticated browser QA, authorization matrix, security scan, and rollback backup passed | A newer candidate clears the same release gates        |

## Risk and blocker register

| Risk                                                  | Owner         | Mitigation / unblock condition                                            |
| ----------------------------------------------------- | ------------- | ------------------------------------------------------------------------- |
| Production transactional email provider is absent     | Release owner | Configure an approved credential and verified sender; prove live delivery |
| Consolidated imports have not used production exports | Data owner    | Supply approved exports and identity maps; dry-run and reconcile first    |
| Wide feature surface can hide broken journeys         | Product owner | Gate optional modules and prioritize vertical E2E evidence over breadth   |
| No real customer evidence yet                         | Product owner | Run a five-household design-partner beta before market claims or pricing  |

## Release gate

A production candidate requires all of the following:

- exact commit and immutable image digest;
- clean install and generated Prisma client;
- typecheck, lint, tests, production build, dependency audit, migrations twice;
- role/isolation and north-star E2E evidence on HTTPS review;
- backup, isolated restore, migration, and rollback rehearsal;
- health, logs, and release identity verified after deployment;
- explicit human approval for that production candidate.

## Work log

| Date       | Change                                                                                      | Verification                                                                                                                                                                                                                              | Next                                                                                                                 |
| ---------- | ------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| 2026-08-28 | Consolidation PR #95 merged; source repositories archived; Ashbi review deployed            | Review and production health endpoints return success                                                                                                                                                                                     | Reproduce full release gate and prove authenticated core journeys                                                    |
| 2026-08-28 | Product program established from live repository and official competitor research           | Source, issues, Actions, endpoints, and vendor pricing inspected                                                                                                                                                                          | Fix HTTPS review and add role/isolation tests                                                                        |
| 2026-08-28 | Added `npm run verify:app` after a clean test run revealed Prisma generation was implicit   | Prisma generate, typecheck, lint, 39 tests, production build, and audit all pass; zero production vulnerabilities                                                                                                                         | Add database migration/integration and container smoke stages to the Ashbi gate                                      |
| 2026-08-28 | Added HTTPS review routing and tested disposable parent, teen, and child accounts           | Valid certificate; calendar persisted; teen wishlist create passed; invalid handoff returned 400; teen handoff returned 403                                                                                                               | Close remaining browser UI evidence gaps                                                                             |
| 2026-08-28 | Blocked teen and child access across the budget API surface                                 | 43 local tests pass; review image `family-planner-review:f96f1390548b` is healthy; child/teen return 403 and parent 200                                                                                                                   | Merge only after review and release evidence are accepted                                                            |
| 2026-08-28 | Completed authenticated browser acceptance for #34, #36, and #37                            | Native calendar values saved and survived reload; invalid time banner rendered; teen wishlist create/edit/delete stayed on-page                                                                                                           | Promote the exact reviewed candidate                                                                                 |
| 2026-08-28 | Fixed calendar nullable-field contract and replaced native wishlist edit/delete prompts     | 44 tests pass; review image `family-planner-review:9c9e315` healthy; final security diff scan found zero issues                                                                                                                           | Merge PR #97                                                                                                         |
| 2026-08-28 | Merged PR #97 and deployed `family-planner:9c9e315` to production                           | Fresh validated database backup; production health fully green; live parent/teen authorization and event/wishlist smoke passed; QA records removed                                                                                        | Begin design-partner beta and automate the full north-star journey                                                   |
| 2026-09-01 | Opened PR #100 for launch-readiness gaps and protected `master` with required strict checks | Dedicated Ashbi runner; repeatable imports, backup/restore, immutable rollback, parent-child-isolation smoke, search, token hardening, privacy controls, export/deletion, audit history, notification preferences, and Android APK checks | Superseded by PR #101 after GitHub stopped synchronizing the amended branch head                                      |
| 2026-09-01 | Opened replacement PR #101 from the exact candidate branch                                  | PR #100 remains closed and unmerged; branch history and review evidence are preserved                                                                                                                                                    | Clear latest exact-head gates, finish candidate mobile QA, verify production email, then request production approval |
| 2026-09-01 | Promoted exact PR head `9f37aa2` to the Ashbi review target with automatic rollback       | Workflow run `33518730116`; pre-deploy database backup retained; live register-to-reward loop passed; previous container retained; review health is degraded only for missing transactional email                                             | Validate the final navigation candidate at mobile width, then remove the opt-in review deployment label              |
| 2026-09-01 | Promoted and audited exact PR #101 head `f3cffd3` on Ashbi review                              | Runs `33521869543` and `33521869424`; all required checks passed; backup and rollback container retained; live core loop passed; authenticated 320px QA found no overflow, unlabeled controls, or undersized visible targets                    | Configure transactional email, obtain approved exports, and run the five-household beta before production approval  |
