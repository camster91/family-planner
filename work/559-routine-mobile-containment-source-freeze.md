# Routine editor mobile containment source freeze

Date: 2026-10-11  
Checkout: `/Users/Cameron/Documents/Codex/2026-10-07/rev/work/routine-stack-editor`  
Branch: `codex/routine-stack-editor-spec-20261011`

This source-only repair addresses the phone trace in which adding a candidate
could expand the configured viewport before the confirmation step. Long
user-authored titles, fallback account IDs, and localized Remove labels remain
fully rendered, while the step list, row flex container, selects, inputs,
candidate list, and Remove control now have explicit `min-w-0`/`max-w-full`
containment. The Remove label wraps at arbitrary long tokens instead of
forcing a min-content width. No canonical data is truncated and no global
overflow rule was added.

Added focused unit coverage uses a long chore title and long fallback account
ID, asserting the full accessible title, fallback ID, Remove control name, and
assignee select value remain present without truncation.

Validation:

- 5 focused routine suites, 59 tests passed.
- `npx tsc --noEmit` — passed.
- Targeted ESLint for the changed editor source/test — passed with no warnings.
- `git diff --check` — passed.

No build, browser, database, dependency, generated-client, or provider action
was run. Root owns the configured-viewport browser rerun. Root’s uncommitted
E2E changes and the preserved `work/558-routine-conflict-focused-rerun.log`
were left untouched.
