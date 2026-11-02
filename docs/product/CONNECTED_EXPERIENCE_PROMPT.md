# Herewoven: connected, helpful, simple — reusable implementation prompt

Copy the prompt below into an implementation session. It defines a product target,
not a claim that the current app has achieved it. Read the dated feature review
beside this file, then refresh its evidence against the actual checkout.

---

Improve the existing **herewoven** family planner so a busy family can understand
what matters, complete everyday tasks with little effort, and get useful help
without learning a complicated system. Preserve all retained features. Keep
calling removed. Keep the lowercase wordmark and uppercase logo.

The goal is **less work for the family**, measured by successful tasks, fewer
decisions, less typing, fewer unnecessary taps and screens, and clear recovery.
An extra button that saves a trip through a menu can be better than hiding it.
Do not treat fewer visible controls or more AI responses as success by themselves.

## Start from the real product

Read the repository instructions, current source, selected “Glance and act” design,
active GitHub issues, and current release evidence. Inspect the app with isolated
fabricated households. Preserve unrelated changes. Distinguish these states for
each capability: implemented source, connected UI, configuration-dependent,
verified locally, verified on production, or missing. A feature toggle, endpoint,
passing unit test or closed issue alone does not prove the whole journey works.

Create one compact feature-and-journey matrix. Cover all existing feature keys,
plus onboarding, Today, assistant/capture, review inbox, notifications, search,
settings, offline recovery and shared-device/native behavior. For each, record
who uses it, the job they want finished, the canonical records/API, current
friction, useful next action, and evidence still needed. Reuse existing issues;
do not restart the roadmap or create a duplicate planning system.

Choose a finite set of the highest-impact gaps for the next release and set a
goal with observable acceptance criteria. Prioritize broken saves and access,
daily-use friction, disconnected flows, and then useful missing depth. Implement
in small complete slices; do not spend the whole task writing plans or adding
unrelated features. Preserve current architecture and reusable components.

## How the experience should feel

- **Glance, act, continue.** Today answers what is next, who is responsible,
  what needs attention, what is for dinner, and what needs buying. Show relevant
  summaries and direct actions, with an easy route to the full feature.
- Keep primary navigation stable even when every feature is enabled. Use Explore
  for the full catalog, favorites for frequent destinations, and contextual links
  for related work. Enabled does not mean every feature needs a permanent card.
- Give each task area one clear primary action. Place common actions beside the
  relevant item; disclose occasional options without burying everyday work.
- Open contextual editors in appropriately sized sheets/dialogs. Preserve the
  current day, person, list, recipe and return location. Back returns to where
  the user started. Focus returns correctly. Drafts survive reasonable navigation
  and recoverable errors; pending writes must never silently duplicate.
- Use sensible, visible, editable defaults from authorized current context. Ask
  only for information needed now. Remember explicit preferences. Explain unusual
  choices where they arise, rather than adding instructional paragraphs everywhere.
- Show household content early on phones. Let useful content use desktop/tablet
  space. Avoid squeezed navigation labels, excessive empty-state height, stacked
  control bars, nested scrolling and action bars covering fields. Longer content
  may scroll; do not force every page into one viewport.
- Preserve touch targets, keyboard access, screen-reader structure, contrast,
  large text, language/date/unit preferences and reduced motion. Use text labels
  where an icon alone is unclear.
- Display honest states: saving, saved, offline/pending, failed, or checking a
  previous save. Give a plain next action. Keep retry/receipt mechanics internal.
  Offer Undo for suitable reversible changes without pretending an uncertain
  request has failed or succeeded.

## Connect the features around complete family jobs

1. **Set up the household:** create family → add everyone, including children
   without email → choose roles → invite account holders or use a shared screen
   → complete a useful first task. A name-only profile is not a login or parent
   permission. Keep account linking and profile credit/history consistent.
2. **Manage the day:** event → responsible person → location/pickup → preparation
   checklist/reminder → completion or rescheduling. Support duration, clear local
   time, recurrence where implemented, source ownership and conflict handling.
   Explain read-only subscriptions versus editable connections accurately.
3. **Get chores and routines done:** create once → choose weekly days or a clear
   repeat rule → assign/rotate → group future occurrences → perform ordered
   routine steps → parent review where needed → history/rewards. Adults use
   routines too. Editing a series must make “this time” versus future changes
   clear and preserve completed history.
4. **Feed the household:** discover/import a recipe → review and save → favorite
   or collect → choose a meal/date/servings → add only the needed groceries →
   shop → cook → record use and leftovers → reuse the meal. Preserve source
   attribution, recipe versions and editable quantities. Do not infer reliable
   stock sufficiency from an ingredient name alone.
