# Chores: the parent check, picture routines and taking turns

Status: implemented (2026-09-28): the parent check fix (Verify and Reject on `/dashboard/chores`) and picture
routines for young kids (#272). Roles: `docs/ROLE_AND_ISOLATION_MATRIX.md` "Chores". API:
`docs/architecture/API_CONTRACTS.md` "Chores". Icons: `design/GRAPHICS.md` "Chore picture icons". Journey:
`e2e/routines.spec.ts` (`docs/testing/E2E.md`).

## Life of a chore

| Status | Meaning | Who moves it on |
|---|---|---|
| `pending` / `in_progress` | Open. | Any member ticks it (`POST /api/chores/complete`). |
| `completed` | Done, **waiting for a parent to check**. The home counts these as "N chores to check" for parents; a child sees "A parent will check it." | The assignee or a parent can Undo (not necessarily the member who ticked it) (`POST /api/chores/uncomplete`, back to `pending`). A parent checks it (below). |
| `verified` | Checked by a parent. XP is awarded here (whether or not Points & streaks is shown). Cannot be undone or sent back (409 `CHORE_ALREADY_VERIFIED`). | — |

### Parent check

On `/dashboard/chores`, "To check" lists loaded `completed` chores (photo or not). Rows name the assignee, routine/step and "Waiting for your check"; the assignee is not necessarily the member who ticked it. Both buttons call
`POST /api/chores/verify`:

- **Verify**: `{ choreId, decision: 'approve' }` → `verified`.
- **Reject**: asks for a short reason (the child sees it), then `{ choreId, decision: 'reject', verificationNotes }`
  → back to `pending`, reason in `verified_notes`, the child gets a "Have another go" notification and can tick it
  again. No XP moves.

The row changes at once, then takes the server's state from the response; on failure it goes back and a toast
gives the server's reason. Before this fix both buttons sent `status` through `PATCH /api/chores`, which never
accepted status fields, so they returned 200 and changed nothing.

## Picture routines for young kids (#272)

A chore can have:

- **a picture** (`icon`): one of about 40 built-in, original pictures (brush teeth, get dressed, shoes, backpack, …;
  keys in `src/lib/routine-icons.ts`). Stored as the key; unknown keys are refused by the API.
- **a routine** (`routine`): a short label, at most 40 characters ("Morning", "After school", "Bedtime"). Chores
  of one child with the same routine name (ignoring case and extra spaces) form one routine.
- **a step** (`routine_order`): 1–99, the order inside the routine. Unnumbered steps go last, by title.

Parents set them in the chore create and edit forms (Edit is in the chore's long-press menu): a searchable picture
grid (every choice labelled, at least 64×76), a Routine field with suggestions and a Step number. Recurring chores
copy all three to every generated occurrence (and to the legacy one-off successor). Editing one row does not
change the series' other rows, as for the title.

A recurring series keeps a short window of upcoming chores (7 daily, 4 weekly, 3 monthly). There is no scheduler,
so the window is refilled when any chore of the series is ticked, and when the chores page, the Today board or a
paired tablet's board loads. Changing a chore's "how often" in the edit form starts, re-times or stops its series;
on a generated copy the form shows the series' frequency and a change applies to the whole series (O-33).

### What the child sees

On the kid home (`/dashboard`, child and teen), when they have routine chores due **today**:

- One section per routine, in day order (Morning, After school, Evening, Bedtime, then other names A–Z), each an
  ordered list of big picture cards (96px pictures, the chore title under each picture).
- **The next step** (the first open step of the first routine that still has one) is outlined in the accent colour,
  raised, and carries an arrow badge with the word "Next" (`aria-current="step"`), so a child who cannot read yet
  knows what to do next. Only one step is ever "next".
- **One tap** completes a step through the usual flow: optimistic, `POST /api/chores/complete`, an Undo toast ("A
  parent will check it."), rollback if the server refuses. The step then shows a large tick and the word "Done"
  (never colour alone); its accessible name ends "done, waiting for a parent to check" (or "done, checked by a
  parent" once verified). The routine header counts "N of M done", then "All done".
- Routine steps are not repeated under "Today's Missions". Older open routine occurrences appear separately under
  **Routine catch-up**, labelled with the routine and when they were due; they do not compete with today's "Next".
  Future routine copies and older completed/verified routine steps do not appear in catch-up.
- A rejected open step or mission shows **Have another go** and its `verified_notes` reason. The reason disappears
  when resubmitted; Undo or a refused completion restores it. Completed/verified steps do not show a stale reason.
- Today's missions, older ordinary work and routine catch-up initially show three rows. **Show more** makes every
  loaded row in that group reachable, using the same complete/Undo controls. Only the signed-in child's or teen's
  assigned chores are loaded; no family-wide fetch is added.
- This is a bounded preview, not every household chore: the kid home loads at most 60 own chores in the UTC
  yesterday..day-after-tomorrow window and 60 older open own chores (newest first). Each query reads one extra row
  to detect a cap. A capped preview says so and cannot claim "All done for today". The parent chores page also has
  existing 500-row caps per current query and a 60-day open lookback; older verified history is paged separately.

The Today board shows a chore's picture next to its title when it has one (the board DTO's `icon`, a catalogue
key only; routine names are not on the board or the shared device).

### Decisions and limits

- Routine is a free-text label rather than a new table: no new household-owned model, the chore's existing
  isolation covers it, and old clients ignore the columns.
- The assignee may change their own chore's picture or routine through `PATCH` (like the title); these fields
  carry no XP or privilege. The UI to edit them is parent-only (`/dashboard/chores` is not on the kid allowlist).
- Shared-tablet completion already exists (#274, `SHARED_DEVICE.md` §9.2/O-4): with the shared-device kill switch,
  household tablet-write opt-in (default off) and chores feature on, a picked household member can tick a chore
  due today. It waits for a parent's check, returns no XP and accepts no photo. Device Undo has its own short
  window/ownership rules; it is not the person-session assignee/parent Undo. This change does not alter device gates.

## Taking turns (O-39)

Status: implemented (2026-10-03), owner decision O-39 (`docs/decisions/PROVISIONAL_OWNER_DECISIONS.md`).
Code: `src/lib/chore-rotation.ts`, generation in `expandSeriesInTx` (`src/lib/recurringChores.ts`). API:
`docs/architecture/API_CONTRACTS.md` "Chores" (`rotation`). Roles: `docs/ROLE_AND_ISOLATION_MATRIX.md` "Take turns".

A repeating chore can rotate between chosen people: dishes go Sam → Alex → Jo → Sam. On **New chore** and
**Edit chore**, when "How often" is daily, weekly or monthly, a parent turns on **Take turns** and taps people in
the order they take turns (each shows its number; tap again to take someone out; at least 2, at most 8). On New
chore the "Assign To" field is hidden: the first person takes the first one. On Edit, "This time" still changes who
does just that occurrence. The chores list shows "Takes turns · next: Alex" on open rows of a rotating series.
Kids and the tablet see nothing new: each occurrence simply has its person.

### The rule

- **One turn per occurrence, in due-date order.** Each new copy of the series goes to the person after the
  latest occurrence's place in the order, and wraps around.
- **Who ticked it does not matter.** If Jo does Alex's dishes, the next one is still Jo's.
- **A skipped or late chore keeps its person.** Nothing already made is moved when time passes.
- **Changing one occurrence by hand** ("This time", or Reassign on the list) changes only that row. Each row
  remembers its place in the order (`rotation_index`), so the order carries on as planned.
- **Deterministic and idempotent.** The same series always produces the same people; the read-time top-up and a
  completion refill never reshuffle copies already made (the `(recurrence_id, due_date)` key still guards races).
- **Changing the order** (or turning it on for an existing series) re-plans the rows due after today that nobody
  has started, from the first person. Rows due today or earlier, anything started or done, and any copy a parent gave
  to someone by hand keep their person and take no turn (Cameron's choice, 2026-10-03: a hand pick is never undone).
  Turning it off leaves everyone's chores where they are; new copies then go to the series' own assignee.
- **Someone leaves.** Removing a member (O-34) or deleting an account drops them from every rotation in the
  household, in the same transaction. Their turn passes to the person after them. Their open chores already made
  go to the removing parent to hand on, as O-34 says for every open chore. A rotation left with one person gives
  every new copy to that person (the forms show it as a plain chore); a rotation left with nobody is cleared and new
  copies follow the series' own assignee. Generation also skips anyone no longer in the household.

### Storage

Two additive `Chore` columns (`scripts/migrate.js`, `prisma/schema.prisma`): `rotation_member_ids TEXT[] NOT NULL
DEFAULT '{}'` on the series template (empty = no rotation, the old behaviour; Prisma cannot model a nullable list,
and the empty default is a metadata-only change) and `rotation_index INTEGER NULL` on each row of a rotating series.
Older app versions never read or write them and keep working; rolling the code back leaves them unused.



## Weekly weekday choices (local candidate, #449)

Create and edit forms now offer labelled weekday checkboxes when Weekly is selected. One or more days are required in the new form; old API clients omitting `weekly_days` retain seven-day repetition from their due date. Weekday numbers use the existing UTC date-only policy (Sunday 0 through Saturday 6). Weekly create/edit has no user-entered due-date field. New weekly chores calculate the first selected weekday on or after the viewer’s current calendar day; that occurrence date is passed internally through the existing API. Weekly edits omit due_date, preserving existing occurrence dates. One-time chores retain their date requirement. A Monday/Thursday series then produces Monday and Thursday occurrences, with a bounded four-week upcoming window and the existing series unique key, lazy top-up and rotation policy.

`Chore.weekly_days` is an additive integer array defaulting to empty. The idempotent migration keeps existing rows unchanged. Changing weekdays on a series re-plans only pending future copies using the existing keep-row/history policy; a generated copy explicitly applies its schedule edit to the series. Non-weekly frequency changes clear the template choices. Permissions remain parent-only and household-scoped. Generated copies remain one-offs, with the schedule on their canonical template.

This candidate is not deployed. Focused tests and a temporary-table PostgreSQL migration rehearsal are local evidence; compiled app/hosted/native/production acceptance remains separate.

## Routines for everyone — local candidate (#450)

The Chores page now has a Routines view for all roles using its existing authorized chore rows. Stacks are kept separate by member and due day, ordered by the existing routine step field, and show progress, check status and the next unfinished step. Focus on the next step is optional. Parents can edit a step or add the next step with routine/member/date prefilled; completion uses the existing API and undo. This extends the child picture view without replacing it. The builder, shared schedule, atomic reorder and pause/resume design is specified in [ROUTINE_STACKS.md](ROUTINE_STACKS.md), not yet implemented or released.

## Compact repeating overview — local candidate (#451)

Week and All show one collapsed schedule row per canonical recurring series when more than one open occurrence is in the selected range. The row shows cadence (Daily/Weekly/Monthly, selected weekdays when known), next open date, and the number of open dates in that range. A native details/summary disclosure expands to the existing per-occurrence rows/actions; it never completes or deletes the whole series. Today remains flat and actionable. One-off chores and different recurring series with the same title remain separate. Group identity includes household and recurrence ID, never title. Template schedule metadata is read with a household-scoped query because generated copies store frequency once. Missing templates use the honest Repeating fallback. Parent check queue, history paging and the date-specific routine view remain unchanged. No schema, migration or new API in this slice; rollback the grouping renderer and optional serialization metadata.

## Short chore forms — local candidate (#453)

New/Edit Chore now keep title, assignee and schedule visible. Wide layouts put essentials in two columns; narrow layouts stack them. Optional instructions, difficulty and enabled points live under Details (& points); pictures, routine and step under Pictures & routine; attachment under Photo. Native details/summary sections start closed and summarize selected values. Collapsing keeps the controls mounted and retains their state. Invalid optional inputs open their section so browser validation can reach them. Required fields never live in a collapsed section. Weekly weekday scheduling and local-day minimum dates remain in the essentials. This is the screen-shortening convention for affected forms: group by task, reveal optional complexity deliberately, retain summaries and recovery, and avoid forcing extra steps for a simple submission. Other routes are not claimed to have been rewritten.
