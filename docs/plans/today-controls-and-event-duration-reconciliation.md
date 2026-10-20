# Today controls, grocery destinations and event duration source reconciliation

Original issues #461, #462 and #458 under #128/#499. Inventory date: 2026-10-20.
This is source reconciliation only. No test, build, rendered, hosted or device
acceptance was executed for this pass. Existing implementation is retained;
there is no second grocery resolver, toolbar or event-duration model.

## #461: Today groceries and shared lists

| Original requirement | Current implementation | Acceptance source / remaining execution |
| --- | --- | --- |
| Card title/header/overflow opens household grocery resolver | `GroceriesRegion` in `src/components/fridge/regions.tsx` normalizes the old list-overview destination to `/dashboard/lists/groceries`; board data already supplies that resolver path | `src/components/fridge/__tests__/tiles.test.tsx` checks header, overflow and separate shared-list links; actual rendered route navigation remains deferred |
| One grocery list goes directly there; zero/multiple lists use grocery-filtered overview | `src/app/dashboard/lists/groceries/page.tsx` resolves the current signed-in account's household, reads at most two grocery IDs and redirects to the exact list or `/dashboard/lists?type=grocery`; no list creation | `src/app/dashboard/lists/__tests__/grocery-destination.test.tsx` covers zero/one/multiple, missing auth/membership and current household |
| Grocery count excludes non-food shopping while generic Shopping retains both types | `buildTodayBoard` calls `getOpenShoppingItems(..., ['grocery'])`; `src/lib/shopping-snapshot.ts` retains its grocery+shopping default for other consumers | `src/lib/__tests__/shopping-snapshot.test.ts` retains both default and explicit grocery-only predicates; board snapshot and household-isolation cases remain to execute |
| Other lists have a distinct destination and copy | Grocery tile footer links to `/dashboard/lists` with typed `allSharedLists` / `sharedListsDescription` EN/ES copy | Tiles and `regions-localization.test.tsx`; rendered naming/navigation deferred |
| Grocery overview has truthful labels/create affordance | `ListsClient.tsx` initializes/syncs its type filter, uses grocery title/empty/create copy, and retains `?type=grocery` on detail navigation; creation targets `/dashboard/lists/create?type=grocery` when allowed | `type-filter.test.tsx`, detail back-context source; full create/back role/device execution deferred |
| Household/detail authority, device restrictions, tick/undo stay canonical | Resolver derives current household; list detail and mutation routes remain canonical. Device board links are null and its existing capture/actions stay separate | Existing resolver, tile, list-detail and device cases remain unrun in the consolidated candidate |

Rollback remains the scoped resolver/link/type-filter/copy change. Do not change
normal shared-list CRUD, permissions, generic Shopping semantics or the schema.

## #462: Compact Today quick actions

| Original requirement | Current implementation | Acceptance source / remaining execution |
| --- | --- | --- |
| Signed-in app board has role/feature-aware event/chore/grocery/meals/all-list shortcuts | `TodayControls.tsx` uses canonical routes and board links. Event creation is parent/teen plus calendar link; chore creation is parent plus chores link. Lists and meals follow their role/feature-filtered server links | `today-controls.test.tsx` checks parent/teen/child and absent-feature links; actual target journeys remain deferred |
| Controls menu offers Refresh, household features for parents, Settings for allowed roles | The compact details disclosure has online-gated Refresh, parent features link and `canRoleAccessPath`-filtered Settings | Existing source cases for offline refresh and typed EN/ES controls; role route/API gates unchanged |
| Paired devices and fridge mode do not expose account controls | `TodayBoard.tsx` mounts controls only with a person viewer, outside fridge mode and without device tile actions. `DeviceTodayScreen.tsx` mounts fridge mode; server device links are null | `hub.test.tsx` asserts person-only mounting and fridge/no-viewer absence; tiles/device integration and physical-device checks deferred |
| 44px targets, wrapping and keyboard dismissal | Shared target/menu classes use min-height 44px; nav wraps. Escape closes disclosure and restores summary focus; outside pointer closes; Refresh restores focus before loading | Existing control test source covers Escape/outside-pointer/refresh. Reflow, keyboard/touch, focus, long text and six actual viewports remain unverified |
| Existing tile actions are retained | Toolbar is navigation/control only; it does not replace tick/undo, chore completion or device capture handlers | Existing tile/offline/recovery cases remain consolidated-QA scope |

Rollback removes toolbar integration/component. Today personalization and Explore
favorites remain the separate #560/#561 scope; no acceptance is inferred for them.

## #458: Event duration

| Original requirement | Current implementation | Acceptance source / remaining execution |
| --- | --- | --- |
| 15/30/45 minute, 1/1.5/2 hour and custom-minute choices | `src/components/calendar/EventDuration.tsx` supplies 15/30/45/60/90/120 presets and required integer custom minutes from 1 through 525600 | `create-event-form.test.tsx` and date helper source; preset/custom keyboard, mobile and localization execution deferred |
| Selecting duration calculates end and follows start; manual end stays available | Create/Edit forms derive the preview/submission with `eventFormRange`; switching to custom end materializes the selected duration's current local end fields | Authored create-form changed-start/cross-midnight/custom/manual-end cases remain unrun |
| Canonical instants, midnight and DST elapsed time | `src/lib/dates.ts` validates real local minutes and adds duration as elapsed milliseconds to the canonical start instant | `event-wall-clock.test.ts`, `dates.test.ts` and `event-instants.test.tsx`; supported-timezone execution deferred |
| Preserve unchanged edit precision | Original start/end instants are used when displayed local minute fields match; choosing duration preserves the original start's fold/seconds/milliseconds while deriving the requested elapsed end | Existing edit-instant cases include the second fall-back occurrence and sub-minute precision; execution deferred |
| Read-only permissions and EN/ES accessible controls | Imported-source events render the existing read-only view. Duration has labelled min-44px controls, numeric constraints and a live end preview; typed text is in `src/i18n/calendar-forms.ts` | Actual create/edit/imported-source/role journeys, EN/ES, screen-reader and responsive acceptance remain unrun |

Rollback removes duration UI and the optional duration helper argument. Stored
start/end/API contracts remain canonical; no migration, provider change, new
permission, production action or release acceptance is introduced by this map.
