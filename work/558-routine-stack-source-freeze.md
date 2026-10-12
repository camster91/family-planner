# Routine stack PR519 blocker repair source freeze

Date: 2026-10-11
Checkout: `/Users/Cameron/Documents/Codex/2026-10-07/rev/work/routine-stack-editor`
Branch: `codex/routine-stack-editor-spec-20261011`

This source-only slice addresses all five findings recorded in `work/558-routine-unresolved-review-audit.md`:

- Candidate responses now carry a shared selected-row snapshot token. The mutation rechecks that token after locking every selected chore and before creating/updating a routine, for both new stacks and extensions to existing stacks. A stale concurrent reassignment returns `ROUTINE_STACK_CONFLICT` before domain writes.
- Direct and intercepted routine editors own a same-URL history sentinel while dirty. Document capture plus the native window fallback restores the owned entry before Next can unmount the form, opens the existing discard dialog when idle, blocks pending/uncertain submissions, supports recoverable reload/discard, and releases the sentinel exactly once on settled navigation.
- Durable stack Add step links enter the existing routine stack editor with `stack_id` and occurrence date. Legacy create remains only for unstacked groups.
- Durable cards render owner/date context on every step, including cross-member stacks.
- Omitted occurrence dates use `toDateOnlyLocal` rather than the UTC ISO prefix.

Meaningful source checks:

- `npx tsc --noEmit` — passed.
- Focused Jest suites — 54 tests passed across routine mutation, candidate reader, editor, and stack cards.
- `npx eslint` on all changed routine source, unit/integration tests, and routine E2E spec — passed with no warnings.
- `git diff --check` — passed.

Added focused coverage includes new and existing-stack stale selected-row conflicts, candidate token emission, real dirty browser-history event handling in direct editor tests, pending Back refusal, local-date fallback, durable owner labels, and durable Add step href. The opt-in PostgreSQL integration suite now includes a read-then-reassign candidate race assertion for root to execute against its disposable database; it was not run in this checkout.

Validation limits and risks:

- No database, build, browser, hosted CI, dependency, generated-client, provider, or production action was run here. Root owns those checks.
- The browser/native Back behavior needs root's actual six-size EN/ES direct/intercepted run. The source guard uses an owned same-URL history entry and document capture to precede Next's window listener; actual WebView ordering remains a runtime verification item.
- Candidate API and draft contracts are additive. Mixed old candidate payloads without a selected-row token should be treated as an invalid/reloadable save by the current server rather than silently overwriting a concurrent assignment; supported current clients receive the token from the candidate reader.
- The pre-existing untracked `work/558-routine-conflict-focused-rerun.log` was preserved and is not part of this source change.
