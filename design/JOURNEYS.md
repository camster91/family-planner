# IA and critical journey review map

Status: review source grounded in `e0c7dac`, 2026-10-07; #151 remains open. All 61 current page files are assigned below. API handlers are service actions rather than navigation destinations; their per-handler roles, device accept/refuse rules and domain homes remain in `docs/refactor/ROUTE_AND_DOMAIN_INVENTORY.md` and `docs/security/API_ISOLATION_AUDIT.md`.

## Five modes and adaptive navigation

| Mode                  | Frequent destinations / intent                                                                        | Private boundary                                                                                                                              |
| --------------------- | ----------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Shared fridge tablet  | Device Today: schedule, chores, dinner, grocery summary; calm/night presentation                      | Device DTO/route allowlist. Parent elevation grants setup only, never a personal dashboard session.                                           |
| Parent companion      | Today, Calendar, Meals, Lists, Family; personal user menu for Settings                                | Parent finances, messages, accounts and medical/private records stay in this personal session.                                                |
| Teen                  | Own missions, Calendar, Meals, Lists, Emergency; personal Help, notifications and restricted Settings | No family administration, event edit or private parent destinations. Individual API capabilities still apply.                                 |
| Child                 | Own missions, Lists, Emergency; other permitted personal pages through their existing links           | Child-specific APIs shape records; no administrative controls. Child emergency access is intentional and separate from paired-device privacy. |
| Parent administration | Family → More / Features, user menu → Settings, Devices, Imports, Activity                            | Parent person session, role/household/feature checks. No equivalent unrestricted route under tablet elevation.                                |

At 390×844 compact width, personal bottom navigation keeps frequent destinations within reach. From the actual `md` breakpoint (768px), the personal shell uses a top bar; 800×1280 keeps a distinct board layout rather than enlarging phone tiles. At 1280×800 the dedicated `/device/today` has shared tiles and no personal dashboard navigation. The review maps document these audiences; viewport-specific composition and one-handed/distance review still need explicit design frames and rendered acceptance. This table does not claim those checks passed.

Frequent entry targets: Calendar → Add event (2 decisions); Lists → grocery list → Add (3); Meals → day/slot → add (3); Today → All chores → Add (3). These count navigation choices, not typing, required consent or save actions. Optional modules live under feature-gated Family → More, not additional primary tabs; off features do not appear. Existing installed links and redirects stay compatible.

## Back and deep links

- Android Back on every `/device/*` page backgrounds the task through `MainActivity.java`; it must never traverse to a previous personal sign-in or dashboard. It does not imply lock-task, kiosk, reboot launch or physical-device proof.
- Elsewhere the existing Android dispatcher delegates to normal Capacitor/system history. Personal dialog/sheet designs should dismiss the foreground layer first; confirm form discard only where losing input requires it. Do not claim a native behavior was added by this review document.
- Personal links retain their current route, role and household checks. Login redirects remain same-origin; a link may not supply authority to bypass a role gate.
- An unpaired/removed tablet returns to pairing with no household data. Claim/elevation handles stay in memory. Revocation/invalid session/disabled device endpoints purge device state; transient 503/429/network errors do not falsely unpair it.
- Elevation ends on Done, idle/maximum expiry, hide or reload; parent-only destinations remain on the phone even during elevation.

## Critical journey maps

