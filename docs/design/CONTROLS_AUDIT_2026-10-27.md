# Controls and menus audit — 2026-10-27

## Evidence and scope

Requested by Cameron after the phone Today screenshot showed several control rows before household content. Source baseline: `f6dcc385`, local branch `codex/app-review-followthrough-20261027`. This is an audit, not a deployed redesign.

The supplied production screenshot establishes the Today problem. Its browser/status bars are excluded: app content begins at approximately image y 135, with the first card at y 600, leaving about 465 image pixels of app header/title/actions before content. This is an approximate screenshot measurement, not CSS pixels or a claim that all this space contains buttons.

[Control inventory](CONTROLS_INVENTORY_2026-10-27.csv): 1,819 lexical control/component references across 236 application/component TSX files, excluding tests. Includes native interactive elements, Link and named button/menu/picker/switch/toggle/tab/dialog/sheet components. Repeated list templates count once at source; composed controls may have both caller and implementation entries. Dynamic controls, translated accessible names and rendered role visibility require browser inspection. This is a traceable source inventory, **not** a claim that every control was manually exercised or that 1,819 controls appear on screen.

Detailed source inspection covers the shared shell, Today, Calendar, Meals, Lists, Chores views, Family, Settings, Notifications, quick-add, assistant and shared dialog. Other feature files are inventoried; their full interaction acceptance remains open. Fresh local screenshots and their findings are recorded below after capture. No production writes, provider calls or native acceptance are part of this audit.

## Findings and disposition

| Priority | Finding and evidence | Recommended disposition | Status |
|---|---|---|---|
| P 1 | Production Today repeats Explore from the bottom tab and exposes both Today controls and Customize Today. Supplied screenshot. | Keep Add or ask and one secondary menu. Put customization inside it. | Already changed locally in 88d263c9; not confirmed live. |
| P 1 | Fridge mode consumes phone space despite being intended for larger shared displays. Supplied screenshot. | Hide the entry on small layouts; always preserve Exit for an already active mode. | Locald8d751fa addresses entry visibility. CSS cannot reliably measure physical inches. |
| P 1 | Today still stacks label, long date/clock, sync row and toolbar in local source (`TodayBoard.tsx:878`). | Compact the personal phone date header; omit its duplicate clock; put normal sync details in the secondary menu. Keep stale/offline/error warnings visible. Keep the large clock on the dedicated shared display. | Further simplification proposed. |
| P 1 | Calendar has date title, four views, action row, source controls and previous/Today/next before events (`CalendarPlanner.tsx:335–500`; mobile CSS makes several full-width rows). Source filtering exists in both the calendar menu and source pane. | On phone, keep date navigation, Add and one current-view selector. Use one Calendars menu for source selection/connections. Desktop can retain the sidebar and segmented views. | Source-confirmed duplication; rendered size checked separately. |
| P 1 | Meals stacks title/subtitle/inventory shortcut, Add meal, Plan/Explore/Prep, optional several-meals launcher, date range and three wide week-navigation buttons (`meals/page.tsx:1005–1175`). | Keep Plan/Recipes/Prep, a compact date navigator and a context-specific Add. Move batch planning into that Add menu; inventory becomes contextual. Preserve pending-work recovery banners. | Source-confirmed stacked controls; rendered size checked separately. |
| P 2 | Today controls is itself becoming a second navigation hub: Explore, customization, groceries, all lists, meals, refresh, features, Settings (`TodayControls.tsx:119`). | Make it board-specific: Customize Today, refresh/status, eligible display mode. Keep feature navigation in tabs/Explore and personal Settings in the account menu. | Local toolbar improvement is useful but menu scope remains too broad. |
| P 2 | Shell shows search, review inbox, notifications and account alongside branding (`DashboardNav.tsx:239`). | Keep search/account; give review and notifications a coherent Activity entry with clearly separated destinations inside. Do not merge their backend semantics. Preserve visible counts and urgent access. | Proposed; requires role/state review before implementation. |
| P 2 | Account dropdown has fixed width and no explicit viewport height/scroll cap (`DashboardNav.tsx:295`). Conditional child feature links can make it much longer. | Use a bounded, scrollable mobile sheet/menu; keep account actions separate from feature navigation. | Source risk; needs expanded-role/short-height rendering. |
| P 2 | Notifications repeat open, snooze, mark-read and delete on each eligible row (`notifications/page.tsx:639–725`). | Make the notification destination the row's main action; keep mark-read and a More menu containing snooze/delete. Never make swipe the only route. Keep Undo/recovery. | Source-confirmed repeated action cluster. |
| P 2 | Chores splits views between three buttons and a More select, then adds a routine range select (`ChoreViewControls.tsx`). | Give Tasks/Routines clear destinations; keep Today/Week as scope, move history/repeating-series management into one view picker. Avoid overlapping definitions of view and range. | Proposed information-architecture cleanup. |
| P 2 | List type chips can wrap, and family/greeting, filter status and section headings add rows (`ListsClient.tsx:207–315`). | Preserve New list and useful type filters. Use one compact filter picker on constrained widths; don't hide an active filter. Remove repeated headings that say the same thing. | Source risk; dynamic type counts affect rendered height. |
| P 2 | Add or ask opens an action chooser before the assistant composer (`QuickAddDialog.tsx:82`). | Keep one shared entry point; do not add another floating AI launcher. Judge whether text entry can live in that same sheet after reviewing actual usage. Manual actions must stay available. | Existing local composer-first work helps; avoid a new competing menu. |
| P 2 | Optional fields and destructive actions can compete with the core form across feature forms. | One primary Save/Create in a consistent footer; optional fields in More details; Delete inside item options. Preserve draft-aware Back, focus restoration, validation and explicit destructive consequences. | Inventory-wide review rule, not a claim every form currently fails. |

