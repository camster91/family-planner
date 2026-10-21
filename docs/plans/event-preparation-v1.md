# Event preparation — #123 implementation contract

Approved full journey: reusable event-linked packing/forms/departure checklists,
using canonical tasks/routines and showing the relationship, without a competing
completion/assignment store. Planning/implementation scope is approved; this does
not authorize activation, live mutations, providers or release.

## Canonical meaning

- Event remains the calendar source. Chore remains the task, assignment, due-day,
  completion/check/photo/points source. RoutineStack remains the reusable routine
  identity. No EventPreparationTask, copied checkmarks or alternate role model.
- One optional EventPreparation plan orders links to concrete canonical Chore
  occurrences. A concrete chore belongs to at most one event preparation plan,
  preventing one accidental checkmark from preparing unrelated events. Reuse a
  routine to create distinct one-off chores for a new event instead.
- Parent can link existing tasks, add explicit new once-only tasks, detach and
  reorder links, or use selected steps from one exact dated routine occurrence.
  Source selection binds stack/occurrence/step IDs and fresh source versions,
  not labels. Copy source content only; new work starts pending with no photo,
  completion, parent check, recurrence expansion or historical credit. Do not
  change the source routine or its future definition.
- Existing task linking never reassigns/completes/verifies/deletes it. Detaching
  and deleting an event remove links, not chores. Existing canonical chore
  deletion cascades the link. Shared/recurring task dates may not be quietly
  retimed; only explicitly eligible open standalone once-only chores can move.
- Optional cues choose event start/end, before/after and a bounded minute amount.
  They derive a proposed canonical due DAY in an explicit IANA zone, not a second
  due timestamp, reminder, scheduler or buffer calendar event. A cue must agree
  with the final chore day. Fixed/custom days use no active relative cue.
- Event edits never silently retime tasks or reset completion. A changed event
  needs an explicit decision: keep current days (remove mismatched active cues),
  or preview selected eligible date changes. Neither implies acceptance by an
  assignee. Normal chore completion/check APIs remain authoritative.
- Parent overview distinguishes open, marked-done/waiting-check and checked.
  Unavailable/hidden/capped tasks and changed-event timing cannot yield a whole-
  event readiness claim. A child's own progress is not the household's readiness.

## Permissions, storage and continuity

Person parent configures; selected profiles are subjects, never actors. Readers
follow existing calendar + chores and current role/feature/profile/age/link/
erasure/occurrence policy. Child/teen projection includes only their authorized
account task details; no other-person directory/private notes leak through an
event link. Parent profile reads/creation remain gated and labelled; no synthetic
email/login, inferred identity, reassignment or credit transfer. Paired-device
support must use its canonical scoped protocol, not person routes by fallback.

Additive EventPreparation + ordered EventPreparationStep tables carry only real
family-scoped Event/Chore FKs and cue metadata. No participant/description/status
JSON. Event/Family deletion cascades metadata, Chore deletion drops its link,
and moving a canonical record out of the family must detach the old association.
A delete/recreate or unlink/relink must invalidate pending work even with the
same visible IDs/content. Event insertion/material epochs from schedule review
are reused; a preparation lifecycle epoch closes plan absent/create/delete ABA.
Plan revision advances for additions/updates/review and step insertion/update;
external Chore cascades only delete links. Their changed membership is part of
the scope token, and recreating membership necessarily advances the plan. Do not
add a shared parent-row update to every legacy chore deletion: bulk canonical
writers must not acquire chore->plan->another-chore locks.

Use default-off preparation readiness and existing owned-recovery/rollback
contracts. Every consequential action binds original actor/family/event/source/
full-plan token, age, exact body/key, canonical task/routine sources and explicit
changes. Freshly lock/renew identities and source routine stacks before sorted
Chores, then Event, plan/links and receipt, matching canonical cascade direction.
Never acquire participant/stack locks late from linked rows. Mutations and minimal
receipts are atomic; takeover/replay does not duplicate chores or links. Raw
metadata/schema adapters must work without regenerating the shared client here.
No ordinary chore/Calendar API is replaced or bypassed.

## Required full flow / later code

1. Fresh bounded current Event/plan/task/routine/subject projection, caps, unknowns,
   before/after cue/day/source preview and current authority. Include unavailable
   linked rows honestly; do not silently drop them to manufacture completeness.