The editable Figma page `02 · Journey and privacy maps` contains [journeys 1–3](https://www.figma.com/design/s0qsOr91Au0OJ70SCZEWb4?node-id=7-58), [4–6](https://www.figma.com/design/s0qsOr91Au0OJ70SCZEWb4?node-id=7-140), and [7–9](https://www.figma.com/design/s0qsOr91Au0OJ70SCZEWb4?node-id=7-222). Fifty-four state cards are linked instances of six `Journey / State annotation` variants, with editable title, description and next-action text. They are decision/recovery diagrams, not app-screen captures.

Happy, empty, loading, error, offline and permission branches appear for every journey. The diagram expects truthful failure recovery, retained safe form drafts and distinct offline vs saved states. Some expectations need additional implementation; a design annotation is not runtime proof.

| Journey                                 | Audience                                                       | Main path                                                                                                                 |
| --------------------------------------- | -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| 01 · Parent onboarding                  | Parent personal session                                        | Register / sign in → create or join household → Today get-started card → first chore or event                             |
| 02 · Pair a shared tablet               | Parent phone + unpaired tablet                                 | Phone Settings → Devices → create 10-minute code → tablet enters code → parent confirms four digits → device Today        |
| 03 · Morning glance                     | Shared device / parent / teen / child                          | Wake or tap → Today or kid home → schedule, chores, groceries and tonight summary → allowed tile action                   |
| 04 · Evening glance / calm display      | Shared tablet, with parent-controlled board settings           | Today dinner and chores → idle calm display → configured night dim → tap wakes normal board without completing an action  |
| 05 · Quick-add event                    | Parent or teen personal session; no device event-creation path | Calendar tab → Add event → date/time and required fields → save → calendar                                                |
| 06 · Quick-add grocery                  | All personal roles; paired-device add is a missing UI path     | Lists → grocery list → Add item → canonical ListItem; shared board quick-add requires an explicit canonical list ID       |
| 07 · Quick-add meal                     | Permitted personal session; shared-device dinner is read-only  | Meals tab → select day / meal slot → add or choose a recipe → save canonical FamilyMeal → Tonight                         |
| 08 · Quick-add task / chore             | Parent personal session; children complete assigned work       | Today → All chores → Add chore → title / assignee / schedule → save → Today or chores                                     |
| 09 · Parent mode and private boundaries | Shared device setup versus parent phone administration         | Shared board → parent identity proof → only device-allowlisted setup → Done / idle / hide / maximum expiry → shared board |

## Implementation gaps exposed by the map

- Shared-tablet grocery quick-add: the add endpoint exists, but no board control is built and an empty board currently lacks its canonical list ID. Resolve that ID explicitly, preserve the shared write gates and attribution, and reuse the existing idempotent route; do not infer a list ID from an item or add a tablet-specific data model.
- Offline: the current allowlist permits explicit list-item checked state. Event, meal, chore and grocery creation are not queued. A current in-memory board is not a persistent cold-launch snapshot; #162 still owns that missing acceptance.
- Shared event/meal/task creation must not be shown as available through nonexistent device routes. Personal add flows retain current role restrictions. A future device extension needs its own allowlist, authorization and isolation evidence.
- Viewport-specific screens, one-handed phone use, 1–2 metre glance readability and complete Android hardware behavior are not proved by the maps. #150/#151/#242 retain those checks.

## Every current page has a home

Generated from the 61 `src/app/**/page.tsx` files. The personal path gate column evaluates the actual `canRoleAccessPath` against each normalized route. It is a navigation gate only, not proof of authorization to read or mutate every object on that page. Public/token/device routes retain their own middleware and server checks. No route is deleted in this slice.

| Route                           | IA home                                        | Personal path gate             | Disposition                                              |
| ------------------------------- | ---------------------------------------------- | ------------------------------ | -------------------------------------------------------- |
| `/`                             | Public introduction                            | Not a personal dashboard route | Retain                                                   |
| `/dashboard`                    | Role home: parent Today redirect; kid missions | parent, teen, child            | Retain                                                   |
| `/dashboard/allowance`          | Family → More (feature-gated)                  | parent, teen, child            | Retain                                                   |
| `/dashboard/analytics`          | Family → More (feature-gated)                  | parent                         | Retain                                                   |
| `/dashboard/anniversaries`      | Family → More (feature-gated)                  | parent                         | Retain                                                   |
| `/dashboard/budget`             | Family → More (feature-gated)                  | parent                         | Retain                                                   |
| `/dashboard/calendar`           | Calendar tab                                   | parent, teen                   | Retain                                                   |
| `/dashboard/calendar/create`    | Calendar tab                                   | parent, teen                   | Retain                                                   |
| `/dashboard/calendar/edit`      | Calendar tab                                   | parent                         | Retain                                                   |
| `/dashboard/chores`             | Today → All chores                             | parent                         | Retain                                                   |
| `/dashboard/chores/create`      | Today → All chores                             | parent                         | Retain                                                   |
| `/dashboard/chores/edit`        | Today → All chores                             | parent                         | Retain                                                   |
| `/dashboard/emergency`          | Family → More (feature-gated)                  | parent, teen, child            | Retain                                                   |
| `/dashboard/family`             | Family tab                                     | parent                         | Retain                                                   |
| `/dashboard/family/create`      | Family tab                                     | parent                         | Retain                                                   |
| `/dashboard/family/invite`      | Family tab                                     | parent                         | Retain                                                   |
| `/dashboard/family/more`        | Family tab                                     | parent                         | Retain                                                   |
| `/dashboard/family/settings`    | Family tab                                     | parent                         | Retain                                                   |
| `/dashboard/features`           | Family → Features                              | parent                         | Retain                                                   |
| `/dashboard/handoff`            | Family → More (feature-gated)                  | parent, teen, child            | Retain                                                   |
| `/dashboard/help`               | User menu → Help                               | parent, teen                   | Retain                                                   |
| `/dashboard/inventory`          | Family → More (feature-gated)                  | parent, teen, child            | Retain                                                   |
| `/dashboard/lists`              | Lists tab                                      | parent, teen, child            | Retain                                                   |
| `/dashboard/lists/[listId]`     | Lists tab                                      | parent, teen, child            | Retain                                                   |
| `/dashboard/lists/create`       | Lists tab                                      | parent, teen, child            | Retain                                                   |
| `/dashboard/lists/type/[type]`  | Lists → type filter                            | parent, teen, child            | Compatibility redirect to ?type=; retain installed links |
| `/dashboard/locations`          | Family → More (feature-gated)                  | parent                         | Retain                                                   |
| `/dashboard/meals`              | Meals tab                                      | parent, teen                   | Retain                                                   |
| `/dashboard/meals/recipes/[id]` | Meals tab                                      | parent, teen                   | Retain                                                   |
| `/dashboard/messages`           | Family → More (feature-gated)                  | parent                         | Retain                                                   |
| `/dashboard/notes`              | Family → More (feature-gated)                  | parent                         | Retain                                                   |
| `/dashboard/notifications`      | Notifications bell                             | parent, teen                   | Retain                                                   |
| `/dashboard/pickups`            | Family → More (feature-gated)                  | parent                         | Retain                                                   |
| `/dashboard/projects`           | Family → More (feature-gated)                  | parent                         | Retain                                                   |
| `/dashboard/projects/[id]`      | Family → More (feature-gated)                  | parent                         | Retain                                                   |
| `/dashboard/projects/create`    | Family → More (feature-gated)                  | parent                         | Retain                                                   |
| `/dashboard/rewards`            | Family → More (feature-gated)                  | parent                         | Retain                                                   |
| `/dashboard/rewards/create`     | Family → More (feature-gated)                  | parent                         | Retain                                                   |
| `/dashboard/search`             | Search / command palette                       | parent                         | Retain                                                   |
| `/dashboard/settings`           | User menu → Settings                           | parent, teen                   | Retain                                                   |
| `/dashboard/settings/activity`  | User menu → Settings                           | parent                         | Retain                                                   |
| `/dashboard/settings/devices`   | User menu → Settings                           | parent                         | Retain                                                   |
| `/dashboard/settings/imports`   | User menu → Settings                           | parent                         | Retain                                                   |
| `/dashboard/sick-days`          | Family → More (feature-gated)                  | parent, teen, child            | Retain                                                   |
| `/dashboard/today`              | Today / board                                  | parent, teen, child            | Retain                                                   |
| `/dashboard/travel`             | Family → More (feature-gated)                  | parent                         | Retain                                                   |
| `/dashboard/wishlist`           | Family → More (feature-gated)                  | parent, teen, child            | Retain                                                   |
| `/dev/design-system`            | Development fixture gallery                    | Not a personal dashboard route | Retain                                                   |
| `/device`                       | Shared-device pairing / Today / removed        | Not a personal dashboard route | Retain                                                   |
| `/device/pair`                  | Shared-device pairing / Today / removed        | Not a personal dashboard route | Retain                                                   |
| `/device/removed`               | Shared-device pairing / Today / removed        | Not a personal dashboard route | Retain                                                   |
| `/device/today`                 | Shared-device pairing / Today / removed        | Not a personal dashboard route | Retain                                                   |
| `/forgot-password`              | Personal authentication                        | Not a personal dashboard route | Retain                                                   |
| `/handoff/[token]`              | Token-scoped sitter link                       | Not a personal dashboard route | Retain                                                   |
| `/join`                         | Onboarding / invitation                        | Not a personal dashboard route | Retain                                                   |
| `/login`                        | Personal authentication                        | Not a personal dashboard route | Retain                                                   |
| `/privacy`                      | Public legal                                   | Not a personal dashboard route | Retain                                                   |
| `/register`                     | Personal authentication                        | Not a personal dashboard route | Retain                                                   |
| `/reset-password`               | Personal authentication                        | Not a personal dashboard route | Retain                                                   |
| `/terms`                        | Public legal                                   | Not a personal dashboard route | Retain                                                   |
| `/verify-email`                 | Personal authentication                        | Not a personal dashboard route | Retain                                                   |

## Planned module disposition

Voice, barcode, receipts, URL recipe import, smart-home/Home Assistant, photo screensaver and advanced optimization stay post-MVP candidates in `docs/FRIDGE_TABLET_PROGRAM.md`; they receive no new top-level destination here. Contextual AI/food assistance remains grounded in canonical household data and approved provider/feature gates. Weather, inventory, scan, imports, calendar connections, travel and other optional modules retain their existing explicit switches and More/settings homes. This design slice enables no provider, scheduler or feature in production.
