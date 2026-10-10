# Routines for every household member (#450)

## Design and canonical model
A routine is an ordered stack of chores for any member: an adult's evening reset, a teenager's after-school tasks, or a child's picture routine. A stack is never a second completion record. Existing Chore.routine and routine_order remain authoritative; recurring templates carry those fields forward.

First slice: Chores → Routines, alongside the existing chore list and date filters. Each card names the routine, member and due day. Cards group by member ID, normalized routine name and canonical date, so two people called Alex and two future occurrences remain separate. Cards show ordered steps, done count, checked count and the next unfinished step. Later steps remain available: sequence is guidance, not a forced lock. Completion uses the existing API, undo and check policy. Only parents get edit and Add step shortcuts. Add step prefills the routine, next available step number, day and an assignee checked against the current household roster. An optional Focus on the next step view hides later steps without changing their records. Ungrouped chores remain visible under Other chores. Picture selection is optional and useful for all ages.

## Habit-stacking builder: planned, not implemented
- Start with a name and an optional anchor: “After breakfast, start Morning.” Anchors are household-authored text, not automatic tracking or AI guesses.
- Add several steps without leaving the builder; choose existing chores or create canonical ones. Accessible Move up/down controls accompany any future drag gesture.
- Choose who does each routine, including adults. A shared routine needs explicit step ownership; a household-wide label cannot imply shared completion.
- Set a schedule once for the stack: one-time due date, daily, selected weekly weekdays, monthly day; optional starts-on date for repeating stacks. Show a plain-language schedule summary before saving.
- Expand only the next step by default; offer Show all and optional picture view. Keep timers, streaks and notifications optional.
- Pause/resume an entire recurring stack without deleting history. A skipped step must have an explicit occurrence policy, not silently become completed.
- Editing a stack distinguishes this occurrence from future occurrences. Finished/check-pending history survives reorder/schedule changes.

Before builder implementation, define atomic transaction boundaries, optimistic conflict handling, retry keys, canonical template membership, per-role editing and shared-device disclosure. The free-text label alone is not a safe identity for a multi-record mutation. No new scheduled jobs are authorized.

## Evidence and release
This is a local UI slice and a specification, not a released routine builder. Test grouping, progress, role controls, canonical completion and existing chore interactions. Render the real component with isolated labelled fixtures before claiming visual quality. Full authenticated route, phone/native behavior and hosted build remain release gates. Rollback the UI additions; no new schema or API in this slice.
