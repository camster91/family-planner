# Private product measurement and learning

2026-10-20, #140/#128; source design and reporting correction, not activation or
QA evidence. Existing D-6 count rules stay intact. No new collector, database
model, provider, scheduled job or tracking permission is introduced.

## Current collection and stable schema

`src/lib/beta-metrics.ts` is the sole writer of `BetaMetricDaily`: household
foreign key, UTC Date day, fixed metric name and integer count, unique by
household/day/metric. There is no user/profile/role/device ID, free-form text,
route, arbitrary property bag or precise event timestamp. The existing server
recorders are opt-in through `Family.beta_metrics_enabled` (default off). A
parent toggles through `/api/family/beta-metrics`; turning it off deletes counts
under the same household lock. Retention is 13 calendar months, pruning on
recording and household cascade deletion, not a new scheduler.

This storage vocabulary is version 1, retaining existing names for compatibility:

| Stored metric | Domain owner / meaning | Replay/loss boundary |
| --- | --- | --- |
| member_joined | Family/auth; a persisted joined member | Counts the domain join outcome, not a page load or invite sent. Does not prove participant independence, youth identity or actual participation |
| event_created | Personal event-create effect; committed event | `person-event-create.ts` records only when its transaction created a row; receipt replay does not count again |
| meal_planned | Meals create effect / compatible legacy route | Keyed `meals/create` uses createdNow, not receipt replay. Legacy unkeyed creation counts actual created rows; duplicate user actions may still be distinct domain records |
| chore_assigned | Chore-create; assignment creation | Counts creation, not visible task rows or reads. Cannot be summed as unique people or recurring occurrences without inspecting the canonical domain |
| chore_completed | Chore-complete effect | Records only a transition that actually completed; a repeated read/replay is not another completion. A later valid undo/re-completion is a new action |
| chore_verified | Parent approval | Transition counter, not independent proof of an ordered same-record family loop |
| reward_claimed | Reward claim effect | Canonical claim effect guards the recording; receipt replay does not repeat it |
| first_chore_within_10m / first_chore_after_10m | Chore assignment: first real chore vs earliest family-member registration | One household bucket guarded by existing first-chore/bucket checks. Late opt-in is not backfilled. Household-membership changes and ties require later fixture acceptance |

Counters record after a domain commit on a best-effort path: a crash/failed
metric write after the committed action can lose a count. Do not describe this
as exactly-once or complete event history. There is no client event ingest to
replay from browser tabs/offline storage and no raw-event reconstruction. The
unique daily key prevents duplicate aggregate rows, not duplicate source
operations by itself. Keyed domain receipts/transition checks provide the
replay controls above. Do not retry missing analytics by replaying a domain
write or scan private household content to fill gaps.

Unknown names are rejected/no-op by the recorder. Renaming/retiring a metric
requires a new documented vocabulary/report version and a compatibility reader;
never repurpose an existing count to mean a different action. Domain owners own
the emission point; product owner owns interpretation. Retirement stops the
writer, retains old-version interpretation until retention expires and updates
policy/tests/disclosure before any replacement is enabled.

`POST /api/analytics/event` is a legacy compatibility sink: no page views,
paths or metadata are stored. Do not restore its old metadata collection. Route
telemetry is a separate optional fixed-template latency/status stream; it has
no household/session identifier. Native recovery diagnostics stay local/manual
under their existing contract. The optional PostHog dependency/configuration is
not activated by this issue; setting a build key still requires separate
processor/privacy/configuration review.

## What can actually be measured

`src/lib/beta-scorecard.ts` and `scripts/beta-scorecard.mjs` read opted-in daily
counts in a guarded read-only transaction. Database-local household numbering
avoids exporting IDs/names; numbers are run-local, not durable cohort IDs. No
live scorecard or database was read in this implementation pass.

The additive report contract `herewoven.beta-count-scorecard.v1` explicitly
marks `statusesEvaluate: count-thresholds-only`, `completeness: best-effort`,
`orderedJourneyVerified: false`, `independentCohortVerified: false`, and
`acceptance: not-evaluated`. Existing PASS/FAIL/INSUFFICIENT DATA values remain
D-6 count-threshold results. Text output carries the same boundary. Weekly
counts prove that steps were counted in a week, not that one linked chore,
reward and participant completed them in order. Original beta acceptance still
requires reviewed independent household/consent/ordered-journey evidence.

