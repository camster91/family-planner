# Calendar workspace — local candidate #457

The shared dashboard content and top navigation use the desktop window width
with existing responsive gutters. Standalone forms keep their readable width;
contextual event create/edit use the route sheets described in FORM_SHEETS.md.

Cameron's screenshots and requested Apple Calendar principles guide the original
Herewoven presentation: a quiet workspace, compact segmented view controls,
184px source sidebar, subtle hourly separators, sticky weekday/date headers and
a labelled current-date marker. Event titles lead, with restrained source accents;
full source and continuation text remains in accessible labels and event details.
Empty day/week views retain their timed grid and a compact empty notice.

The canonical 24-hour grid, overlap placement, exact instants, bounded fetching,
DST agenda fallback, role checks and source filters remain unchanged. This does
not introduce month view, drag scheduling, all-day inference, provider settings,
or new data APIs. Phone timed grids scroll within their container; the default
phone view remains the existing agenda choice.

Focused tests and mounted-fixture markup previews establish local implementation.
The static browser preview labels fabricated events and system-font fallback;
it is not authenticated Next navigation, production data, full browser-matrix,
font-download or physical Android acceptance. Full build and release gates remain
open. Rollback restores shell/CSS presentation and removes event slot wrappers
while retaining standalone pages, canonical APIs and existing saved records.

## Event duration (#458)
Create/edit offer 15, 30, 45 minutes and 1, 1.5, 2 hours, plus custom whole minutes (1–525600). Duration follows the start and displays the calculated end. Select “Choose an end date and time” to return to manual boundaries with the calculated end populated. Existing records remain in manual mode until duration is explicitly chosen, preserving exact imported/stored seconds and DST fold instants on title-only edits. Duration adds elapsed milliseconds to the canonical start; cross-midnight and DST changes do not alter the requested length. API/database continue storing start_time/end_time only. Existing read-only and role restrictions apply.
