# Today board alignment (#459)

Desktop uses equal columns: Today / Dinner / Groceries on the first row; Chores / Coming up (two columns) on the next. Optional Use soon fills a final row. Row boundaries and gutters line up without stretching Today across dinner and groceries. Portrait starts with a full-width Today, pairs Dinner/Groceries, then Chores and Coming up. Phone stacks in existing source order. Shared region headers reserve 48px (56px at large hub scale), including headings without links, keeping content baselines consistent. Long titles wrap without clipping. Fridge landscape retains original four-column bounded-scroll placement. No changes to household data, permissions, feature selection or action behavior.


## Personal chore presentation (#143)

On the personal Today page, the summary keeps the viewer's own chore rows and their existing complete/reopen/Undo controls. The household tile omits only those exact known-status IDs, so the same chore is not presented twice. Its bounded read can still show other rows for the same member that the summary did not load. Household summary counts remain unchanged. When every board chore is already represented in the summary, the app omits the repeated tile and uses a grid without its vacant area; Coming Up spans the desktop row, with or without Use soon. Fridge mode ignores personal exclusions and retains the complete household hub. This is presentation only: existing canonical reads, mutations and fresh authorization remain in force.
