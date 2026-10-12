# PR519 Spanish routine conflict follow-up

## Exact current hosted evidence

- Repository: `camster91/family-planner`
- Head: `33d8f42580b74b9150d859bd54ce46e49974a8a3`
- Run: `38185103761`
- Phone job: `114605626987` (`CANCELLED`)
- Aggregate job: `114613152414` (`FAILURE`)
- Raw phone log: `/tmp/pr519-phone.log` (downloaded from the exact phone job)
- Raw aggregate log: `/tmp/pr519-aggregate.log` (downloaded from the exact aggregate job)

The first current-head failure is `phone-390x844`, `e2e/routine-stack-editor.spec.ts:931`, Spanish explicit conflict reload. The confirmation click at line 977 timed out after 60 seconds. Playwright resolved the intended button as:

```text
<button class="btn-destructive min-h-[44px] min-w-0 w-full whitespace-normal break-words sm:w-auto">Cargar la rutina más reciente</button>
```

The click point was first intercepted by its action wrapper:

```text
<div class="flex min-w-0 flex-col gap-3 p-5 sm:flex-row sm:flex-wrap sm:justify-end">…</div>
```

Retries then identified the sibling cancel control, `Seguir editando`, as the intercepting node. The English equivalent passed immediately before this failure, and the same Spanish test failed on retry. The phone job later ended as canceled at the 40-minute shard boundary; the aggregate therefore reported `SHARD_RESULT: cancelled` and exited 1. There was no phone report, screenshot, or trace artifact in the exact run: the run retained only the always-uploaded settings, inventory, and recovery artifacts.

## Source diagnosis and bounded repair

The discard dialog action wrapper is a layout-only `div`; it does not need to participate in pointer hit testing. The current source had no explicit pointer-event or stacking contract for its two full-width mobile buttons. Three hosted revisions had already tried different layouts (`flex`, `grid`, then the current mobile column), while the same node-level intercept persisted. The repair keeps the existing Spanish labels, `min-h-[44px]`, wrapping, responsive widths, and button handlers, while making the wrapper non-hit-testable and each actual button an explicit interactive, positioned descendant:

```text
wrapper: pointer-events-none relative isolate
buttons: relative z-10 ... pointer-events-auto
```

This addresses the exact reported intercept without `force`, label shortening, coverage removal, or a test change. The source change is in `src/components/chores/RoutineStackEditor.tsx` at the discard action block (current lines 1130-1141).

## Validation boundary

`git diff --check` passed. No runtime, build, browser, dependency, database, or hosted rerun was performed by this follow-up. Root owns the eventual push and any hosted verification.
