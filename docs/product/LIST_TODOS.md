# To-dos on lists (source authored; default-off, not activated)

An item on a list can say who it is for and when it is due. Grocery and
shopping lists are for buying, not doing, and take neither.

- **Switch:** `FAMILY_LIST_TASKS_READY=1`. Off, `PATCH /api/lists/items/task`
  refuses with `409 LIST_TASKS_UNSUPPORTED` before any write,
  `GET /api/lists/people` answers `{ supported: false }`, the list page reads
  nothing and shows no control.
- **Storage:** a side table, `ListItemTask` (`item_id` primary key,
  `family_id`, `user_id` or `member_id`, `due_day`). `ListItem` is unchanged,
  so every existing list read, write, export and offline replay behaves as
  before. A row exists only while there is an owner or a due day.
- **Owner:** a household account or a standalone email-free profile, the same
  people an event can be for. Attribution only: it grants nothing. An owner who
  has left the household or been archived stops showing; the due day stays.
- **Due day:** a calendar day (`YYYY-MM-DD`), not an instant, so it has no time
  zone. Each reader compares it with their own today: "Due today",
  "Overdue · Thu, Jan 8", "Due Mon, Jan 12".
- **Write contract:** `PATCH /api/lists/items/task { itemId, owner?, due? }`.
  A field left out is unchanged; `null` clears it. Values are explicit, so a
  repeat converges. A person outside the household, an archived profile, an
  unknown id or a date that does not exist refuses with
  `400 LIST_TASK_INVALID` and changes nothing. A grocery or shopping item
  refuses with `409 LIST_TASK_GROCERY`.
- **Who may set it:** parents and teens, like creating a list. Children see
  the owner and due day but get no control, and the server refuses them (403).
  The family "lists" switch still applies.
- **Lifecycle:** deleting the item, the account or the profile cascades the
  row. Household deletion clears the table before list items. The database
  refuses a row whose household is not the item's list's household, an account
  from another household, two owners, and an empty row.
- **Not included:** private lists; reminders or Today rows for due to-dos;
  sorting or filtering by owner or due day; owners and due days in the account
  data export, search, the device board and offline replay.
