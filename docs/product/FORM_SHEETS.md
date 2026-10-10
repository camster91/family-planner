# Contextual form sheets

Scope: New List, New Chore, Edit Chore, New Event, and Edit Event opened through dashboard links.
These use the existing form logic inside route-backed overlays. Direct links
and reloads retain the existing standalone pages. Other forms remain unchanged.

The originating screen stays mounted behind a dimmed, inert background. Phones
use a bottom sheet with rounded top corners and safe-area padding; larger
screens use a centred rounded panel. The form scrolls within the viewport while
its close control remains visible. Submit controls stick to the bottom of the
scrolling form, and the sheet's list-type picker uses three compact columns.
Existing optional chore sections stay folded.

Close or Escape returns through router history and discards the unsaved draft.
Browser Back also restores the prior screen; reopening starts a fresh draft.
No persistent local storage of household form contents is introduced. While a
save, upload, or event deletion is pending, explicit Close and Escape are unavailable; browser
history remains platform-owned. Successful saves retain their canonical route
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