## Proposed control budget

These are design targets for the next implementation, not measured pass results:

- Phone Today: first useful card begins within roughly 220 CSS pixels of app viewport top at 390×844 in the default settled state. No browser chrome in this measurement. Large text, alerts and setup can legitimately exceed it.
- One primary page action; at most one secondary menu beside it. Contextual completion controls remain next to their task.
- No duplicate destination in the same local toolbar and primary tab bar.
- At most one view row and one contextual filter/date row before working content on a normal list/planner screen.
- Keep 44×44 primary touch targets; reduce the number of controls and spacing layers, not target sizes.
- Menu labels describe contents: Customize Today, Calendars, List options. Avoid a generic Controls menu containing unrelated app navigation.
- Menus close with Escape/Back, restore focus, fit viewport/keyboard, expose state, and preserve draft safeguards. Never bury emergency access, offline warnings, pending writes or recovery.
- Parent, teen, child and paired device have different permitted actions. Hiding is not authorization; existing backend checks stay authoritative.

## Coverage still needed beyond the source inventory

All-feature and empty/populated states, child/teen/email-free profiles, shared-device cover/elevation,200% text, dark/light native select popups, keyboard/Back/focus, long translations, permission denial, offline/write recovery, and physical Android/iOS remain separate checks. A screenshot cannot establish those behaviours. No “all controls passed” claim is made.

## Implementation order

1. Release the already prepared Today reductions through the existing release approval path, or include them with the next reviewed UI patch; do not duplicate them.
2. Compact Today header and make its menu board-specific.
3. Consolidate Calendar and Meals control rows.
4. Bound account menus, reduce notification row actions and simplify Chores/List filters.
5. Apply the same rule to remaining feature headers/forms using the inventory; verify each changed journey rather than redesigning every feature at once.

## Fresh rendered review

Cameron approved local Playwright with fabricated household data. Captured the current existing production build locally (no new source code edits/build), using fixture parentA at 390×844,800×1280 and 1366×768. Two capture runs completed: each had 3 login setup cases and 3 capture cases; these are capture completions, not exhaustive functional tests.

