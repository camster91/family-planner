# Family Planner Product Program

**Owner:** Cameron Ashley  
**Last verified:** 2026-08-28  
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

| Area           | Evidence on 2026-08-28                                                                             | State                                |
| -------------- | -------------------------------------------------------------------------------------------------- | ------------------------------------ |
| Source         | `master` at merge `60437bd`; working tree clean before this document                               | Verified                             |
| Consolidation  | ChoreChamps, Meal Planner, and Budget App domains and import foundations merged in PR #95          | Merged                               |
| Review         | `http://187.77.26.99:3105/api/health` returns healthy with database connected                      | Healthy, review only                 |
| Production     | `https://family.ashbi.ca/api/health` returns ready                                                 | Healthy, older release               |
| Hosted CI      | Runs for `60437bd` fail before useful validation because of the GitHub billing/spending gate       | Blocked                              |
| Replacement CI | Ashbi VPS built and validated the PR #95 review image                                              | Available; must be made reproducible |
| Local gate     | Prisma generate, typecheck, lint, 39 tests, production build, and production dependency audit pass | Verified                             |
| Runtime QA     | Calendar #34, teen wishlist #36, and handoff #37 need authenticated role-based evidence            | Open                                 |
| Source apps    | GitHub repositories archived; local checkouts retained for rollback/reference                      | Complete                             |

### Access and capability

- Repository administration and GitHub issue access are available.
- Ashbi review and production health endpoints are reachable.
- GitHub-hosted Actions are configured but unusable until billing is restored.
- Production remains a separate approval gate. A healthy review build is not
  authority to replace production.
- Current review is HTTP while auth cookies are `Secure`; authenticated browser
  QA therefore needs HTTPS or a deliberate review-only auth arrangement.

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
3. **P1 runtime defects (#34, #36, #37).** Owner: product QA. Provide
   authenticated parent and teen evidence on HTTPS review; close only when the
   issue-specific acceptance steps pass after reload.
4. **P1 core-loop E2E.** Owner: product QA. Automate the north-star journey on a
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

| Date       | Decision                                      | Reason                                                                  | Revisit trigger                                        |
| ---------- | --------------------------------------------- | ----------------------------------------------------------------------- | ------------------------------------------------------ |
| 2026-08-28 | Family Planner is the sole destination app    | Avoid duplicate auth, family, and deployment systems                    | A source app contains an irreplaceable capability      |
| 2026-08-28 | Archived source repositories stay recoverable | Consolidation is merged, but data cutover and rollback are not finished | Migration rollback window closes successfully          |
| 2026-08-28 | Use Ashbi VPS for current CI/review           | GitHub-hosted runners are blocked by billing                            | Hosted CI becomes reliable and required                |
| 2026-08-28 | Focus on the role-aware plan-to-reward loop   | It connects the strongest consolidated capabilities into daily value    | Beta evidence shows another repeated journey dominates |
| 2026-08-28 | No paid launch yet                            | No external retention or willingness-to-pay evidence exists             | Design-partner thresholds above are met                |

## Risk and blocker register

| Risk                                                  | Owner               | Mitigation / unblock condition                                           |
| ----------------------------------------------------- | ------------------- | ------------------------------------------------------------------------ |
| GitHub checks fail before execution                   | Repository owner    | Restore billing or enforce an externally reported Ashbi required check   |
| HTTP review conflicts with `Secure` auth cookie       | Release engineering | Put review behind HTTPS before authenticated E2E                         |
| Consolidated imports have not used production exports | Data owner          | Supply approved exports and identity maps; dry-run and reconcile first   |
| Production and review run different releases          | Release owner       | Promote only an immutable reviewed image with rollback approval          |
| Wide feature surface can hide broken journeys         | Product owner       | Gate optional modules and prioritize vertical E2E evidence over breadth  |
| No real customer evidence yet                         | Product owner       | Run a five-household design-partner beta before market claims or pricing |

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

| Date       | Change                                                                                    | Verification                                                                                                                | Next                                                                            |
| ---------- | ----------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| 2026-08-28 | Consolidation PR #95 merged; source repositories archived; Ashbi review deployed          | Review and production health endpoints return success                                                                       | Reproduce full release gate and prove authenticated core journeys               |
| 2026-08-28 | Product program established from live repository and official competitor research         | Source, issues, Actions, endpoints, and vendor pricing inspected                                                            | Fix HTTPS review and add role/isolation tests                                   |
| 2026-08-28 | Added `npm run verify:app` after a clean test run revealed Prisma generation was implicit | Prisma generate, typecheck, lint, 39 tests, production build, and audit all pass; zero production vulnerabilities           | Add database migration/integration and container smoke stages to the Ashbi gate |
| 2026-08-28 | Added HTTPS review routing and tested disposable parent, teen, and child accounts         | Valid certificate; calendar persisted; teen wishlist create passed; invalid handoff returned 400; teen handoff returned 403 | Close remaining browser UI evidence gaps                                        |
| 2026-08-28 | Blocked teen and child access across the budget API surface                               | 43 local tests pass; review image `family-planner-review:f96f1390548b` is healthy; child/teen return 403 and parent 200     | Merge only after review and release evidence are accepted                       |
