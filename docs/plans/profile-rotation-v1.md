# Stable-profile chore rotation proposal — #480 / #450

2026-10-25. Reviewable source-backed contract; implementation and activation are
unfinished. No new API, schema, flag, data mutation or role permission exists
because this document exists. No QA/test/build/browser/native/provider run.

## Current source and why it cannot be reused by changing IDs

- `chore-rotation.ts` validates `rotation_member_ids` through `db.user`, edits
  canonical future pending rows and preserves manual assignments/history. Its
  identity preflight now runs once per required canonical participant.
- `chore-rotation-shared.ts` defines2–8 ordered participants and deterministic
  turns. These pure turn rules can be reused; their string type is not authority
  to reinterpret account IDs as profile IDs.
- `recurringChores.ts` delegates any non-null `routine_series_config` to the
  canonical future-definition expander. Profile legacy recurrence explicitly
  refuses nonempty legacy rotations.
- `routine-schedule.ts` has strict `herewoven.routine-step-series.v1` root content
  and `herewoven.routine-schedule.v1` grouped definitions. Existing subjects are
  explicit account/profile kinds. Unknown definitions must hold, not fall back.
- `chore-profile-actions.ts` only recognizes the supported profile series rules;
  a rotating root whose current owner differs cannot simply pass that check.

Keep current account rotation operational and unchanged. New stable-profile
rotation requires a separate versioned contract, not a mixed string array,
synthetic User, email, name match or implicit conversion of accepted series.

## Proposed canonical definition

Extend the existing future-definition pipeline with reviewed v2 root/group
protocols. Reuse the root's canonical revision/CAS and existing household lock,
not a separate rotation scheduler or competing routine store. The proposed new
subject kind is an explicitly tagged rotation of2–8 distinct stable
`HouseholdMember` IDs from the same household. Include account-linked adults,
teens and children, and active email-free profiles, only through the canonical
member eligibility projection. Each is an assignee, never an actor credential.

The parent submits ordered stable IDs and exact reviewed root/group revision.
The server stores that definition only after re-reading all referenced members,
required account/link mappings and root/group ownership under the canonical
lifecycle locks. Reject foreign, duplicate, archived, erased, dormant, unknown or
contradictory references as one held command. Do not partially trim the roster or
silently replace someone with a parent. Selecting the same person through two
account/profile aliases cannot produce two turns.

No source schema is prescribed as already migrated. Before coding, settle the
exact additive v2 definition/occurrence fields in the existing migration and
export/erasure inventory. Legacy `rotation_member_ids` stays account-only; do not
write stable member IDs there or synthesize legacy mirror owners. Any explicit
conversion of an old series needs a complete preview and separate parent action.

## Generation, edits and history

1. Use canonical reviewed date-only recurrence, weekday selection and monthly
   anchor rules. A turn advances per actual scheduled occurrence, not per click,
   request, completion or generator retry. Enforce the existing root/date
   uniqueness and atomic effect receipt; an uncertain retry uses the same body,
   key and reviewed definition.
2. Resolve the selected stable member to its current permitted assignment pair
   immediately before effects. A verified account link may supply the permitted
   account alias; a profile without one remains explicitly profile-owned. A link
   change never grants the profile a session or silently transfers earned credit.
3. Preserve active order and skip ineligible participants only according to the
   reviewed existing rotation rule. If no participant is eligible, hold expansion
   with a parent-visible reason, without creating ghost/unassigned work, marking
   completion, advancing the checkpoint or inventing an account fallback.
4. Editing order/participants affects only eligible future pending occurrences.
   Preserve started, checked, completed, verified, historical and manually
   reassigned rows, canonical assignment identity, photos and action history.
   Store sufficient immutable occurrence coordinates (definition revision,
   planned slot and participant count) so historical rendering never interprets
   an old turn against the latest roster. Coordinates are not actor proof.
5. A manual one-occurrence reassignment follows the canonical scoped edit and
   loses automatic turn participation as today. Do not reshuffle other rows when
   someone is late, skips work or finishes it. Clearing rotation retains the
   current canonical assignee/history on existing occurrences.
6. Pause/resume/stop reuse existing future-series state/anchor behavior. Unlink,
   member archive and erasure must enumerate v2 definitions and references before
   mutation. Unsupported/oversized/partial inventories hold the whole action;
   the existing all-root unlink reader must not filter away unknown definitions.

## Short parent flow and restricted completion

Use the existing create/routine editor flow: Take turns opens a short ordered
member picker with visible account-free profiles,2–8 slots and44px Move up/down
and Remove controls. Drag is optional. Review selected weekdays, first turn and
scope before saving. Keep the exact draft on unknown/conflict. Show next person's
name only through an authorized projection; names and colours are not identity.

Children/teens keep their own permitted completion surface. Shared profile
selection remains attribution and existing parent-review policy, never proof of
login or parent authority; paired/shared DTOs keep current private/reward/finance
exclusions. Parent edits remain parent-only at direct API level. All surfaces use
one canonical completion/Undo path, not a scanner/rotation-specific credit path.

## Credit, retention and rollout decisions still pending

Cameron has been asked whether newly earned chore points/reward balances belong
to the stable family profile across account links, or are available only after a
login is linked. No answer or transfer policy is inferred. Historical User XP,
existing receipts/awards, profile-earned credit and owned Undo must have explicit
non-duplicating rules before positive-point rotation can activate. A zero-point
implementation must not be substituted for the requested rewards capability.

The separate #557 question about a former login's deletion versus retaining an
independent active profile is also unanswered. Do not activate v2 unlink/erasure
handling until field ownership, former association and credit disposition are
settled. Rotating assignment does not itself decide those policies.

A dedicated strict version/capability must cover write, read, completion, replay,
expansion, export/erasure and rollback. New clients must not retry v2 against a
legacy header-ignorant endpoint. Unsupported or rolled-back readers keep pending
work with explicit unavailable actions; no legacy assignment fallback. Keep
existing profile flags off, and do not claim a new flag ready until the complete
current/previous-client matrix is accepted. No cron/provider/native activation.

## Bounded implementation and later evidence

- R0: this source/namespace/lifecycle contract is authored, not accepted runtime.
- R1: reviewed additive v2 schema/contract and bounded all-or-nothing server
  planner, exact root/date receipts, current eligibility, export/erasure and
  rollback. Credit/retention decisions above are inputs, not optional aftercare.
- R2: strict parent picker/review plus own-step/shared-safe read and completion
  adapters, preserving canonical data/actor boundaries and retained drafts.
- R3: consolidated deferred proof for account/profile mixtures, duplicate aliases,
  all inactive/archived/erased subjects, linked/unlinked changes, lost responses,
  concurrent expansion/edit/complete, monthly/weekday boundaries, credit/Undo,
  rollback/old clients, EN/ES/accessibility and named device/viewport journeys.

No criterion is checked and no issue closes from this proposal. Execution stays
in #480/#450; unlink policy/writer stays #557 and native compatibility stays #473.