5. **Cook several dishes in one session:** select dishes → review portions and
   meals → consolidate groceries → prepare → allocate fridge/freezer portions
   → track eaten/remaining amounts → plan the next prep. Carry context throughout
   and keep manual meals usable. Avoid double consumption and over-allocation.
6. **Capture and use food inventory:** type, barcode, label/photo or receipt →
   review uncertain identification, quantity, location and dates → save to the
   same inventory → consume/discard/correct → restock or suggest a meal. Unsupported
   cameras/providers retain a useful manual path. Do not invent food-safety dates.
7. **Use lists and projects:** quickly add/check items → assign or group when
   useful → repeat/reuse → connect an item to a project, event, recipe or shopping
   trip when supported. Groceries links to actual grocery lists. Custom lists,
   packing lists and wishes remain easy to find and do not become duplicate stores.
8. **Coordinate family life:** connect birthdays, wishes, notes, messages,
   pickups, saved places, travel adjustments and sitter handoffs to the relevant
   day/person/task. Carry useful context into a message or handoff without sharing
   it automatically. Keep travel exceptions clear about what changes and resumes.
9. **Handle optional responsibilities:** rewards, points, progress, allowance,
   expenses and budgets should answer a useful question and expose the next
   permitted action. Keep money tracking distinct from moving money, and keep
   private information out of child and shared-screen views. Emergency and
   medication records support recording and reminders, not AI diagnosis or dosing.
10. **Close the loop:** notifications open the exact relevant record/action;
    review gathers actual decisions and unfinished work; snooze, quiet hours and
    weekly planning reduce noise. Do not make the user resolve the same task in
    several places or advertise background delivery that is not configured.

## Make help part of each task

Use one consistent assistant/capture entry and contextual help where it saves
work. A person should be able to ask “What should I do next?”, “How do I use this?”
or describe the task in normal language. Support tap-to-talk where available,
with typing and direct controls always usable. Do not promise always-listening
wake words or locked-screen behavior without platform support and acceptance.

Progress from explaining a feature, to opening the right place, to prefilling a
draft, to completing a reviewed canonical action. Tell the truth about the
supported level. Do not claim that opening a planner created the plan.

Ground suggestions in authorized, current household facts and explicit user
preferences. Show the reason for a suggestion briefly. Let the user edit, dismiss,
snooze or undo it; recurring dismissals should reduce repeated suggestions when
the user has opted into learning preferences. Use deterministic rules when enough;
use AI for interpretation or useful synthesis, not every checkbox or database read.

For compound requests, resolve authorized targets and show one understandable
review of the actual proposed changes. Reuse domain APIs and their permission,
conflict, idempotency and recovery behavior. Report partial completion truthfully.
Preserve deliberate confirmation for destructive, sensitive, external or ambiguous
actions. Never widen roles or expose private records to reduce a click count.
Private provider processing, costs and availability must remain explicit; keep
manual fallbacks. No silent invites, spending, external messages or medical advice.

## Measure and finish

Record a repeatable starting state and count navigation taps, decision steps,
required fields and completion time separately. Compare the same role, device
and task before/after. Aim for one direct action for a simple visible completion,
and one contextual transition to common editors. For a new or compound task,
minimize repeated input while retaining needed review. These are design targets,
not fabricated current measurements or a rule to hide necessary choices.

For each slice, deliver connected UI, canonical backend behavior, applicable
role/household isolation and recovery, and focused checks. Inspect the rendered
phone, tablet and desktop flow. Verify the changed journey with real disposable
data, including an error/retry and appropriate privacy case. Distinguish browser
emulation from physical-device acceptance. Do not repeatedly rerun unrelated suites
or call the app bug-free because it compiles.

Before changing significant flows, reuse the accepted mockups/design system and
make the smallest reviewable flow mockup required by repository instructions.
Do not create a second backend, generic AI write system, unnecessary framework,
new paid service, scheduled job or speculative feature to solve a local problem.
Keep provider activation, credentials, data deletion, deployment and native-store
publication within current explicit authorization. A prompt or merge is not
blanket production approval.

Finish with: the updated feature/connection matrix; the bounded release work
completed; before/after interaction evidence and screenshots; unresolved defects
or setup dependencies with their owners; focused validation results; and exact
merge/deployment status. Keep the user update short. Continue authorized execution
after planning instead of repeatedly asking whether to start.

---

Related dated assessment: [Feature depth and connections review](FEATURE_DEPTH_REVIEW_20261102.md).
