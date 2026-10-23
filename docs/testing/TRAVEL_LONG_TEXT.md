# Travel household text reflow — #499 / #128

The pending-chore summary shows the full household title and assignee instead of an ellipsis. Both wrap inside the available column, including unbroken pasted text; the due-date column keeps its width and aligns to the top of a multiline row. The existing five-row summary limit, trip date filtering, canonical reads/writes and parent/device permissions remain unchanged.

The existing EN/light and ES/dark Travel recovery journeys now supply a long title with an unbroken segment and a long assignee. They check actual content bounds, overall overflow and accessibility, and preserve an extra screenshot of the active trip. This extends existing cases rather than adding viewport cases or removing recovery assertions.

Observed local checks: all13 existing Travel mounted cases pass; scoped lint, formatting and diff checks pass. Exact combined-source optimized build, rendered checks and hosted acceptance remain pending. This local slice is not deployed.
