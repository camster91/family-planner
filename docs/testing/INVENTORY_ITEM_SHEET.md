# Inventory item sheet and removal recovery — #499 / #128

The existing ItemModal now uses shared `Dialog variant="form"`, a stable form association and fixed Save/Remove footer. Name receives initial focus, keyboard focus stays contained and normal dismissal restores the opener. Backdrop clicks do not discard drafts. Category/purchase/opened fields are disclosed separately and existing values reopen their section. Stored fields and save-body normalization remain unchanged.

Removal uses a nested localized alert dialog with the original item/history warning and a safe Keep action. Save, adjustment and deletion share a synchronous exclusive latch. Pending fields cannot be edited, and close/Escape remain locked. Existing DELETE/PATCH/adjustment endpoints, bodies, offline behavior, raw API refusal text, idempotency-key reuse and Undo behavior are preserved. Successful changes focus the stable Add item control after row controls can disappear.

The shared Dialog focus selector now recognizes native summaries and CSS `:disabled`, including ancestor-fieldset disabling and explicit tab stops. Existing Tab/Shift+Tab cases were extended without adding cases. Before the repair, the fieldset regression failed one of five cases and the summary regression failed two; the final suite passes. These are behavior regressions, not waived assertions.

Observed local verification:78 affected checks across nine suites pass, including shared Dialog, Inventory, Allowance, Emergency, translation/copy and existing Allowance API/isolation coverage. Full TypeScript and scoped lint pass. Existing Inventory browser case count remains129 including setup; its existing EN/ES removal journey targets the in-app confirmation and preserves all refusal/key/draft assertions. Collection passes. Actual optimized browser/capture and original hosted gates remain pending.

Independent source review is clear. This work joins stacked follow-up #588 behind #587; it does not alter #587's currently running candidate or claim production acceptance. No schema, role, provider, scheduler, native or real household mutation is included.

The existing four Emergency phone/desktop browser cases also now explicitly map English to light and Spanish to dark and assert the actual HTML theme, preserving case count while checking the shared Dialog change in both palettes. Browser execution remains pending.
