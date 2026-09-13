# CLAUDE.md — Family Planner

Before doing any work, read:

1. `AGENTS.md`
2. `docs/START_HERE.md`
3. `docs/CURRENT_STATE.md`
4. The GitHub issue assigned to you and its parent/related issues
5. Relevant files under `docs/architecture/`, `docs/testing/`, `design/` and `docs/runbooks/`

`AGENTS.md` is the canonical agent operating contract. Do not duplicate or override its approval boundaries here.

## Claude-specific working notes
- Inspect the actual repository before proposing implementation; old planning files may be stale.
- Use `package.json` for exact dependency/framework versions and `prisma/schema.prisma` for the current schema.
- `src/lib/supabase/server.ts` is a legacy-named helper; do not infer that Supabase is the active auth platform without inspecting current code.
- Prefer small vertical PRs tied to one agent-ready issue.
- Never report tests/builds/deploys as passing unless you ran and observed them.
- After parallel/subagent work, re-run the applicable gates directly in the primary working context.
- Significant UI work must follow the current design/IA issues and repository design docs rather than inventing a new one-off visual language.
- Do not create duplicate meal/list/auth/device models to avoid understanding existing code; canonicalization is part of #134/#143.

## Typical code gate
Run the exact applicable commands from `AGENTS.md` and `docs/engineering/DEFINITION_OF_DONE.md`. A common baseline is:

```bash
npx prisma generate
npm run typecheck
npm run lint
npm test -- --runInBand
npm run build
```

Additional Android, migration, E2E, visual, accessibility, security/isolation and offline/sync gates apply based on the issue.

## External actions
Do not merge, deploy production, publish to Play, change secrets/DNS/permissions/billing, spend money, contact external users, or destructively alter production data unless Cameron explicitly approved that exact action in the current work context.