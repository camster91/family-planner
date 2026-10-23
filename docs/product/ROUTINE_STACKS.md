# Routines for every household member (#450)

## Design and canonical model

A routine is an ordered stack of chores for any member: an adult's evening reset, a teenager's after-school tasks, or a child's picture routine. A stack is never a second completion record. Existing Chore.routine and routine_order remain authoritative; recurring templates carry those fields forward.

First slice: Chores → Routines, alongside the existing chore list and date filters. Durable stacks group by stack ID and occurrence date; legacy unstacked rows continue using member ID, normalized routine name and canonical date so two people called Alex and two future occurrences remain separate. Each card names the routine, member and due day. Cards show ordered steps, done count, checked count and the next unfinished step. Later steps remain available: sequence is guidance, not a forced lock. Completion uses the existing API, undo and check policy. Only parents get edit and Add step shortcuts. Add step prefills the routine, next available step number, day and an assignee checked against the current household roster. An optional Focus on the next step view hides later steps without changing their records. Ungrouped chores remain visible under Other chores. Picture selection is optional and useful for all ages.

## Habit-stacking builder: current occurrence implemented; future work remains

The current implementation supports one selected occurrence with a durable stack identity. The following capabilities remain planned for a separately reviewed future slice:

- Start with a name and an optional anchor: “After breakfast, start Morning.” Anchors are household-authored text, not automatic tracking or AI guesses.
- Add several steps without leaving the builder; choose existing chores or create canonical ones. Accessible Move up/down controls accompany any future drag gesture.
- Choose who does each routine, including adults. A shared routine needs explicit step ownership; a household-wide label cannot imply shared completion.
- Set a schedule once for the stack: one-time due date, daily, selected weekly weekdays, monthly day; optional starts-on date for repeating stacks. Show a plain-language schedule summary before saving.
- Expand only the next step by default; offer Show all and optional picture view. Keep timers, streaks and notifications optional.
- Pause/resume an entire recurring stack without deleting history. A skipped step must have an explicit occurrence policy, not silently become completed.
- Editing a stack distinguishes this occurrence from future occurrences. Finished/check-pending history survives reorder/schedule changes.

The current candidate defines atomic transaction boundaries, optimistic conflict handling, retry keys, canonical occurrence membership, parent-only editing and shared-device refusal. The free-text label alone is not a safe identity for a multi-record mutation. Future-series editing, pause/resume and scheduled jobs remain outside this slice; no new scheduled jobs are authorized.

## Evidence and release

This candidate includes the parent current-occurrence editor, durable `RoutineStack` schema/API and the existing `RoutineStacks` presentation. Test grouping, progress, role controls, canonical completion and existing chore interactions. Full fresh migration, authenticated route, phone/native behavior and hosted build remain release gates. Rollback removes the editor/runtime entry points while retaining the additive schema, nullable chore column, indexes and foreign key so legacy clients and rows remain safe; do not attempt a destructive schema rollback in the same release.

## Unstacked occurrence context (#450 / #451)

Other chores show assignee and due day on each row. In Week/All only, canonical household + recurrence_id groups collapse repeated unstacked chores behind a native disclosure; each expanded dated row retains its own completion/edit target and member authorization. Today remains individual actionable rows. Completed and checked statuses remain explicit and are never labeled open dates. Matching titles and unrelated series do not merge. Durable routine stacks remain separated by stack ID and occurrence date; legacy label-only groups remain on the compatibility path until an explicit migration. Rollback removes optional collapse rendering without deleting the additive routine schema.

## Monthly chores and steps (#471)

Monthly recurrence keeps the template's UTC date-only day of the month. A January 31 start generates February 28 (29 in a leap year), March 31 and April 30. Short-month clamping affects only that occurrence; it never replaces the original anchor. Ordinary chores and routine steps use the same expander, including completion and lazy top-up. Create and edit forms explain this before save. A legacy recurring row without a series retains its single successor behavior; its own day anchors that successor.

Compatibility: no schema or scheduler change. Already generated dates, started/check-pending/completed rows, points, rotations and history are retained. Existing overflow series continue from their latest stored occurrence, using the original template day for newly generated later months. This does not backfill skipped past months or replace already scheduled overflow dates. Any deliberate schedule change follows the existing series-edit rules; changing only the displayed occurrence's date does not redefine a template's monthly anchor.

Rollback: revert the date generator and form hint. Generated rows remain canonical stored dates; rollback does not delete or rewrite them. No historical data migration is included.

## Email-free current-occurrence extension (#480)

The existing parent editor can use active name-only members through the gated
protocol-2 contract. Profile subjects keep a null account reference and stable
member ID; account and profile choices remain separate. One-off profile chores
can carry the same built-in picture, normalized routine label and ordered step
metadata as account chores. The dated stack editor retains atomic save, conflict,
retry and history behavior. See [scope, compatibility and acceptance](../plans/email-free-profile-routines.md).
Profile recurrence and future-series editing remain separate work. Production
setup/chore flags and the public capability manifest are unchanged by this source
slice. These statements describe the candidate contract, not release proof.

## Durable schedule follow-up source — 2026-10-20 (#450 / consolidated #559)

`../plans/routine-schedule-v1.md` records the newly authored contract/pure planner
and nullable schema foundation. It extends, rather than silently removes, the
current-occurrence limits above. Shared schedule/cue/duration, explicit removed
step policy, pause/resume/stop and conservative historical protection are defined
in source. Canonical coordinator, private readers, expander guards, owned request
recovery, gated routes and UI remain required. No non-null definition writer,
client generation, migration or QA/activation is claimed. Ordinary weekly Create
now offers an optional collapsed start date with the same selected-day cadence.
