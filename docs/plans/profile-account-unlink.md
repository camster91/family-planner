# Completed profile/account unlink and rejoin — #557 / #480

2026-10-24 source-backed design. Status: dormant pure routine preparation, bounded transaction-reader and routine-only writeback helpers are authored; the full unlink command remains proposed;
standalone unlink is **not implemented or activated**. No test, browser, migration,
account mutation, provider call or production action ran. Keep #557 open.

## Current source and why deleting one row is insufficient

| Existing source | Actual boundary | Consequence for unlink |
| --- | --- | --- |
| `profile-account-link-contract.ts`, `profile-account-link.ts` | Revoke cancels pending/claimed challenges; linked challenges refuse revoke | Do not relabel revoke or make an old challenge cancel a completed identity |
| `attachSubjects` in `profile-account-link.ts` | Creates both AccountLink and LegacyMapping, fills canonical chore aliases, rewrites routine future subjects and increments profile revision | Removing only AccountLink leaves mapping-based identity active; removing both without domain reconciliation loses compatibility |
| `chore-member-subject.ts` | Resolves both mappings and links; canonical-required callers refuse an unmapped account | Account assignment behavior after unlink must be explicit, including installed clients |
| `chore-profile-assignee.ts`, `household-profile-http.ts` | Name-only eligibility requires no mapping/link, no archive and no erasure provenance | Setting erasure_user_id as a shortcut would make the supposedly active unlinked profile ineligible |
| `routine-subject-lifecycle.ts`, `routine-subject-unlink.ts`, `routine-subject-unlink-write.ts` | Existing link/invalidate/erase transactions remain unchanged; pure unlink preflight and routine-only writeback adapter authored, not connected | Exact known account+profile aliases convert to the same stable profile with a new revision; ambiguous/unsupported definitions hold the whole future unlink |
| `household-member-lifecycle.ts` | Member removal archives profiles; private erasure_user_id identifies detached archived copies for later account deletion | Removal changes household access/archive state. It cannot substitute for standalone unlink while preserving an active household profile |
| `chore-complete.ts`, `chore-profile-actions.ts` | Account-backed completion/credit and profile completion use distinct paths | Alias cleanup must not duplicate credit, prevent a legitimate reversal, or transfer prior awards to another account |

A profile is not a login. Unlink must not remove the account from its household,
change role, delete credentials, grant shared-device elevation or transfer data
into another account. Removing household access remains the existing separately
reviewed member-removal action.

## Reviewable user flow

1. From personal parent management, select an actual completed profile/account
   association, not an arbitrary matching name/email or old raw token.
2. Show the exact profile and account, the distinction from removing a household
   member, and counts of affected future work/history by supported domain.
   Do not expose private account records or finance/medical content to this UI.
3. Require fresh personal authority and the intended account owner's explicit
   confirmation using a bounded ownership-proof flow. A paired/elevated device
   and possession of the original link are not owner proof.
4. Parent reviews the same current snapshot and confirms unlink. Changed
   membership, role, link, profile revision, affected future work or proof expiry
   requires a fresh review. Never silently substitute a different account.
5. Display a canonical completed/unknown/refused result. Keep the original
   request key/body for an unknown result. No automatic second unlink or relink.
6. Relink requires a fresh explicit verified challenge. A receipt, historic
   account ID, same name or email never reactivates an association.

The adaptive EN/ES confirmation must explain what continues on the name-only
profile and what remains on the real account. No standalone unlink button is
exposed before the complete data/compatibility contract is implemented.

## Atomic transaction requirements

- Acquire all discovered affected User locks in sorted order, then the household
  lock. Re-read participants under those locks; refuse changed participants
  rather than reversing lock order. Verify household existence, fresh session
  generation, parent/owner authority, supported capability and feature gate.
- Match one exact active profile, mapping and verified link in the same family.
  Reject foreign, archived, erased, contradictory or multiply associated rows.
  A migration mapping alone is not proof of a verified completed link.
