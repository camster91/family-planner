# AI confirmation source checks

2026-10-22: source in progress, cases authored and unrun. Not activated or
release-verified. This supplements canonical controls; it is not an autonomous
tool executor or semantic correctness guarantee.

## Contract

`FAMILY_ASSISTANT_CONFIRMATION_READY=1` requires both Today and reference
capabilities. Examples default to off. A capable client explicitly negotiates
`X-Assistant-Confirmation: herewoven.assistant-confirmation.v1` on an Include
Today request. Only then may the server issue a proof beside a typed mutating
proposal. The model never receives or creates it. Old clients retain their
existing contract. No real provider, secret, paid service or flag was activated.

The signed, bounded proof binds original person, household, role, token
generation, action kind, original Today lease/day/time zone and keyed fingerprints
of the typed context, exact record catalog and normalized features. It carries
no prompt, recipe, note, raw record catalog or model-supplied URL. It proves
neither human approval nor the proposed body's semantics. The user must still
review the concrete fields and choose canonical targets.

`POST /api/assistant/actions/confirm` accepts only a strict bounded envelope,
valid idempotency key and authentic signed proof for contextual actions. The
explicit revision-bound manual profile assignment exception is described below.
It invokes a fixed canonical
handler in-process, preserving original person credentials and key. It never
fetches a client/model-selected URL. Versioning avoids an older replica silently
ignoring a new freshness header. Unsupported kinds are a known pre-effect
refusal, with no fallback to an unchecked write.

## Transaction and recovery

Canonical effects hold user-before-household membership locks and renew current
actor authority before a stored receipt can replay. After a completed receipt
check and before a new effect, the guard checks original lease and live gates,
current features, rereads scoped sources without materializing recurrence,
locks the selected positive records/dependencies and rereads the context/catalog.
Changed or unavailable source evidence refuses the write. Effect and completed
receipt commit together. Transport storage only fills an incomplete receipt; it
must not replace an exact canonical receipt with its size-limited fallback.

An expired proof can be decoded to recover an already-completed exact receipt
under fresh original authority. Expiry cannot authorize another effect. Changed
key bodies use the existing canonical conflict response. A known source refusal
keeps the edited proposal held; explicit refresh preserves human edits only if
the refreshed kind still matches and remains permitted, clears removal approval,
reloads canonical choices and requires another review/new key. Failed/mismatched
refreshes retain the held edits without a usable source proof. Unknown outcomes
remain unknown and are not automatically retried or mislabeled pre-effect.

## Implemented source and remaining work

Event create, account-assigned chore create, grocery add, list create and note
create have transactional guards. List/note creates also gain optional keyed
atomic receipts and current actor/feature checks for their ordinary canonical
routes. Legacy no-key deliberate creates remain distinct; HTTP shapes/statuses
and note-color normalization are preserved.

Event/chore/list deletion now has registered canonical adapters and optional
atomic minimal receipts. Before a sourced deletion, the user selects a target
from canonical choices. A read-only bounded `POST /api/assistant/actions/target`
renews person/role/generation/features and the original source proof, then locks
and reviews that one record. It returns the current canonical title/date/list
details and item count, plus a distinct signed 60-second target token. Full
record/dependent content remains server-side. Chat replaces stale choice details,
requires a fresh explicit removal checkbox and sends both proofs to the fixed
confirmation endpoint; missing/unreadable target evidence cannot start a delete.
Preview is a read, consumes no mutation key and never authorizes a write itself.

Target fingerprints include all scalar target fields and bounded directly affected
records: event preparation/steps and calendar links; chore assignments,
preparation link and responsibility state; list items and shopping sessions.
Parent/child row locks protect the reviewed set against edits/deletes and FK
inserts during effect verification. Explicit foreign dependent-family anomalies
and erased chore subjects refuse. Each child group is capped at500 and the
canonical serialized snapshot at1MiB; exceeding a bound requires canonical app
controls rather than a partial chat deletion preview. Tokens contain only owner,
kind, target ID, timing and keyed fingerprint. They are never sent to the model.

The canonical deletion transaction renews authority before receipt replay, then
checks source and exact target before a new effect, rechecks current lease/gates
after target waits, applies the existing imported-event, profile-protocol,
routine-schedule, recurring-anchor/history and assignee restrictions, and stores
`{success:true}` with the deletion. Completed keyed recovery works after target
deletion/expiry under current original actor authority; ordinary no-key second
deletes still return the canonical missing-record response. No provider delete,
recurrence rewrite, history inference or new child/profile authority is added.

## Explicit email-free profile assignment

The dashboard advertises profile assignment only when the existing profile setup
and paired chore/rollback capabilities are enabled. Parent chat then reads the
canonical account and profile directories (no new roster store or model identity
lookup). Both reads must succeed, profile capability must remain advertised and
the combined bounded catalog must validate; a paused/malformed profile response
cannot silently become account-only choices. Archived profiles are excluded;
the canonical profile directory excludes erased, linked and legacy-mapped rows.
The browser discards account email fields and keeps names plus explicit typed
subject metadata only. UI selection values use distinct account/profile prefixes,
so even colliding raw IDs cannot cross namespaces. Profiles are labeled as family
profiles and the UI states that the signed-in parent is adding the task.

Profile confirmation uses the existing strict protocol-2 chore schema with
`selection.memberId`, never `assigned_to` or an inferred account. The versioned
confirmation envelope also requires the directory's reviewed profile revision.
The fixed canonical handler binds that revision into the idempotency request hash
and passes it to the existing profile-chore transaction. After current parent
membership and completed-receipt checks, that transaction protects/rereads the
profile, revalidates active/unlinked/unerased role/age eligibility and exact
revision, verifies any supplied Today proof and creates the canonical chore and
compact `{choreId}` receipt together. Source proofs remain absent from provider
inputs. No email/account is created and no notification is sent to a profile.

A manually reviewed profile chore can use this same versioned endpoint without
Include Today or a signed contextual proof. This only authorizes the ordinary
parent-reviewed canonical profile create, with its exact selection/revision and
existing feature/recurrence gates; it makes no contextual freshness claim. The
exception cannot be used for account chores or other domains. When a source proof
is supplied it must always validate and renew; no manual fallback is used on a
source refusal. Old replicas cannot silently ignore the revision requirement,
since the client never falls back from the versioned endpoint to a direct write.
Ordinary installed clients retain their existing explicit protocol-2 API contract.

Profile recurrence remains separately gated. Chat keeps the proposed schedule
intact, explains a pause and blocks confirmation rather than converting weekly
work to Once. The user may explicitly choose Once, another assignee or the normal
Chores editor. Known canonical profile conflicts/unavailability retain edited
fields and offer a GET-only roster reload; unknown results stay unknown. Compact
completed receipts replay under original current parent authority after profile
change/archive/source expiry without creating another task or returning cached
profile content. Recurrence rollback retains its existing pre-replay hold.

All cases are authored and unrun. Keep capabilities off until consolidated QA
passes. Broader canonical planning, version coverage, semantic evaluations and
inbox follow-through remain source work. Do not close #123/#144/#128 from this
checkpoint; profile deletion still follows the existing canonical protocol hold.

Positive record locks are not range/predicate locks. A bounded Today window
does not prove absence, complete schedule feasibility, meal/inventory planning
correctness or universal generation coverage across legacy writers. Broader
versioning, canonical food/recipe/schedule planning and semantic evaluation remain
required. Source, UI, API, real PostgreSQL/concurrency, compatibility and release
checks follow in the consolidated QA phase; authored cases are not passing
evidence. Native/store/device/provider acceptance remains separate.
