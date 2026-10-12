# Routine stack final source repair freeze

Date: 2026-10-11  
Checkout: `/Users/Cameron/Documents/Codex/2026-10-07/rev/work/routine-stack-editor`  
Branch: `codex/routine-stack-editor-spec-20261011`

This source-only follow-up closes the final review gaps from
`work/558-routine-stack-final-source-review.md`:

- Empty routine lists now build the editor URL from `toDateOnlyLocal`, so a
  viewer opening the builder around a UTC midnight boundary receives the
  correct local occurrence date.
- History entries retain an exact serialized copy of the captured Next state.
  Release pops are accepted only for the owned same-URL entry and matching
  captured state, and stop propagation before invoking the settled navigation
  callback. Unexpected destinations cancel the release callback.
- Unmount cleanup retires an owned current sentinel with `replaceState` and
  restores the captured Next state in place. It clears pending release refs
  without calling `history.back()` or mutating an unrelated SPA destination.

Focused source checks:

- `npx jest src/components/chores/__tests__/routine-stack-editor.test.tsx src/components/chores/__tests__/routine-stacks.test.tsx --runInBand --no-watchman --forceExit` — 27 tests passed.
- `npx tsc --noEmit` — passed.
- `npx eslint src/components/chores/RoutineStackEditor.tsx src/components/chores/RoutineStacks.tsx src/components/chores/__tests__/routine-stack-editor.test.tsx src/components/chores/__tests__/routine-stacks.test.tsx` — passed with no warnings.
- `git diff --check` — passed.

Added focused coverage for local-date builder links, dirty editor unmount
state restoration, and cancellation of a pending release after an unrelated
SPA destination wins. Existing direct browser Back, pending submission, and
discard/release tests remain green.

Validation limits:

- No database, build, browser, dependency, generated-client, provider, or
  production action was run in this checkout. Root owns the real PostgreSQL,
  build, and six-size EN/ES browser verification.
- The pre-existing untracked
  `work/558-routine-conflict-focused-rerun.log` remains preserved and is not
  included in this source freeze.
