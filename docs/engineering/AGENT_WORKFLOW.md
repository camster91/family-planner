# Agent Workflow

## Goal
Make agent work predictable, reviewable and safe. The agent should always know what to work on, what not to touch, what evidence is required and what remains human-gated.

## 1. Select work
Choose one open, scoped issue. Prefer issues explicitly marked ready by the current roadmap/parent dependency chain. Do not begin downstream work while a prerequisite decision changes the contract underneath it.

## 2. Reconcile context
Before editing:
- read `AGENTS.md`, `docs/START_HERE.md`, `docs/CURRENT_STATE.md`;
- read the issue, parent and related blockers;
- inspect current source/tests/schema/config;
- identify canonical models/APIs/design components;
- note stale docs or contradictions.

## 3. Produce a short implementation plan
Include:
- objective;
- files/domains expected to change;
- data/auth/offline/Android implications;
- test strategy;
- rollback/compatibility notes;
- decisions requiring Cameron.

For large issues, stop and split into child issues before writing a giant PR.

## 4. Implement vertically
Prefer a complete narrow outcome over horizontal churn. A vertical slice may include UI, API/data, authorization, tests, accessibility and telemetry hooks together.

Keep legacy paths working until the replacement is verified. Use feature flags when a staged migration is safer.

## 5. Validate directly
Run the applicable Definition of Done gates. Capture actual errors/results. Fix root causes; do not disable tests or weaken checks just to get green.

## 6. Self-review
Review the diff for:
- accidental scope creep;
- placeholder/demo content leaking into production;
- household/role/device authorization;
- duplicate models or APIs;
- breaking mobile-server contract changes;
- accessibility/responsive states;
- secret/private-data exposure;
- unbounded queries/polling;
- hard-coded styling that bypasses the design system.

## 7. Open PR
Use the PR template. Link the issue. Include exact test evidence, screenshots for visible changes, migrations, risk and rollback/compatibility notes.

## 8. Stop at approval gates
Do not merge or deploy because the issue is complete. Wait for the required human approval for merge, production, Play publishing, secrets/access/billing/spend, external communication or destructive production changes.

## Status language
Use:
1. Completed and verified
2. Completed but awaiting verification
3. In progress
4. Blocked
5. Awaiting Cameron/human decision
6. Next action

Do not call work deployed, merged, released or verified unless it actually happened.

## Recommended issue size
A typical agent-ready issue should be achievable in roughly one reviewable PR, with clear acceptance criteria and no more than one major architectural decision. If it needs multiple domains and weeks of work, create child issues.