- Baseline:31 destinations ×3 sizes plus 3 Today menu states ×3 sizes =102 screenshots.
- Enabled-feature follow-up:10 destinations ×3 sizes =30 screenshots. Eight had shown feature-off screens in the first pass; Analytics and Emergency extended coverage. Total 33 distinct destinations and 132 screenshots.
- Inspected all screenshots in contact sheets, then Today and Calendar phone captures at original size. Images are at `/tmp/controls-audit-20261027/` and `/tmp/controls-audit-enabled-20261027/`. Local gallery: `/tmp/controls-audit-20261027/index.html`.
- Captures used the light theme and fixture clock. The supplied production screenshot supplies dark-theme Today evidence only. No broad dark-theme acceptance is claimed.
- No horizontal document overflow was detected in the 93 baseline route captures. This does not establish absence of internal clipping, keyboard obstruction or safe-area issues.
- Element-coordinate JSON is diagnostic only: bounding rectangles can include closed-details descendants. Do not use its array length as a visible-button count.
- Some desktop/tablet account-menu captures did not visibly show an expanded dropdown; those captures do not validate expanded-menu behaviour. Phone expanded account, Today and Add menus were visibly captured.

### Confirmed visual findings

| Priority | Screen/state | Observation | Disposition |
|---|---|---|---|
| P 1 | Phone Calendar, agenda | First event title appears around y 705 in an 844 px app viewport. View buttons, connection menu, Add, a second source toggle, sync, date navigation, active source text and overlap disclosure precede it. | Consolidate source controls and collapse mobile view selection; move normal sync into menu. Keep overlap warning meaningful but compact. |
| P 1 | Phone Today, populated | First card begins around y 352, despite the already simplified toolbar. A chore summary/review row precedes the date, clock and sync line. | Integrate chore summary/review into its card or one compact alert; reduce header height. The local toolbar fix alone does not meet the proposed 220 px target. |
| P 1 | Phone Meals | Previous/current week occupy one row and Next week wraps onto another. First meal card begins around y 410. | One compact previous/current/next date strip with accessible arrow labels. |
| P 2 | Recipe exploration | Source select + Search recipes + separate BBC/AllRecipes/Serious Eats search links appear before link import and saved recipe box. Mobile saved recipes are below the initial viewport. | Make Find online / Saved recipes / Import distinct modes inside the Recipes view. Keep one search action, with external search as an explicit fallback. |
| P 2 | Projects, Emergency, Handoff; Budget and Inventory | Empty screens show both header creation and another create action in the empty state. | In empty state use one prominent contextual creation action; restore header Add when records exist. |
| P 2 | Many secondary screens | Add or ask and Report / Suggest recur as two pill controls after content, including feature-off pages. Their varying position makes them look like another page toolbar. | Keep a predictable global assistant entry and move Report / Suggest into Help/account; don't add another persistent control band. |
| P 2 | Review inbox | Five category buttons wrap over three rows on phone before the first review card. | One category picker with counts or a compact primary/More grouping. Preserve pending-work visibility. |
| P 2 | Family | Invite member, Settings and Add a household profile occupy two rows; each member card exposes Remove. | One Add person entry that explains account vs email-free profile; settings and member management in their contextual menus. Preserve clear parent-only permissions. |
| P 2 | Inventory, enabled and empty | Refresh, Scan food, Add item and four location choices appear before empty/use-soon content. | Primary Add with Scan/manual options; compact location filter; refresh in overflow. |
| P 2 | Phone Lists | Type filters wrap over two rows, then ALL LISTS adds another heading before records. | Compact filter picker and remove duplicate section label. |
| P 2 | Phone Settings | Account/Family/Privacy buttons wrap. Long account content follows. | Keep the meaningful categories; use a compact selector on narrow screens, not another competing settings menu. |
| P 2 | Chore create | Fresh captures show an email-free-profile load failure and a retry control. | Treat as an observed local failure, not a cosmetic extra button; diagnose API/environment response before removing it. Existing-member assignment remains visible. Production impact unverified. |
| P 2 | Analytics | Progress-by-person description renders the literal `{days}`. | Fix interpolation in a separate small correctness patch. |

The capture run changed only the disposable `fx_family_a` feature switches to open disabled features; their prior JSON was backed up and restored. No household content was created through the captured forms, no real family was changed, and no paid AI or search action was submitted.

### Remaining audit limits

This is a broad visual/source audit of every feature area with an inventory of control declarations, not full interaction coverage of every control/state. Child/teen menus, all detail/edit dialogs, populated secondary-feature records, dark native dropdowns, keyboard/Back and shared-device mode still need targeted follow-up. The inventory is the checklist for that work. The 132 screenshots establish initial viewport/layout findings only; don't close release/QA issues on this evidence.

