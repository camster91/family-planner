# Coding Agent Kickoff

## Repository state

- Default branch: `master`
- Canonical planning branch until PR #129 merges: `plan/fridge-tablet-program`
- Current phase: repository reconciliation / Phase 0 only
- Canonical planning PR: #129
- First build issue after reconciliation: #148
- First architectural decision after #148: #149

Do not assume `master` contains the fridge-tablet or agent-ready plan while PR #129 is open. Check PR #129 and `docs/CURRENT_STATE.md` before selecting work.

## What to read

1. `AGENTS.md`
2. `docs/START_HERE.md`
3. `docs/CURRENT_STATE.md`
4. `docs/engineering/EXECUTION_ORDER.md`
5. `docs/engineering/AGENT_BACKLOG.md`
6. `docs/engineering/AGENT_WORKFLOW.md`
7. `docs/engineering/DEFINITION_OF_DONE.md`
8. Issue #148, its parents/relations, then the relevant architecture/design/testing files

## Next-agent instruction

> Work on `camster91/family-planner` from the canonical source state documented above. Do not restart planning and do not begin the product refactor before repository reconciliation is merged. Select issue #148 first: produce the route/component/domain and placeholder-data audit without changing product behaviour. Use source code, `package.json`, `prisma/schema.prisma`, Android configuration and workflow YAML as runtime truth. Preserve one repository, one household backend and one product. Do not invent another auth, meal/list, device or sync model. Treat #149 as the unresolved canonical meal/recipe/grocery/list decision. Keep #84, #85 and #102–#110 as release/security gates. Run and report only verification actually observed. Work in a reviewable issue-linked branch/PR. Do not merge, deploy production, publish to Play, change production secrets/DNS/access/billing, spend money, contact users or destructively modify production data without Cameron's explicit approval for that exact action.

## Verification rule

Documentation-only work must at least verify links, references, source facts and the diff. Code work must run the applicable Definition of Done, including household-isolation, migration, E2E/visual/accessibility and Android gates when relevant. A failed or externally blocked check must be reported as blocked, never green.
