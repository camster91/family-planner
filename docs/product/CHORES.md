# Chores: the parent check and picture routines

Status: implemented (2026-09-28): the parent check fix (Verify and Reject on `/dashboard/chores`) and picture
routines for young kids (#272). Roles: `docs/ROLE_AND_ISOLATION_MATRIX.md` "Chores". API:
`docs/architecture/API_CONTRACTS.md` "Chores". Icons: `design/GRAPHICS.md` "Chore picture icons". Journey:
`e2e/routines.spec.ts` (`docs/testing/E2E.md`).

## Life of a chore

| Status | Meaning | Who moves it on |
|---|---|---|
| `pending` / `in_progress` | Open. | Any member ticks it (`POST /api/chores/complete`). |
| `completed` | Done, **waiting for a parent to check**. The home counts these as "N chores to check" for parents; a child sees "A parent will check it." | The ticker or a parent can Undo (`POST /api/chores/uncomplete`, back to `pending`). A parent checks it (below). |
| `verified` | Checked by a parent. XP is awarded here (whether or not Points & streaks is shown). Cannot be undone or sent back (409 `CHORE_ALREADY_VERIFIED`). | — |

### Parent check

On `/dashboard/chores`, "Pending Verification" lists every `completed` chore (photo or not). Both buttons call
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
- Routine steps are not repeated under "Today's Missions", and routine chores due on other days are not shown (a
  routine is about today). Every other chore, and every child without routine chores, sees the kid home exactly
  as before.

The Today board shows a chore's picture next to its title when it has one (the board DTO's `icon`, a catalogue
key only; routine names are not on the board or the shared device).

### Decisions and limits

- Routine is a free-text label rather than a new table: no new household-owned model, the chore's existing
  isolation covers it, and old clients ignore the columns.
- The assignee may change their own chore's picture or routine through `PATCH` (like the title); these fields
  carry no XP or privilege. The UI to edit them is parent-only (`/dashboard/chores` is not on the kid allowlist).
- No completion from the shared tablet yet (phase 2, SHARED_DEVICE.md O-4); the tablet only shows the picture.
