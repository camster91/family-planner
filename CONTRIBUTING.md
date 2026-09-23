# Contributing

Family Planner uses issue-first, reviewable vertical slices.

## Before starting
- Read `AGENTS.md` and `docs/START_HERE.md`.
- Work from an open scoped issue linked to #128 or the existing release programme.
- Inspect current source and canonical models before editing.
- Record unclear requirements as assumptions/questions instead of inventing product behaviour.

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