# Feature depth and connected workflows — 2026-11-02

## Conclusion

Herewoven already has broad feature coverage and substantial domain code. The
best next investment is finishing reliable connections between those features,
making the normal actions easier to find, and simplifying the language around
setup and recovery. Adding more feature categories would not address the main
friction found in this review.

The strongest opportunity is one continuous food workflow: **recipe → meal or
multi-dish prep → missing groceries → cooking → portions eaten/remaining → next
prep**. A second is **family member → recurring chores/routine → completion →
review/reward**, including people without email. Both have considerable existing
source to reuse. The assistant can help with these jobs, but its current action
contract is much narrower than “do anything in the app.”

## What was actually reviewed

- Current merged source: `8be63c3159b0c7f48484a03ddd1490460f30c4a4`, merge of
  [PR #618](https://github.com/camster91/family-planner/pull/618). Its tree matches
  tested source `f3fe2b9eb07de1c5c134d1dde1ba855a7e688496`.
- Feature registry, role gates, assistant action contract, representative domain
  APIs/models, current issue directory and existing selected design/feature plans.
- Actual compiled Cloudflare runtime from that source, with a disposable D1/R2
  environment and a fabricated parent household. All 22 family feature flags were
  enabled. Platform/provider gates were not all enabled; external egress, email
  and AI provider calls were disabled. Profile setup was enabled only for this
  isolated fixture.
- 26 entry-route samples at 800×1280: all returned HTTP 200 and none had horizontal
  document overflow. Selected phone views at 390×844 were also inspected, including
  the quick-add sheet and settled meal/prep/recipe views. This proves those sampled
  renderings, not successful mutations across every feature.
- Production `/api/health` returned 200 with source `3671b3bc111ddfcc1428ab292a049b2cce9e398c`.
  **The debloat merge has not been deployed.** No live family records were changed.

This was a feature-depth and workflow review, not a complete code/security audit,
physical-device assessment, populated-family usability study or full release QA.
No completeness score is assigned: source breadth is not the same as usable depth.
The initial snapshots included loading states; focused later reads confirmed that
the bulk-prep recovery check and inventory refresh settled. They are not reported
as stuck-loading bugs.

Local observations and screenshots are retained in the worktree parent's
`artifacts/feature-review-20261102/`, including `observations.json` and
`focused-observations.json`.

## Feature depth and what families should be able to finish

“Source present” below means inspected implementation, not universal production
acceptance. Expected depth is the end-to-end target; it must not be read as a list
of entirely missing features.

| Area | Current depth / evidence | Expected complete job and next focus |
| --- | --- | --- |
| Family and roles | Account members, invitations, email-free profiles, linking and personal/shared authority have source. Local Family exposed both Invite member and Add a household profile. | Add every household person once; use a login or shared screen as appropriate; retain assignments/history through linking. Finish lifecycle and profile parity under #480. |
| Today, Explore and customization | The sampled all-on Today still showed schedule, chores, dinner and groceries rather than 22 cards. Feature discovery and board controls already exist. | Keep the next useful action visible; remember chosen sections/order; send each card to its exact task/date. Preserve the calm all-on behavior rather than expanding the navigation. |
| Calendar and saved locations | Day/week/month/agenda, duration controls, event editing, source controls, ICS and gated provider connections have source. | Create/edit once or a series, understand ownership and sync state, prepare for an event and coordinate a pickup. Audit native recurring-event authoring separately from imported recurrence/repair; verify each provider's read/write behavior under #124. |
| Chores and routines | Weekly weekday selection, monthly scheduling, series grouping, rotation, picture steps, occurrence stacks and durable schedule contracts exist. Some schedule paths require explicit runtime flags. | One setup produces actionable occurrences; adults and children can follow a stack; changes distinguish one occurrence from future work. Complete identity/credit parity, lifecycle and recovery under #450/#480 rather than rebuilding scheduling. |
| Recipes and meal planning | Search/import, JSON-LD parsing, manual recipes, favorites, collections, recipe reuse, serving controls and cooking views exist. Discovery currently targets BBC Good Food, Allrecipes and Serious Eats; it is not universal web search. | Find → review → save → plan → cook/reuse, with attribution and day/serving context intact. Explain partial imports, missing data and unavailable publishers; validate the complete journey under #460. |
| Multi-dish bulk cooking | Native D1 code creates sessions, dishes, meal allocations and consumption. It records preparation, storage choice, next-prep date, recipe snapshots and remaining portions. The settled local Prep screen offered Plan a prep session. | Plan several dishes together, consolidate needs, prepare, allocate, record eaten portions and know what remains/when to prep next. Reuse these records; simplify transitions and verify counts instead of adding another batch model. |
| Food inventory and scans | Canonical stock, location/date tracking, adjustments, recipe matching, barcode/photo/receipt review and restocking paths exist. Product lookup and AI have separate eligibility/configuration gates. | Capture → correct uncertain fields → store → consume/discard → restock/cook. Ingredient matching is not proof of quantity sufficiency; review units/lots. Keep manual entry useful without external services. #125/#144/#135. |
| Shared/custom lists and groceries | Multiple list types, item operations, recipe-to-grocery paths, grocery-only destination and recovery are present. | Quick add/check, reusable lists, appropriate grouping and a clear shopping trip; preserve the originating recipe/task. Do not create duplicate lists or silently combine incompatible quantities. |
| Points, rewards and analytics | Chore points, claims/approval and progress summaries exist. Rendered Progress explicitly limits per-person totals to login members over 90 days. | Explain what earned a reward and what needs review; support consistent email-free participation before suggesting full parity. Consolidate repeated progress summaries; keep gamification optional. |
| Budget and allowance | Expense/category and allowance/IOU records, personal restrictions and mutation controls exist. | Record once, see the relevant balance/category and mark an allowance payment clearly. Keep this as tracking unless financial integrations are separately adopted; avoid making money movement or bank-sync promises. |
| Projects and travel | Project/task/calendar linkage and travel settings/affected-chores logic exist. | See the next project task; reuse packing/planning work; understand exactly which travel-period chores change and what resumes. Connect context without turning the app into a full project-management suite. |
| Notes and messages | Pinned notes, private household message flows and attachments exist. Calling has deliberately been removed. | Create or reply beside the relevant family task, then return to it. Explain audiences and prevent private messages/notes leaking onto shared screens. |
| Birthdays and wishlist | Family-date records and wish tracking have their own surfaces. | Upcoming occasion → relevant wish/preparation/list, respecting child visibility and surprise/private choices. Avoid asking people to recreate the same information elsewhere. |
| Pickups and handoffs | Pickup assignments/completion and sitter briefing/share controls exist. | Event/person/place → clear pickup responsibility → completion, or a deliberately shared handoff. Avoid implied acceptance or automatic external sharing. |
| Emergency and sick days | Emergency records, illness and medication logging exist with distinct role restrictions. | Find the right authorized information quickly and record what happened. Keep private medical details off shared surfaces; offer organizational help without diagnosis/dose inference. |
| Assistant and capture | Typed actions support selected event/chore/list/note creation, grocery addition, three deletion categories and navigation. One proposed action per reply; meal/prep requests can hand off to canonical planners. Today grounding, confirmations and other advanced paths have separate gates. | Help → open the right place → prefill → review → save → recover/undo, with exact supported actions. Compound work should become a reviewed set of canonical actions, not unrestricted AI access. #464/#144. |
| Review, notifications and weekly planning | Review exposes parent checks, preparation timing, saved requests, capture and changes. Notification snooze/preferences and weekly-reset source exist; weekly reset has an explicit readiness gate. | One decision appears in one useful place; notifications open its exact record; snooze/quiet hours work consistently. Finish delivery/provider/recovery acceptance before promising proactive or background help. #141/#470. |
| Device, account and offline experience | Web plus native-shell/shared-device code, pairing, personal settings and recovery foundations exist. | Appropriate views for phone, personal tablet and shared fridge; reliable account/session entry; no lost work on interrupted networks. Native builds do not prove store distribution, real cameras, locked-screen behavior or physical-device acceptance. #138/#473/#135. |

Key source anchors: [feature registry](../../src/lib/features.ts),
[role routing](../../src/lib/kid-access.ts),
[assistant actions](../../src/lib/assistant-actions.ts),
[recipe discovery API](../../src/app/api/recipes/discover/route.ts),
[recipe parser](../../src/lib/recipe-discovery.ts),
[bulk cooking storage](../../src/lib/cloudflare/meal-bulk.ts),
[routine schedule contract](../../src/lib/routine-schedule.ts),
[weekly reset gate](../../src/lib/weekly-reset.ts),
[review inbox](../../src/components/review/ReviewInbox.tsx).

## Concrete findings to act on

1. **Existing browser failures are still unresolved.** The debloat candidate had
   36 distinct failed browser cases; 35 also failed on its base main. The additional
   Rewards case tried to retrieve a response after navigation. Required build/test
   and affected checks passed, but this is not an all-green product. Calendar
   state/rendering, mobile reflow, JS budgets and several save/recovery journeys
   need triage under #137/#499/#145. Do not label every failure a product bug or
   every repeated failure a harmless test problem. [Merge assessment](https://github.com/camster91/family-planner/pull/618#issuecomment-6583529489).
2. **Calendar spreads setup and navigation over several rows.** At 800×1280,
   connections/add-event actions, the source disclosure, refresh status and
   date navigation preceded the grid; its header began around 450px down.
   The source-filter disclosure and connection-management action have different
   purposes, but need clearer grouping. Reduce control height while preserving
   direct common actions; do not just hide everything in a menu. #499.
3. **Progress repeats a heading and explanation and nests main landmarks.**
   Two “Progress by person” areas repeat the same scope caveat. The page's
   `<main>` is inside the dashboard `<main>`; the rendered DOM counted two.
   Consolidate the information and use one main landmark. Evidence:
   [analytics page](../../src/app/dashboard/analytics/page.tsx) and
   `tablet-analytics.png`. #499.
4. **Quick add is a good fallback, but should not mediate every action.** The
   all-on phone sheet offers eight choices. From Today, one tap opens it and a
   second selects assistant/task. Preserve direct actions such as Plan dinner;
   use known context to avoid repeating the choice menu inside a feature. This
   is an observed entry cost, not a measured completion-time benchmark. #499/#464.
5. **Recovery and setup language can dominate the task.** Recipe Explore gives
   saved-work recovery prominent space, while the review inbox explains multiple
   implementation boundaries. Show relevant pending work with a clear next action;
   reveal detailed explanations on demand. Keep unknown-save protections. A brief
   observed “Checking private recovery” state cleared normally and is not a defect.
6. **Feature availability and AI reach need a truthful map.** Family feature flags
   are separate from deployment/provider readiness. Meal/prep/routine source does
   not mean the assistant can perform those writes. Surface a useful manual path
   when a service is unavailable and expand contextual actions incrementally.
   [Food planning gate](../../src/lib/food-planning/server.ts),
   [food AI gate](../../src/lib/food-planning/ai-gates.ts),
   [product lookup gate](../../src/lib/food-product-provider.ts). #464/#144/#125.

## What competing products establish as expectations

Cozi presents shared schedules, customizable lists, saved recipes and a direct
recipe-to-grocery workflow as core family organization. That supports prioritizing
easy transitions between familiar tasks. [Cozi feature overview](https://www.cozi.com/feature-overview/).

Skylight documents extracting events/lists/recipes from images, documents or
speech, and planning meals from saved recipes/preferences. Herewoven should
evaluate the complete capture-to-use journey, rather than count an upload or
chat panel alone as equivalent. [Skylight Sidekick](https://skylight.zendesk.com/hc/en-us/articles/39335273393947-Skylight-Sidekick).

Cozyla's published release notes describe a unified assistant entry, batch actions,
meal copying/moving, grocery grouping and parental controls. These suggest useful
comparison tasks for Herewoven's batch planning and shared-device experience.
[Cozyla release notes](https://ca.cozyla.com/pages/release-notes).

These are vendor-documented capabilities, read November 2, 2026, not hands-on
competitor evaluations or promises of feature/platform/price parity. The proposed
priorities are our inference from that evidence and Herewoven's source/renderings.

## Recommended next work

1. Triage existing save/recovery, calendar and reflow failures; fix confirmed
   user-facing defects first. Include the concrete Progress landmark/control fixes.
2. Finish one food journey end to end using current meal/recipe/inventory/prep
   contracts. Measure repeated inputs, navigation and clear read-back after saves.
3. Finish chores/routine/profile parity and preserve history through lifecycle
   changes. Give each role a clear next action.
4. Add contextual helper actions around those proven flows; then extend the same
   pattern to the remaining optional features. Keep direct controls available.
5. Validate provider/native capabilities in their actual environments before
   presenting them as available. Keep production releases separately authorized.

The [reusable implementation prompt](CONNECTED_EXPERIENCE_PROMPT.md) specifies
these behaviors across all features, includes measurable interaction targets,
and asks for complete bounded implementation rather than another open-ended plan.
The existing #499/#464/#460/#450/#480 and platform issues remain the canonical
backlog; this review does not open duplicate feature issues or change production.
