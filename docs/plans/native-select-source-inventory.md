# Native select source inventory

Issue #448; source-only snapshot on 2026-10-20. JSX source locations were
enumerated without compiling CSS or opening browser/OS native popups. Line
numbers are routing hints and can move with later edits. This is not rendered,
contrast, platform, keyboard or accessibility acceptance.

Shared stylesheet: `src/app/globals.css` assigns light color-scheme on :root and
dark on .dark. Option/optgroup and native datalist suggestions receive solid
`--surface-elevated` and `--label-primary`; disabled options use
`--label-tertiary`. Theme token pairs in
this source are light #FFFDF9/#182D2A and dark #182D2A/#F7F4EC. Their compiled and
platform-specific behavior still requires the deferred QA pass.

Inventory: 69 native select declarations in 45 non-test TSX files (including development gallery source).

| Source | Select count | Source lines |
| --- | --- | --- |
| `src/app/dashboard/allowance/create/AllowanceCreateForm.tsx` | 1 | 338 |
| `src/app/dashboard/anniversaries/page.tsx` | 1 | 290 |
| `src/app/dashboard/calendar/CalendarPlanner.tsx` | 1 | 341 |
| `src/app/dashboard/chores/create/CreateChoreForm.tsx` | 1 | 550 |
| `src/app/dashboard/chores/edit/EditChoreForm.tsx` | 1 | 348 |
| `src/app/dashboard/emergency/page.tsx` | 1 | 280 |
| `src/app/dashboard/family/invite/page.tsx` | 1 | 437 |
| `src/app/dashboard/inventory/InventoryClient.tsx` | 3 | 912,930,1648 |
| `src/app/dashboard/inventory/ScanFridgeDialog.tsx` | 2 | 981,1024 |
| `src/app/dashboard/lists/create/CreateListForm.tsx` | 1 | 250 |
| `src/app/dashboard/meals/explore/page.tsx` | 1 | 302 |
| `src/app/dashboard/meals/page.tsx` | 2 | 297,343 |
| `src/app/dashboard/messages/page.tsx` | 1 | 648 |
| `src/app/dashboard/notifications/page.tsx` | 1 | 527 |
| `src/app/dashboard/pickups/page.tsx` | 1 | 797 |
| `src/app/dashboard/settings/CalendarSyncSection.tsx` | 1 | 395 |
| `src/app/dashboard/settings/SettingsClient.tsx` | 1 | 657 |
| `src/app/dashboard/settings/imports/ImportsClient.tsx` | 1 | 115 |
| `src/app/dashboard/sick-days/page.tsx` | 4 | 730,745,976,1014 |
| `src/app/dashboard/wishlist/page.tsx` | 1 | 1096 |
| `src/app/dev/design-system/sections.tsx` | 1 | 298 |
| `src/components/assistant/AssistantPanel.tsx` | 4 | 887,903,1023,1208 |
| `src/components/budget/TransactionForm.tsx` | 2 | 569,676 |
| `src/components/calendar/EventDuration.tsx` | 1 | 14 |
| `src/components/chores/ChoreViewControls.tsx` | 2 | 52,69 |
| `src/components/chores/IndependentRoutineEditor.tsx` | 3 | 212,252,373 |
| `src/components/chores/RoutineScheduleEditor.tsx` | 4 | 276,385,463,536 |
| `src/components/chores/RoutineStackEditor.tsx` | 2 | 1233,1393 |
| `src/components/device/DeviceGroceryAdd.tsx` | 1 | 334 |
| `src/components/family/ProfileAccountLinkManager.tsx` | 1 | 278 |
| `src/components/family/ProfileSetupPanel.tsx` | 1 | 289 |
| `src/components/fridge/BoardSettings.tsx` | 2 | 291,441 |
| `src/components/fridge/TodayLayoutEditor.tsx` | 1 | 283 |
| `src/components/inventory/BarcodeFoodDialog.tsx` | 4 | 572,613,838,872 |
| `src/components/inventory/InventoryRestockSheet.tsx` | 1 | 399 |
| `src/components/meals/AddToGroceriesButton.tsx` | 1 | 395 |
| `src/components/meals/BulkCookingPanel.tsx` | 1 | 277 |
| `src/components/meals/MealAllocationEditor.tsx` | 1 | 96 |
| `src/components/meals/MealPrepActionSheet.tsx` | 1 | 233 |
| `src/components/meals/MealPrepEditor.tsx` | 2 | 359,403 |
| `src/components/meals/RecipeCollections.tsx` | 2 | 144,225 |
| `src/components/meals/RecipePicker.tsx` | 1 | 133 |
| `src/components/onboarding/OnboardingFlow.tsx` | 1 | 713 |
| `src/components/projects/AddProjectTaskForm.tsx` | 1 | 256 |
| `src/components/ui/legacy-queue-recovery.tsx` | 1 | 216 |

