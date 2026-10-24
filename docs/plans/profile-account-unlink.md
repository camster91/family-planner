# Completed profile/account unlink and rejoin — #557 / #480

2026-10-24 source-backed design. Status: implementation contract proposed;
standalone unlink is **not implemented or activated**. No test, browser, migration,
account mutation, provider call or production action ran. Keep #557 open.

## Current source and why deleting one row is insufficient

| Existing source | Actual boundary | Consequence for unlink |
| --- | --- | --- |
| `profile-account-link-contract.ts`, `profile-account-link.ts` | Revoke cancels pending/claimed challenges; linked challenges refuse revoke | Do not relabel revoke or make an old challenge cancel a completed identity |
| `attachSubjects` in `profile-account-link.ts` | Creates both AccountLink and LegacyMapping, fills canonical chore aliases, rewrites routine future subjects and increments profile revision | Removing only AccountLink leaves mapping-based identity active; removing both without domain reconciliation loses compatibility |
| `chore-member-subject.ts` | Resolves both mappings and links; canonical-required callers refuse an unmapped account | Account assignment behavior after unlink must be explicit, including installed clients |
| `chore-profile-assignee.ts`, `household-profile-http.ts` | Name-only eligibility requires no mapping/link, no archive and no erasure provenance | Setting erasure_user_id as a shortcut would make the supposedly active unlinked profile ineligible |
| `routine-subject-lifecycle.ts` | Link, invalidate and erase transformations exist; no exact unlink transformation | Invalidate/erase is not unlink. An active future definition must keep its intended stable person |
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

## Erasure, credit and compatibility decisions still required

The existing single erasure_user_id field represents archived copied-profile
provenance. It cannot represent an active unlinked profile's former association
without also affecting eligibility/deletion behavior. Specify the minimum private
former-association provenance, who owns each retained field, account erasure,
subsequent verified links, household erasure and privacy-safe export before adding
schema or a writer. Never add former account IDs to shared/AI/member DTOs.

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