- Verify a server-issued, short-lived exact snapshot and its owner proof. A
  client-supplied summary/count or a public capability manifest is not authority.
- Preserve the stable member ID and every canonical target/occurrence/receipt ID.
  Do not rewrite completed actor provenance, move awards to the parent or invent
  a new User. Specify supported alias changes separately for future, pending,
  completed, rejected, undone and erased rows before writing any of them.
- Add an exact supported routine unlink transformation with revision invalidation
  for future definitions/reviews. Unknown future protocols and ambiguous
  account-only definitions require explicit recovery, never guessed conversion.
- Preserve earned-credit provenance and legitimate Undo across account/profile
  boundaries. Introduce the required per-domain ledger/compatibility semantics;
  do not pretend that unchanged User.xp alone proves profile-credit parity.
- Remove active link and mapping only after all supported domain changes can
  commit together. Increment the profile/operation revision and invalidate old
  proofs/challenges so delayed approve/claim cannot recreate the association.
- Commit a stable content-minimal receipt and audit event in that transaction.
  Retry returns the exact original outcome only if current authority permits it;
  it never replays effects or resurrects a deleted/archived/erased subject.

## Dormant future-routine adapter source

`src/lib/routine-subject-unlink.ts` now defines a pure preflight result:
`unchanged`, `rewrite` or `held`. It performs no reads/writes and grants no
identity or household authority. The future locked writer must pass every stored
future root definition in the authorized household; it must not filter unknown
protocols by guessed subject fields or discard a held result as unrelated.

- Exact account+member aliases become the same stable profile subject. An
  already-profile definition for that member also receives a fresh revision.
- Active, paused and stopped states preserve schedule, start day, content, points,
  anchor and stack identity. No occurrence/actor/earned-credit fields are read or
  changed. A new revision invalidates prior future-definition reviews.
- Account-only references to the target account are ambiguous; either conflicting
  half of the association holds. Known unrelated or erased subjects stay unchanged.
- Unsupported/malformed definitions hold, even if their apparent current identity
  looks unrelated. Revision exhaustion holds rather than clamping to an old value.
- The returned previous revision and stack ID are private preparation data. The
  future writer must re-read under lifecycle locks, renew exact snapshot/owner
  proof, invalidate affected stack reviews and commit all domain dispositions
  atomically before removing any link or mapping.

`prepareRoutineSubjectUnlinkBatch` now composes the pure adapter over a complete
future-root inventory. It validates bounded association IDs, household/root
identity and duplicate root IDs before preparing definitions. The future locked
reader must enumerate every non-null future definition without subject/protocol
filtering, use limit + 1, and report incomplete coverage truthfully. The planner
holds partial inventories or more than 1,000 roots instead of accepting a prefix;
a later reviewed large-household path is required above that preparation bound.

Any held definition returns a held batch with **no partial rewrite/stack list**.
A ready result includes inspected/unchanged counts, deterministic root order,
previous revisions and unique sorted affected stack IDs, without mutating input
order. `complete` is internal reader metadata, never a public request/owner proof.
The planner cannot itself prove coverage, current role, family membership, owner
proof or absence of subsequent edits; a ready plan is not an unlink receipt.
`prepareRoutineSubjectUnlinkInTx` in `routine-subject-unlink-read.ts` now
provides dormant transaction-reader preparation. It validates association bounds
before reads, holds missing routine storage, and first selects every non-null future
root's ID/ownership and serialized UTF-8 byte size, ordered by ID with limit1,001
and FOR UPDATE. Individual definitions above64KiB or aggregate payload above4MiB
hold the whole preparation before JSON transfer. Invalid size/ownership metadata
also holds. The second query loads only the exact locked IDs; missing/replaced or
duplicated returned roots hold as an inconsistent inventory.
There are no subject/protocol/state filters that could hide unknown future work.
Above 1,000 roots it returns a held result with no prefix rewrites. The complete
bounded inventory delegates to the existing pure planner; storage errors propagate.