## Coverage boundaries

All listed selects are descendants of the root global stylesheet in app routes;
no route-specific native popup stylesheet or new dropdown component was added.
A lexical scan of option/optgroup opening tags found 0 tags with inline
className/style attributes. This scan does not prove browser cascade/OS popup
behavior or detect dynamically generated/external controls.

The custom-surface continuation below supersedes the earlier partial inventory.
The inventory remains a source map; compiled/generated/native behavior still
requires the deferred full-candidate pass.

## Custom surfaces and native suggestions — source continuation

Non-test TSX was searched for menu/listbox roles, menuitem roles, aria-haspopup,
anchored top-full popovers, dropdown/popover/combobox terms and native datalists.
The resulting distinct implementations and their shared-surface consumers were
traced rather than introducing another dropdown abstraction. This is a lexical
source audit; external/dynamically generated UI and platform popups cannot be
proved by it.

| Implementation | Surface/text reconciliation | Preserved behavior |
| --- | --- | --- |
| DashboardNav account dropdown | card-apple elevated surface now has explicit text-label-primary; child labels/secondary/help colors retained | Existing outside-click, account/role routes and sign-out remain |
| ProjectDetailActions menu | Explicit surface-elevated, label-primary and semantic separator replace mixed card/inherited menu base; action success/danger colors remain | Existing menu/menuitem roles, first focus, arrow keys, Escape and canonical actions retained |
| TodayControls details popup | Already uses elevated surface, primary labels and focus tokens | Native disclosure, Escape/outside pointer, refresh/role links retained |
| CalendarPlanner connection menu | CSS already pairs elevated surface/label-primary and accent link/focus tokens | Native disclosure and canonical Settings anchors unchanged |
| CommandPalette custom dialog | Elevated palette now has an explicit primary text baseline; input/result/help labels keep explicit semantic colors | Search, route filtering, keys and request behavior unchanged |
| LongPressRow action sheet | Elevated surface now has primary baseline; individual accent/danger/disabled/cancel text remains | Existing long-press/button, focus, actions and cancellation retained |
| Shared Dialog consumers: ExplorePanel, CaptureSheet, list controls and form/picker/confirmation sheets | Shared elevated panel now pairs an explicit primary foreground; consumer help/action/danger colors still override intentionally | Existing portal, stacking, focus trap/restore, pending, role and canonical form/control behavior retained |
| RoutineFields native datalist | One native suggestion list in RoutineIconPicker now joins the global option surface/foreground rules; root theme color-scheme remains the fallback for OS-owned rendering | Input list/id relationship, literal suggestion values and native selection remain |
| Other native details: optional forms, help, recovery, overlap lists and Settings disclosures | In-flow disclosures rather than select menus; use root/shared panel/explicit card token inheritance | Disclosure/state/validation behavior unchanged; full rendering remains deferred |

There is no newly introduced custom select, OAuth/provider, invitation or data
path. Development gallery consumers retain their shared primitives. This pass
adds presentation tokens only; no low-value implementation-mirroring tests were
added. Existing theme/contrast, menu/keyboard/dialog and journey source remains
the acceptance base for the integrated QA pass.

Deferred acceptance: compile actual CSS, check representative closed/open native
controls in light/dark, verify contrast and keyboard/selection behavior, inspect
all role/device themes and custom surfaces, and separately prove actual Android
and Windows native popups plus hosted/build gates. Rollback is scoped to shared option CSS and the affected menu/panel presentation
classes; preserve all selection/action/role logic. No API, schema, household data,
invitation or message changes.
