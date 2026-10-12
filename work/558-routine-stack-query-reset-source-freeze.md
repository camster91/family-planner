# Routine stack query reset source freeze

Date: 2026-10-11  
Checkout: `/Users/Cameron/Documents/Codex/2026-10-07/rev/work/routine-stack-editor`  
Branch: `codex/routine-stack-editor-spec-20261011`

This follow-up addresses the final rereview finding that a preserved
`RoutineStackEditor` instance could retain an old history sentinel after its
occurrence query changed and `clearDirty()` ran. A later fresh edit could then
reuse the stale URL/state, swallowing Cancel or Discard.

The load/reset effect now retires active and pending owned history refs before
clearing the new draft state. Retirement compares the exact serialized
same-URL sentinel state, so a changed Next route/state is left untouched. A
pending release callback is cleared during the reset, and the fresh query can
arm its own sentinel normally. Existing release and unmount safeguards remain
unchanged.

Focused coverage:

- Same editor instance changes from occurrence `2026-10-11` to `2026-10-12`
  after a dirty draft, verifies the new route state remains intact, then
  confirms fresh edit → Cancel → Discard reaches normal navigation.
- Existing dirty Back, pending-save Back, unmount, and unrelated-destination
  release regressions remain green.

Validation:

- Focused routine suites: 5 suites, 58 tests passed.
- `npx tsc --noEmit` — passed.
- Targeted ESLint for changed routine source/tests — passed with no warnings.
- `git diff --check` — passed.

No database, build, browser, dependency, generated-client, provider, or
production action was run. Root owns rebuild and affected direct/intercepted
EN/ES browser reruns. The pre-existing untracked
`work/558-routine-conflict-focused-rerun.log` remains preserved.