Its caller must already hold participant/household lifecycle locks and renew the
exact association and owner proof. Row locks alone cannot prevent phantom roots;
all future-definition writers must honor the household lock. The helper supplies
no authority, transaction wrapper, mutation or receipt. No production transaction,
HTTP/UI route or account command invokes it. Row count and transferred JSON payload now have explicit bounds. PostgreSQL
JSON serialization, JS object overhead, total scan/lock time and query-plan costs
remain unmeasured; byte limits do not establish those resource budgets. The full unlink writer,
former-association provenance, domain/credit/Undo parity and activation remain open.

Regression source covers exact/profile/paused/stopped/unrelated/erased subjects,
conflicting/ambiguous aliases, unknown/malformed protocols, bounded IDs and
revision exhaustion, plus batch completeness/foreign-root/duplicates/bounds/
ordering/no-partial-result cases. It is authored and **unrun**. The reader's scope, lookahead, absent-schema, unsupported metadata and failure
cases are also authored/unrun, including metadata-first size limits, overflow,
malformed sizes and changed JSON inventory. There is no call from existing identity
transactions, endpoint, UI, database/schema change, permission change or activation. This adapter alone is not a standalone unlink implementation or
proof of account/member-domain/credit parity.

## Dormant routine writeback adapter — 2026-10-25

`rewriteRoutineSubjectsForUnlinkInTx` in
`src/lib/routine-subject-unlink-write.ts` now composes fresh bounded preparation
with routine-only writeback. It accepts an internal transaction and exact
association, never a caller-supplied ready plan. It grants no authority and has
no production endpoint/UI/link/account caller. The future complete unlink
command must first hold sorted participant User locks then the household lock,
renew the association/proof/review/capability, and support all other domains.

Before any effect, it checks every affected stack's storage and locked ID,
household, version and byte metadata. Missing/foreign/duplicate/inconsistent
stacks hold; revisions at Int32 exhaustion hold rather than clamp. Stack label
and config payloads each cap at64KiB and their combined aggregate at4MiB before
JSON transfer. This stack budget is separate from the root reader's4MiB budget;
neither is a total memory/SQL/latency claim. Null schedule_config preserves a
legacy current-occurrence stack. Unsupported non-null definitions or a known
stack definition that omits a rewritten root hold the entire routine slice.

After all preparation succeeds, only each root's future routine_series_config
changes, under a scoped root/revision comparison. Its schedule/state/content,
stable member and canonical row IDs remain as prepared; occurrence assignment,
completion/credit/actor fields are untouched. Each unique affected stack gets
one new version and the existing lifecycle-style SHA-256 review fingerprint.
Stack schedule/label remain unchanged. Failed root or stack update counts throw
`RoutineSubjectUnlinkWriteConflict`; the future outer transaction MUST propagate
that error and roll back all domains. Held results occur only before writes.
Internal applied counts are not an unlink receipt or ownership proof.

Source regression cases cover shared-stack invalidation once, paused definition
and points preservation, no occurrence/alias/credit writes, incomplete inventory,
foreign/oversized/exhausted stack metadata before JSON/effects, unknown config,
and failed root/stack compare refusal. They are authored/unrun. No PostgreSQL
transaction or rollback, source check, test, API, identity mutation, activation
or deployment ran. This adapter supplies routine writeback only: former-account
provenance, credit/Undo and all-domain disposition, owner-proof/snapshot/receipt,
canonical unlink UI/endpoint and old/new-client acceptance remain unfinished.

## Proposed former-association provenance contract — 2026-10-25

This is a concrete storage/lifecycle proposal, not an accepted retention policy,
Prisma model, migration or activated command. It resolves the minimum private
shape and required transitions; the field-ownership and earned-credit decisions
below still gate implementation of the complete unlink transaction.

### Existing source constraints

- `HouseholdMember.erasure_user_id` is immutable archived-profile erasure
  ownership. `chore-profile-assignee.ts` and profile eligibility reject a profile
  carrying it; setting it during active unlink would break the requested person.
