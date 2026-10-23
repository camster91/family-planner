# Calendar connections and contextual form source reconciliation

Original #456 and #455 (including consolidated #453), under #128/#499.
Source inventory: 2026-10-20. This maps implementation and authored acceptance
sources; it is not a claim that runtime, rendered or native checks passed.

## #456: Calendar connections

| Original requirement | Current source | Remaining evidence |
| --- | --- | --- |
| Compact parent-only menu beside sources | `CalendarPlanner.tsx` mounts a native details disclosure within sources only for `canEditEvents`; `calendar/page.tsx` derives that prop from `isParentRole` | Existing teen/planner-localization cases; actual authenticated routes deferred |
| Google/Outlook when configured; calendar-link subscription shortcut | Configured sync exposes `/dashboard/settings#calendar-sync`; subscriptions always use `/dashboard/settings#calendar-subscriptions`. Disabled-provider help explains the boundary | `planning-localization.test.tsx` role/configuration/EN/ES cases; provider acceptance remains separate |
| Settings opens/scrolls target after profile load | `SettingsClient.tsx` reselects target group on loading/hash changes, opens ancestor disclosures and scrolls after rendering; SettingsDisclosure also handles delayed mounting/hash changes | `settings/__tests__/disclosure-anchor.test.tsx` and calendar-sync/localization source; actual delayed-profile full route deferred |
| EN/ES, native keyboard, 44px, theme/reflow | Typed planner copy; native summary; `calendar-planner.module.css` uses semantic surfaces/text, min-height 44px, focus outlines and wrapping | Existing localization source; keyboard/touch, actual six viewports, dark/light and long-text checks deferred |
| No new provider/token/API/permission path | Menu contains canonical Settings links only. Existing Settings/API configuration and parent checks remain | Full canonical setup/API/provider acceptance still required; owner/provider account dependencies remain #369 |

Rollback removes shortcuts/anchor handling while retaining canonical Settings
setup. This source inventory changes no OAuth app, secrets, grants, endpoints,
provider configuration or production state.

## #455: Route-backed list/chore overlays and consolidated #453

| Original requirement | Current source | Remaining evidence |
| --- | --- | --- |
| Canonical forms/APIs, roles, prefills/uploads/save | DashboardFormSheets embeds existing CreateListForm/CreateChoreForm/EditChoreForm with `inSheet` and busy callbacks. Intercepted list route passes canonical create capability and type filter; chore edit retains reviewed routine-schedule handoff | Existing form-sheets/list/chore/role/upload and scheduled-handoff cases; full route journeys deferred |
| In-app background + rounded phone/desktop sheet; standalone reload | Dashboard parallel `@forms` interception routes render FormSheet; original routes remain. Dialog form variant supplies rounded bottom/desktop panel, fixed heading and scrollable body | Existing wrapper/actual-form source; authenticated Next interception/direct-link/reload and viewport proof deferred |
| Close/Escape/Back reset drafts; pending dismissal blocked | FormSheet returns through history; pending controller holds same-document Back with owned sentinel. Busy removes explicit close/Escape. Canonical success paths await navigation release; drafts remain local to mounted forms | `form-sheets.test.tsx`, `pending-form-navigation.test.tsx` and actual-form source; real browser/native/process lifecycle deferred |
| Focus, inert background, scroll restoration, visible close/safe area | Shared Dialog owns focus and stacked-modal handling; FormSheet restores prior background inert/body overflow; form variant has fixed 44px close and safe-area body/footer sizing | Existing focus/stacked/busy source; actual keyboard, reflow, screen-reader and device execution deferred |
| Stale overlays clear | `@forms/default.tsx`, slot page and `[...rest]/page.tsx` return null; layout renders separate background/slot | Actual cross-route/Back/forward/reload acceptance remains required |
| Essential fields stay visible; optional details/picture/routine/photo remain mounted | Chore forms keep title/assignee/schedule first and use ChoreFormSection disclosures. Frequency precedes applicable date/weekday inputs. Summaries reflect current choices; invalid capture opens its section without unmounting fields | `chore-form-section.test.tsx`, chore form/picture/weekly/monthly source; actual optional-value/upload persistence and role/series acceptance deferred |
| Local same-day/weekly policy, canonical permissions and history stay | Existing schedule helpers, WeeklyDaysPicker, form/API guards and canonical recurrence remain; no wizard or new submission model | Existing weekday/same-day/recurrence/profile source; full integrated acceptance deferred |

Source reconciliation found English-only chore sheet chrome around already
localized form fields. New/Edit Chore wrappers now share a small ChoreSheet helper
using existing title keys and new typed EN/ES close/draft/pending-save-upload keys.
Canonical form identities, props, busy handling and API paths remain unchanged.
`chore-form-sheets-localization.test.tsx` is authored specifically for localized
wrapper/busy behavior; its mocked forms do not establish submission/upload proof.

No tests, types, lint, build, browser/native/schema operations or CI were run.
No push, merge, deployment or activation occurred. Rollback removes route slot/
wrappers and optional disclosures, preserving standalone pages/APIs. Other sheets
and source candidates remain governed by their own issues. No acceptance is
inferred for the whole 22-feature program from these maps.
