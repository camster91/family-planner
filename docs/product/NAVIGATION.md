# Navigation and information architecture

Status: implemented for #268 and #269 (2026-09-28). This is the current shell. Code: `src/lib/nav-items.ts`
(tabs, More, command palette), `src/components/ui/tab-bar.tsx` (phone), `src/components/layout/DashboardNav.tsx`
(top bar), `src/app/dashboard/page.tsx` (home redirect), `src/app/dashboard/today/page.tsx` (home),
`src/app/dashboard/family/more/page.tsx` (More). Roles: `docs/ROLE_AND_ISOLATION_MATRIX.md` "Home and navigation".

The idea comes from the 2026-09-28 competitive review: an app that gets out of the way. One home, a few stable
tabs, everything else one level down, undo instead of "are you sure", colour only where it means something.

## One home

- A parent's home is the Today board, `/dashboard/today`, on every viewport. `/dashboard` redirects there, so
  old links, the post-login redirect and installed Android bundles keep working.
- Outside fridge mode the page starts with one true sentence about today's chores for the viewer and their own
  chores due today, tickable in place (#268): a parent reads the household ("3 chores left today · Casey 2,
  Taylor 1"); anyone else reads their own list ("You have 2 chores left", "You're done for today"). The board
  follows. Fridge mode (`?mode=fridge`) is the shared surface and shows the board alone.
- Children and teens keep the kid home at `/dashboard` (their missions, and level and rewards when Points &
  streaks is on). It is a different, simpler view on purpose, so their Today tab points there and the board is
  one tap away in the user menu ("Today board"). If the kid home is later folded into the board, change
  `KID_TABS` and `homeHrefFor` in `src/lib/nav-items.ts` and the kid branch of `src/app/dashboard/page.tsx`.

## Tabs

Phone tab bar (below `md`) and top bar (from `md`, so an 800px portrait tablet has tabs too) show the same set:

| Role | Tabs |
|---|---|
| Parent | Today · Calendar · Meals · Lists · Family |
| Teen, child | Today (kid home) · Lists · Emergency |

- Feature-gated tabs hide while their feature is off (Meals with meal planning off; Emergency for kids).
- Kids see only tabs on the kid allowlist (`src/lib/kid-access.ts`, unchanged). Family is parent-only, so
  Emergency keeps its own kid tab: a child home alone must find it in one tap.
- Chores live on Today (the summary's "All chores" link, and "N chores to check" for parents). The Today tab
  stays current on `/dashboard/chores`; the Family tab stays current on Emergency, Features, More and every
  page listed under More.

## Family and More

- Family: members, then a Household group with Emergency (moved here from its own tab) and More.
- More (`/dashboard/family/more`, parents): Chores first, then every enabled feature that is not a tab, in this
  order: Emergency contacts, Food inventory, Pinned notes, Birthdays & anniversaries, Family chat, Projects,
  Budget, Rewards, Analytics, Wishlist, Pickups & dropoffs, Allowance & IOUs, Babysitter handoff, Sick days &
  meds, Locations, Travel mode. Off features are not listed; "Turn features on or off" links to Features. Points
  & streaks is a setting, not a place, so it is not listed (its pages are Rewards and Analytics).
- The user-menu "Food inventory" link (#263) stays, for every role, because children and teens cannot open
  More. The command palette lists the same destinations plus More, Emergency and Travel.

## Undo over confirm

A reversible action runs at once and offers Undo in a toast (`useUndoToast` in `src/components/ui/toast.tsx`:
8 seconds, paused while hovered or focused, 44px Undo button, above the phone tab bar).

| Action | Behaviour |
|---|---|
| Tick a chore (home, chores page) | Optimistic; Undo calls `POST /api/chores/uncomplete`. A child's tick waits for a parent to check it; a parent-checked chore cannot be unticked (409). A failed tick rolls back with the reason. |
| Untick a done chore on the home | Reopens it straight away (no dialog). |
| Delete a list item | Undo re-creates it with the same text, quantity, category, amount, unit and ingredient, ticked again if it was ticked. It comes back at the end of the list and no longer shows which recipe added it. |
| Delete a meal | Undo re-creates it with the same day, slot, name, notes, cook, recipe and servings. |

Confirm stays for actions that cannot be put back faithfully or that remove a lot: delete or leave the family,
delete a list, delete a project and its tasks, delete a chore (recurring series), delete an event (recurrence,
sync), budget categories, calendar disconnects, and the older pages not touched here (locations, allowance,
anniversaries, handoff, emergency contacts, inventory items). Each can move to Undo when its page is reworked.

## Quiet colour

On the home and the navigation, colour marks a person or a state (done, needs a check, errors), not a
category. The home has no coloured glyph tiles and no progress ring; Family and More use plain icons; role
badges in Family and the user menu are neutral. Member colours on the board come with #262.