- `HouseholdMemberAccountLink` and `HouseholdMemberLegacyMapping` use current
  `(user_id, family_id)` membership FKs. A former account can leave/rejoin another
  household. A historic association cannot reuse that composite User FK.
- `eraseAccountProfilesInTx` selects current mapping/link subjects and archived
  erasure-owned copies. It does not discover an independently active unlinked
  profile. Adding a history row without changing erasure discovery is incomplete.
- `lockAccountProfileHouseholds` currently starts with the deleting account lock
  and discovers relevant households. If historic erasure requires inspecting a
  subsequent linked account, its User lock must be discovered before household
  locks. Acquiring that account lock after a household lock would violate order.
- A verified link currently has no independent stable link ID: its exact source
  is the member/account/family tuple plus verified_at and the locked profile
  revision. Name/email, a deterministic legacy mapping or an old challenge is
  not a substitute for that current verified association.

### Minimum private history row (proposed)

Use one immutable `HouseholdProfileFormerAssociation` row per committed unlink.
It is association provenance, not an authentication/erasure-ownership grant.

| Field | Source and purpose | Constraint |
| --- | --- | --- |
| `id` | Server-generated opaque event ID | Never derived from name/email or used as owner proof |
| `family_id` | Exact locked association household | Family FK; household deletion removes this private metadata |
| `member_id` | Existing stable profile | Composite member/family FK; explicit reviewed member erasure removes its association history |
| `former_user_id` | Actual verified linked account | User ID-only FK, not current-membership composite; deletion must be Restrict until the canonical erasure transaction dispositions this row |
| `link_verified_at` | Existing verified link's server timestamp | Immutable; no claim token/password/hash copied |
| `profile_revision_before` | Exact reviewed/locked profile revision | Int32 bound; exhaustion refuses before effects |
| `profile_revision_after` | Revision committed by this unlink | Exactly before+1; never a clamped or client-supplied new revision |
| `unlink_operation_id` | Durable canonical unlink receipt/operation | Unique effect provenance; not an expiring general idempotency row and not a raw retry key |
| `created_at` | Actual unlink commit event time | Server-owned; timestamps alone cannot identify a repeated link/unlink cycle |

No display name, email, avatar, date of birth, role, medical/finance data,
credentials, session generation, proof token/hash, message text or AI output
belongs in the history row. The separate unlink operation needs its own bounded
proof/receipt contract and account-erasure treatment before storage is added.
A content-minimal row still contains personal account/profile identifiers and is
private data. It must be excluded from public/member/shared-device/AI context and
ordinary household feature exports. Personal privacy export must disposition it
through the account's authorized private export path without revealing another
account's identity. No legal retention entitlement is inferred here.

Do not independently TTL-prune this row while the profile survives: doing so
would lose the only discoverable former association before erasure is resolved.
Conversely, a row's presence never authorizes deleting the whole profile. The
accepted erasure disposition, full member erasure or household erasure must
remove it atomically. Real retention/legal ownership review remains explicit.

### Required transitions and atomicity

| Transition | Required source behavior | Refusal/recovery |
| --- | --- | --- |
| Current verified association -> unlink | Under exact owner-proof/review and sorted User then household locks, create history and durable operation, apply every domain disposition, remove exact mapping/link, advance profile revision and invalidate challenges together | Any changed association/proof/domain holds before commit; partial history or alias removal is not a completed unlink |
| Migration mapping without verified link | Preserve current mapping and profile | Refuse standalone unlink; mapping is not account-owner proof |
| Fresh verified relink to the same account | Require new explicit proof and revision; retain earlier history until reviewed erasure/retention disposition | Prior history/receipt never reactivates a link or grants authority |
| Fresh verified link to a different account | Use normal exact owner proof; never silently transfer historical credit/actor provenance | A former association must not be repointed to the new account |
| Former account moves households | Keep history in the original profile household and preserve exact former account ID | No family update, automatic profile movement or current membership grant |
| Account owner requests permanent erasure | Discover all former-association households before locking; re-read under locks and disposition every history/profile/operation relationship before User deletion | Missing/unsupported field-ownership disposition or changed participants holds the transaction; no cascade silently erases a current independent/other-account profile |
| Explicit full profile/household erasure | Apply complete canonical member-domain erasure first; remove private history/operations under their accepted privacy contract in the same transaction | Never let history recreate a deleted subject or transfer earned credit |
| Older server rollback after first history write | Disable new unlink/link/profile identity writes and incompatible account erasure until a server that understands provenance is restored | Retain history/operation rows; do not drop them or restore erased identities as rollback |

