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
valid idempotency key and authentic signed proof. It invokes a fixed canonical
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

Event/chore/list deletion still need exact selected-target revision checks,
canonical lifecycle guards and atomic receipts before registration. Profile
assignees need explicit protocol-2 controls and canonical adapter integration;
the existing account-only picker must not infer a User from a profile. These
actions currently refuse through the new endpoint. Keep the capability off
until all supported kinds, profile behavior and recovery UI are complete and QA
passes. Do not close #123/#144/#128 from this partial checkpoint.

Positive record locks are not range/predicate locks. A bounded Today window
does not prove absence, complete schedule feasibility, meal/inventory planning
correctness or universal generation coverage across legacy writers. Broader
versioning, canonical food/recipe/schedule planning and semantic evaluation remain
required. Source, UI, API, real PostgreSQL/concurrency, compatibility and release
checks follow in the consolidated QA phase; authored cases are not passing
evidence. Native/store/device/provider acceptance remains separate.
