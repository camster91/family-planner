# Contextual form sheets

Scope: New List, New Chore, Edit Chore, New Event, and Edit Event opened through dashboard links.
These use the existing form logic inside route-backed overlays. Direct links
and reloads retain the existing standalone pages. Other forms remain unchanged.

The originating screen stays mounted behind a dimmed, inert background. Phones
use a bottom sheet with rounded top corners and safe-area padding; larger
screens use a centred rounded panel. The form scrolls within the viewport while
its close control remains visible. Submit controls stick to the bottom of the
scrolling form, and New List uses a labeled native type picker instead of a large card grid.
Existing optional chore sections stay folded. New List keeps name/type visible,
with optional description and image sections folded. Collapsing preserves
the draft and selected image; a failed upload reopens its section for retry.
Calendar Title/Start/Duration stay visible. A folded Details section summarizes
exact end, notes and location; all inputs remain mounted. Choosing exact end
opens it, and invalid optional dates/times reopen it for correction. Existing
all-day defaults and fetched timestamp precision stay unchanged.

Close or Escape returns through router history and discards the unsaved draft.
Browser Back also restores the prior screen; reopening starts a fresh draft.
No persistent local storage of household form contents is introduced. While a
save, upload, or event deletion is pending, explicit Close and Escape are unavailable.
The pending-navigation controller owns a same-URL history sentinel to hold a
same-document Back attempt while work is pending; authorized success navigation
awaits release of that entry. Actual Next/browser and native Back behavior still
need the consolidated acceptance pass. Successful saves retain their canonical route
and refresh behavior. No new mutation endpoints, auth rules, or database tables.

The shared dialog owns focus trapping/restoration and reduced-motion behavior.
The sheet locks background scrolling and restores it and the background's inert
state on unmount. The parallel route slot has a default and a catch-all null
route so navigation away clears the overlay instead of retaining a stale form.

Validation must cover dismissal, pending state, draft reset, focus/background
restoration, existing form submissions, type checking, lint, and rendered
responsive sizing. A static component preview does not establish actual Next
route interception, authenticated browser history, or physical Android Back.
Calendar sheets localize their title, close label, draft notice and pending notice
through the existing EN/ES calendar-form messages. Original exact event instants,
read-only subscription handling, role checks and nested delete confirmation are
retained. Those remain full application/browser release gates. Rollback removes the slot
and sheet wrappers; the standalone canonical pages and APIs remain usable.

New/Edit Chore sheet titles, close labels and draft/save/upload notices use the
typed EN/ES chore-form dictionary. The shared wrapper keeps the existing canonical
CreateChoreForm/EditChoreForm and busy callback, including upload work. Wrapper
localization/busy source cases are authored; they do not substitute for actual
form/API, browser history or native acceptance. Source reconciliation for #455
(including consolidated #453) and #456 is recorded in
`docs/plans/calendar-connections-and-form-sheets-reconciliation.md`.