2. Short EN/ES rounded sheet: event header, existing task picker, new-step fields,
   reusable routine/dated occurrence picker, ordered step panel and cue/date
   disclosure. Show exact removed links separately from deleted chores (none).
   Preserve unsubmitted choices on failures and adapt to all device surfaces.
3. Parent preview/confirm through canonical Chore subject/content/date validation
   and routine-source reads. New rows use canonical once-only fields; hidden
   points become zero for new work, never copied/completed history. Explicit
   retiming refuses scheduled roots/occurrences or completed/verified work.
4. Exact owned journal stages before send; pending inspect/retry/forget, expiry,
   unknown acknowledgements, owner retirement, close-before-stage completion and
   stage-versus-dismissal repair follow the established coordination pattern.
   Historical proof is separate from fresh current task/event state.
5. Canonical calendar/Today/chores/routine/weekly discovery and backlinks. Normal
   task completion/check actions keep their existing authorization, idempotency,
   offline and profile gates; a preparation view is not an alternative writer.
6. Scope-safe exports, lifecycle/delete compatibility and pause-time recovery.
   Event/routine/template changes do not overwrite already-created task history.
   Existing/previous installed clients keep normal domains working during rollout.

Source checks/real later acceptance must cover two-household/role/device/profile
negatives, stale/foreign/unknown/erased subjects, source routine changes, task
completed after preview, no duplicate clone after timeout/takeover, due-day/zone/
DST cue calculations, event edits and kept-versus-retimed days, link cleanup and
away/back/recreated IDs, partial/capped summaries, exact receipts/storage/Back,
source deletion, all viewports/EN/ES/a11y and physical/native compatibility.

Current status: required contract, pure transition planning, reviewed-scope
fingerprints, additive schema/SQL lifecycle definitions, compatibility cleanup
and parent scoped export source are authored. Unit and disposable lifecycle
case source is authored and unrun. API/source loading/canonical mutation/receipts/
UI/integration/recovery remain code work, followed by the
consolidated QA pass. No provider, live data, schema/client/SQL/DB, tests/build/
browser/native/CI, activation or release evidence exists for this new workflow.
Do not close #123 or substitute a planner/link-only shortcut for the full journey.


## Canonical API/effect continuation — 2026-10-20

Authored `src/lib/event-preparation/{runtime,read-contract,source,state-store,
mutation,server,http,route,view,owner}.ts` and default-off API entry points:
GET/PATCH `/api/coordination/event-preparation` and POST its `/preview` child.
Initial GET reads linked work; selected-source POST refreshes exact chosen task,
subject and dated-routine scope. Command preview/write reconstruct that exact
scope server-side; arbitrary supplied view tokens are never server authority.
Refresh the final selection before preview/confirmation. No broad household
picker query is substituted for exact command source scope.

Person parent only. Current actor token/household/role/features renew inside the
transaction. Dependencies are collected before stable User/profile/stack/Chore/
Event/metadata locks and rechecked; source changes outside that locked set refuse
instead of acquiring late locks. Routine controls/inactive/unsupported work is
not actionable. Source copy content is validated from actual fields; display
truncation is not copy content. Unavailable task content/state and invalid routine
copy content are withheld. Current identity versions and exact link rows further
bind the review, separately from content/material and status/proof source epochs.

Additive Chore preparation epoch/trigger source catches completion/proof changes
including complete/undo; it does not alter existing responsibility consent epoch
meaning. Schema probe requires those columns/triggers plus existing material and
identity-retirement dependencies. No schema operation or client generation ran.

The effect uses canonical fresh once-only Chores, scoped date updates and ordered
metadata; no duplicate completion/points model. Empty intended set removes plan
metadata. Same transaction stores minimal exact proof (IDs/digests, no descriptions
or private content). Matching complete claim replay does not reread target or
clone work. This is not yet the full owned recovery journey: UI/context/journal/
inspection, strict client DTO schema, pickers and canonical discovery remain next.

Request bound is 1 MiB so 99 full canonical steps are supported, including escaped
content. Recovery must bound exact bodies/storage explicitly and handle quota
failures before any send. Do not copy the smaller schedule-review body limit or
silently truncate a preparation request to make it fit.

Runtime/source/effect/receipt/projection case source is authored and unrun. No API
request, SQL/DB/migration, tests/types/lint/build/browser/native/CI or activation/
release has been executed. Full feature and #123 stay open pending remaining code
and later consolidated QA.