An erasure of account A must never infer current ownership of a profile from a
historic association alone, especially after a verified link to account B.
If current and historic associations refer to different accounts, discover all
participants before sorted account locks, then household locks; re-read the set
and refuse a changed set. A profile field's current value/revision or a matching
name does not prove which account originally supplied or currently owns it.

### Unresolved field-ownership and credit decisions (activation blockers)

The history shape above deliberately stores no copied profile fields. It cannot
alone tell whether name/age/avatar/color came from account copying, a parent's
independent entry or a later edit. Before a writer or schema can activate:

1. Define field-level provenance or an explicit reviewed privacy disposition for
   an active unlinked profile, including originally name-only and copied legacy
   profiles. Specify which identifying values are redacted, retained or separately
   reviewed on former-account erasure; do not automatically erase the whole active
   profile or pretend that deleting only this history row completes privacy work.
2. Define subsequent-account links and multiple unlink cycles: erasing A cannot
   erase B's personal records, inherit B's identity, or bypass A's required privacy
   disposition. A generic held conflict is safe recovery, not completed support.
3. Define earned-credit/Undo ownership for completed account-backed assignments
   retained on the stable profile. Existing User XP, required assignment account
   FK and unchanged actor IDs do not establish a reversible credit ledger.
4. Define the durable operation's private export/erasure policy and original-key
   recovery after general receipt expiry. Neither raw old keys nor a new operation
   ID may become proof of a verified association.
5. Extend erasure participant/household discovery and supported-client rollback
   contracts before writing the first history row. A schema FK that simply
   cascades or an older erasure helper that ignores this history is insufficient.

Codex can prepare those source contracts and recovery UI. Cameron reviews the
actual field/credit product disposition before activation. No original account,
profile or earned history has been changed by this proposal.

## Remaining domain and compatibility work

The domain inventory remains authoritative for every account/member relationship.
A chore-only unlink implementation is insufficient for points/rewards, rotation,
projects, pickups, allowance, health and other unmigrated member domains. Preserve
account-only private records and actor semantics; explicitly defer unsupported
writes rather than silently claiming their migration.

Use an additive versioned unlink protocol and private capability negotiation;
keep existing protocol-1/member and link challenge response shapes readable.
Do not return a new unlink state to old strict receipt parsers. Retain original
online requests and older queued bytes. Unlink, linking, authentication and
permissions remain absent from the offline action allowlist.

## Delivery and later acceptance

1. Freeze the erasure/credit/domain disposition and exact review/receipt contract.
2. Add private provenance/receipt storage and exact routine/domain adapters with
   additive old-client behavior. No production migration/backfill is implied.
3. Implement the locked owner-proof/review/confirm endpoint and adaptive canonical
   UI; retain refusal/recovery until every referenced domain is supported.
4. Later, run original two-household, owner/parent, stale/expired/replayed proof,
   changed role/membership, unknown response, repeated unlink/relink, completed
   credit/Undo, recurrence/rotation, subsequent account/household erasure and
   current/previous-client forward/rollback checks. Include phone/tablet/fridge
   privacy boundaries. An authored fixture is not a passing result.
5. Separate source, migration, rendered, physical-device and production evidence.
   Keep activation off until original acceptance and owner release decision.

Codex owns source contracts/adapters, canonical UI and later isolated acceptance.
Cameron owns review of the erasure/credit/product contract and any production
migration/activation decision. This document completes the bounded unlink design
inventory; it does not complete or close the unlink implementation in #557.
