# PR519 routine conflict source repair

## Scope and exact source

- Checkout: `work/routine-stack-editor`
- Source head before repair: `1be4f267f72e1ee14c6375235d103facd3868183`
- Hosted evidence: run `38189464537`, phone job `114618888475`, head `1be4f267`; report artifact `11721308503`.
- No runtime, browser, build, dependency, database, rerun, cancellation, or push was performed for this repair.

## Diagnosis

The exact Spanish phone trace for `e2e/routine-stack-editor.spec.ts:931` shows the conflict alert's reload action opening the shared discard dialog. While that dialog is open, the original conflict alert remains mounted behind it with another button named `Cargar la rutina más reciente`. The trace then records the modal reload click's hit point alternately intercepted by the discard panel and its sibling `Seguir editando` button as Playwright re-scrolls the lower action at the phone viewport edge. The report snapshot contains both same-label reload actions and the active discard `alertdialog`.

This is an ownership collision during the discard confirmation. The active discard dialog should own the reload action while it is open; the underlying conflict alert must return when the person chooses `Seguir editando` so the draft and recovery path remain intact.

## Bounded repair

`RoutineStackEditor` now renders the conflict error/action block only while no discard action is active (`saveError && !discardAction`). Opening the discard confirmation therefore leaves one reload action in the active alertdialog. Closing it through `Seguir editando` clears `discardAction` and restores the original conflict alert; confirming reload still clears the draft and increments `reloadVersion` through the existing path. Labels, handlers, modal semantics, responsive layout, and 44px targets are unchanged.

The affected unit coverage now asserts that the underlying alert is absent while the discard dialog is open and returns after `Seguir editando`.

## Static validation

- `git diff --check`: passed.
- Runtime/unit/build/browser/dependency/database checks: intentionally not run per bounded task scope; root owns final browser and hosted verification.
