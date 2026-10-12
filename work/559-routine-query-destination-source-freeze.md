# Routine editor canonical return source freeze

Date: 2026-10-11  
Checkout: `/Users/Cameron/Documents/Codex/2026-10-07/rev/work/routine-stack-editor`  
Branch: `codex/routine-stack-editor-spec-20261011`

The runtime reregression showed that a direct routine editor Discard could
release its same-URL sentinel and then call `router.back()`, landing on a
foreign historical routine query instead of the Chores surface. Direct page
navigation now returns to the canonical `/dashboard/chores` path after the
serialized owned sentinel release. Intercepted sheet navigation continues to
use its supplied `onClose` callback, so the sheet owner retains its existing
route and refresh behavior.

The owned sentinel, exact-state release validation, dirty Back guard, pending
submission refusal, and query-reset cleanup remain unchanged. Focused editor
tests now assert the canonical push after fresh-query Discard and successful
save recovery while preserving native history assertions.

Validation:

- `npx jest src/components/chores/__tests__/routine-stack-editor.test.tsx --runInBand --no-watchman --forceExit` — 17 tests passed.
- No database, build, browser, dependency, generated-client, or provider
  action was run. Root owns the affected direct and sheet browser rerun.
- The root-owned uncommitted E2E changes and preserved
  `work/558-routine-conflict-focused-rerun.log` were left untouched.