## Bounded repairs — 2026-10-27

Following Cameron's “Fix other issues” instruction:

- Progress-by-person copy now passes the canonical90-day window to translation, removing the literal placeholder. Existing analytics case checks against an unresolved placeholder.
- Account dropdown is capped to available viewport height with vertical scrolling and contained overscroll; its width is bounded on narrow screens.
- Projects, Emergency, Handoff, Budget and Inventory empty states no longer repeat their primary create action. The existing header/summary action stays available in empty and populated states, preserving a stable dialog focus-return target. This deliberately uses the simpler alternative to the original empty-state-specific action recommendation.

Observed verification:91 affected Jest cases passed across9 suites; affected-file ESLint returned zero errors with4 existing hook warnings. Production build passed. Local Playwright passed3 fixture sign-ins and2 phone/desktop journey cases: exactly one creation entry on each affected screen, four create dialogs open/Escape/restore focus, analytics shows90days, and a390×480 account menu can scroll Sign Out into view and restore focus after Escape. Screenshots in `/tmp/controls-fixes/`; inspected phone menu, analytics and Handoff captures. No real data/provider writes or production release. Temporary capture spec retained at `/tmp/controls-fixes-check.spec.ts` rather than added to the permanent test suite.

The broader Today/Calendar/Meals redesign, remaining menu consolidation and the observed chore-profile read failure remain separate unresolved findings; this patch does not mark the entire audit closed.

## Chore capability and meal navigation follow-through

The local chore-profile warning was traced to the real409 `PROFILE_SETUP_UNSUPPORTED` response from the intentionally disabled server capability, not a failed profile query. Create Chore now recognizes that exact response (and the existing404 compatibility response) as unavailable optional functionality. Normal account assignment no longer gets a false retry warning. A selected profile still has no valid target, remains save-blocked and retains the warning; unrelated409s and server failures still show recovery. No server gate or production setting was enabled.

Meals uses44px accessible previous/next arrow buttons around Current week. All three now occupy one row on390px phone, moving the first meal card from approximately410px to360px. Date navigation, boundary disabling and translated accessible labels are preserved.

Verification:75 focused chore/profile and meals tests passed; affected-file lint zero errors with one existing hook warning; production build passed. Real local fixture API verified the exact409 capability response. Browser check passed3 sign-ins plus phone/desktop journeys for warning absence, account selection, single-row controls and forward/back week navigation. Initial browser check used the wrong query parameter (`week`); corrected to the existing `start` contract and reran successfully. Phone chore and Meals screenshots inspected at `/tmp/profile-controls/phone-390x844/`. Temporary browser check preserved at `/tmp/profile-controls-check.spec.ts`. No production changes.

## Today and Calendar workflow simplification

Today controls now contains only board customization (where supplied) and refresh/offline guidance. Removed duplicate Explore, Groceries, Lists, Meals, feature settings and personal settings shortcuts from this menu; their canonical tabs, Explore hub, cards and account menu remain. Add or ask and its role/feature gates are unchanged.

For calendar editors below900px, the existing Calendars menu is now the single source/connection entry, replacing the duplicate collapsible source pane. Desktop keeps its source sidebar; non-editing members keep their existing source selector and do not gain settings links. On phones the menu label shortens visually to Calendars, retaining the full accessible name, so Calendars and Add event fit on one row. Source loading/error/retry feedback moved outside the collapsible source pane into the main area, so a hidden pane cannot hide recovery.

Verification:41 focused unit/component tests passed; affected-file ESLint zero errors; production build passed. Browser run passed3 sign-ins plus6 phone/desktop parent/teen and Today journeys: event details, source filtering, no event writes, customization close/Escape/focus restoration, and overlap-region axe checks. Fresh parent phone Calendar and Today-menu captures inspected at `/tmp/flows-output/` and `/tmp/today-hierarchy-phone-390x844-controls.png`. Existing browser tests updated for the canonical source-menu path. No production deployment or native acceptance claimed. Broader header density and other audit findings remain open.