| #140 requested measure | Current evidence | Availability / next design dependency |
| --- | --- | --- |
| Activation / time to first value | Member-join, assignment and first-chore bucket signals | D-6 count proxies available. Exact funnel from install/sign-up/first member/useful dashboard and independence are not collected; do not invent denominators |
| First event/meal/task | Committed action counts | Action totals available, not per-member first-action time. First grocery is not collected |
| Weekly active households | Some opted-in households have domain counts | Report as households with recorded actions only. Browsing-only active users and opt-out households are unknown |
| Tablet days active | No per-device/day collection | Not collected; local diagnostics do not create fleet analytics |
| Member participation | Counts have no member/role identifier | Not collected; do not derive by reading child names, messages or chore ownership into analytics |
| Weekly core-loop completion | All-step weekly count proxy | Ordered, linked-record journey needs separate observed beta evidence; proxy is not acceptance |
| Grocery / meal / inventory weekly use | meal_planned counts only | Report meal action counts only. Grocery/inventory interactions require separately reviewed fixed counters, not a generic click SDK |
| Return D1/D7/D28 | No enrollment/return event history | Not collected. Late opt-in, household creation and rolling counts cannot manufacture a retention cohort |
| AI suggestion acceptance | No production analytics outcome denominator | Not collected. Private prompts, model replies and food notes are prohibited; a future bounded accepted/refused counter needs its own consent/design |
| Offline mutation success | Existing local recovery diagnostics and domain records | No fleet numerator/denominator; a retried request or local queue length is not a success rate |
| Crash-free sessions | No session/crash denominator | Not collected; route 5xx or successful requests cannot stand in for session crash rate |
| Play uninstall / user-loss | No store data imported | External store evidence, separately authorized; lack of an action is not proof of uninstall |

Never show an uncollected value as zero, estimate an install funnel from daily
counts, or treat opted-in households as all households. A dashboard/report must
carry window, timezone, vocabulary version, source, completeness, numerator,
known denominator and unknown/opt-out coverage. Divide only with a defined
nonzero denominator; suppress under-sized cohorts rather than expose individual
household behavior. No new metric dashboard is mounted or advertised here.

## Future events and funnels: explicit design before collection

If approved later, each new domain counter must declare a versioned fixed name,
server-owned emission point, original-operation replay key/transition guard,
allowed finite outcome enum, UTC day, aggregation grain, purpose, denominator,
retention, opt-in and erasure behavior. No arbitrary client event names or
metadata. Keys for short-lived deduplication must be non-exported and purpose
scoped; durable household daily aggregates cannot secretly become a member
tracking stream. Atomic metric/outbox recording would require its own reviewed
schema/transaction/retention design; do not quietly expand collection to repair
best-effort loss.

The requested funnels remain hypotheses with explicit missing stages:

- Install → signup → household → first member → first useful action: installation,
  sign-up denominator and dashboard usefulness are not present in the counts.
- Tablet pair → first board → 7-day use: pairing audit is operational private
  history, not permission to build a device analytics cohort.
- Meal → missing ingredients → groceries → completion: a meal count does not
  correlate these records or prove a purchase/completion.
- Inventory → use-soon → consumed/planned: visible suggestions are not consumption;
  any later counters must use canonical reviewed inventory effects.
- Notification → deep link → action: no click correlation exists. Notification
  content, exact route IDs and child activity must not enter tracking.

## Research and experimentation operating loop

Use the existing private feedback entry (#464) with user-authored reports and
`docs/product/BETA_OPERATIONS.md` interview/scorecard packet (#107/#108). Reports
remain support content under their access/retention rules, not analytics event
metadata. Triage to confusion, defect, reliability, accessibility, requested
feature or external dependency; no automatic public issue or client message.

Monthly review record: evidence date/window/version and consent scope; count
signal plus completeness; qualitative observation count; suspected friction;
proposed bounded change; owner; success metric/guardrail; rollback/stop rule;
next review. Link a roadmap decision to this record. Mark assumptions and
unmeasurable claims explicitly. Do not paste private report text/child details
into a public measurement report.

An experiment needs a written hypothesis, target metric with available baseline
and denominator, independent cohort eligibility/consent, feature flag/default,
start/end, minimum useful evidence, owner, rollback and stop condition. Stop for
privacy/isolation regression, rising unresolved writes, degraded accessibility
or increased task friction. No dark-pattern engagement loops. Child/teen/shared
surface experimentation requires explicit product/privacy review first; the
existing household beta-count toggle alone is not consent to an experiment.
No experiment is enrolled or activated by this plan.

## Acceptance state and remaining ownership

Source now documents exact existing schema/prohibited fields, stable event
owners/replay limits, every requested metric/funnel and missing denominator,
experiment policy and research cadence. Scorecard JSON/text no longer implies
ordered/cohort acceptance. Added source tests assert that passing count rules
still carry unverified acceptance. Existing beta-metrics/scorecard tests support
development/review fixtures; none were run in this implementation-only pass.

Remaining #140 production expansion is deliberately design/consent dependent,
not silently completed. Before any new collection: reconcile public privacy /
Settings/Data inventory, reviewed schema and erasure, validate isolated
retry/concurrency/opt-out/retention/no-content fixtures, review report reidentification
risk, obtain required activation authority and then consolidated QA. Current
Privacy and beta-count disclosures remain accurate because collection is unchanged.
Codex owns source/design/prepared verification; Cameron owns additional tracking,
processor/experiment activation and real-household research decisions. Existing
count recorder and collection defaults remain unchanged.
