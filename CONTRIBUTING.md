# Contributing

Family Planner uses issue-first, reviewable vertical slices.

## Before starting
- Read `AGENTS.md` and `docs/START_HERE.md`.
- Work from an open scoped issue linked to #128 or the existing release programme.
- Inspect current source and canonical models before editing.
- Record unclear requirements as assumptions/questions instead of inventing product behaviour.

## Local setup and checks
Set up a checkout with [SETUP.md](SETUP.md) (Node 22 from `.nvmrc`, `npm ci`, PostgreSQL 17, `node scripts/migrate.js`).

Before opening a PR, run the gate that matches CI's `Build & Test` job (`.github/workflows/release.yml`):

```bash
npx prisma generate
npm run typecheck
npm run lint
npm run format:check
npm test -- --runInBand
npm run build
```

`npm run verify:app` runs generate, typecheck, lint, tests, build and the production dependency audit in one command. CI additionally checks that `scripts/migrate.js` and the fixture seed are idempotent against a disposable PostgreSQL 17 database and smoke-tests the Docker image; see [docs/engineering/CI_AND_RELEASE.md](docs/engineering/CI_AND_RELEASE.md). Record the commands you actually ran and their results in the PR.

Schema changes must update `prisma/schema.prisma` and `scripts/migrate.js` (or an idempotent `database/migration-*.sql`) together.

## Branches
Use descriptive branches such as `feat/<issue>-short-name`, `fix/<issue>-short-name`, `refactor/<issue>-short-name`, `docs/<issue>-short-name`.

Do not work directly on `master`.

## Pull requests
A PR should normally:
- solve one scoped outcome;
- link the issue;
- explain user impact and technical approach;
- identify auth/data/migration/offline/Android implications;
- include actual test evidence;
- include screenshots or recordings for visible changes;
- state rollback/compatibility concerns;
- avoid unrelated refactors.

Use `.github/pull_request_template.md`.

## Definition of done
Follow `docs/engineering/DEFINITION_OF_DONE.md`. Passing CI alone does not prove UX, accessibility, device lifecycle or runtime authorization where those are in scope.

## Product/design
Significant UI changes should follow the current Figma/spec/design direction. Reuse tokens and components. Do not ship fake household content or copied third-party visuals.

## Security
Every family-owned domain requires explicit household isolation. Never weaken route checks to make a UI work. See `SECURITY.md` and `docs/architecture/AUTHORIZATION.md`.

## Migrations
Prefer expand/contract changes compatible with installed old clients. Include rehearsal/rollback notes. Never run destructive production migration steps from a normal PR.

## Approval boundaries
Opening a PR is not approval to merge or deploy. Production, Play publishing, external communication, credentials, permissions, billing/spend and destructive data actions require explicit approval.