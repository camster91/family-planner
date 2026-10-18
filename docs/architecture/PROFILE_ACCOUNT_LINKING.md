# Profile-to-account linking — #557 implementation candidate

Status: source implemented locally; not generated, migrated, tested, activated or released. QA is deliberately deferred to the integrated candidate under Cameron's implementation-first direction. This document is the flow/spec reference for the short existing form-sheet implementation, not rendered/design approval.

## Identity and consent

A name-only `HouseholdMember` is never an account or session. An email/name match, selected profile on a shared device, or parent selecting an account does not prove ownership. A person first joins the same household through the existing account invitation flow, verifies their email and signs in. The existing account role must match the profile presentation role; linking never upgrades a role or changes account authority. Conflicting stable identities require a separate reviewed migration, not an automatic merge.

1. A current parent chooses an active unlinked profile and creates a 24-hour one-use link. The browser generates a 256-bit random token and an idempotency key. Only a SHA-256 digest and a nonsecret request fingerprint enter the database.
2. The parent shares the link privately themselves. No provider mail, invitation or background delivery is sent by this feature. The person signs in first, then opens `/dashboard/profile-link#token=...`.
3. The client removes the fragment with `history.replaceState` immediately after mounting. The token stays only in component memory. Refreshing, process death or changing browsers requires reopening the original link; it is never put into local/session storage, return URLs, query strings, logs, help/assistant context or the offline queue.
4. The account owner reviews the profile and their signed-in account, then reenters their current password. The server verifies the password outside lifecycle locks and rechecks its exact hash/session generation inside them. Verified email, current household and compatible role are required. Accounts without password reauthentication cannot claim through this flow; no weaker fallback is invented.
5. A current parent reviews the actual claimant and explicitly approves. The issuer must also still have current parent authority and the same session generation as issuance. A claimed token cannot be adopted by another account.

Parents can revoke outstanding attempts, including expired/unavailable ones. An explicit new issuance closes expired attempts under the household lock. There is no scheduler. The partial unique database index allows only one pending/claimed attempt per profile. Password/session-generation changes invalidate outstanding proof; a parent revokes it and issues another. The management list shows all outstanding attempts for the household roster, so older approvals cannot be silently hidden by a result cap.

## Canonical transaction

`manageProfileAccountLink` discovers participant IDs, acquires sorted User advisory locks before the household lock, then rereads everything. If a claimant changed during lock acquisition it returns conflict instead of acquiring another User lock under a household lock. Authentication context supplies the family/user; request fields cannot change them.

Final approval creates both `HouseholdMemberAccountLink` and the existing compatibility `HouseholdMemberLegacyMapping` pointing at the **same existing profile ID**. It then fills the account alias on profile chores and the profile alias on legacy account chores/assignments. Existing foreign/contradictory subjects reject the transaction. Erased subject markers are never reconstructed. Chore IDs, anchors, weekly days, frequency, status, completion/approval actors, points and XP are unchanged. Profile completions do not become authenticated-account completions. The profile revision increments and an Activity records the actual parent actor and stable profile subject; no token, password or email is added to activity metadata.

This alias step matters: canonical chore readers reject a profile-only chore once that profile has an account link. Creating only an account-link record would hide existing chores. All aliases and the link must commit atomically. Existing unique constraints and chore subject triggers remain in force.

Creation retries reuse the browser's exact token/key; challenge IDs are deterministic per household/issuer/key and input fingerprints prevent key adoption. Claim replay is limited to the same owner with current proof. Approval replay returns a receipt only while the current active profile/link/mapping/account still match. It never recreates an association removed after a lost response. Revocation has revision/conflict semantics and cannot unlink a completed identity.

## Lifecycle and privacy

The existing `household-member-lifecycle.ts` remains the removal/erasure authority. Account removal archives the exclusive linked profile, records private erasure provenance and removes mapping/link. Archive/revision/erasure changes invalidate challenge confirmation. Account deletion and profile erasure cascade challenge records through their FKs. No challenge alone grants shared/private access or permits profile reactivation. A separate casual unlink/reactivation action is intentionally absent: that would require an explicit history-decoupling policy and must not resurrect a removed person's data.

The parent management API is private/no-store, and all actions refuse paired-device contexts before reading a lingering personal cookie. Child/teen exact access is limited to `/dashboard/profile-link`; it exposes only same-household owner review/claim, never the parent list/issue/approve/revoke controls. Management DTOs contain profile/account display identity and status, never hashes, passwords or proof snapshots. Error logging uses fixed diagnostic text. The existing CSRF boundary applies; claim proof attempts have a stricter account-scoped rate limit. This domain is not queued offline.

## Activation and rollback

Additive table: `database/migration-household-profile-links.sql`, discovered by the existing alphabetically ordered startup migration runner after the member foundation. No schema/data migration was executed for this candidate and no shared Prisma client was regenerated.

The route and parent capability require **all** of:

- `HOUSEHOLD_PROFILE_LINK_ENABLED=1` (new, off by default)
- `HOUSEHOLD_PROFILE_SETUP_ENABLED=1`
- `HOUSEHOLD_PROFILE_CHORE_ENABLED=1`
- `HOUSEHOLD_PROFILE_CHORE_ROLLBACK_READY=1`

None was enabled as part of this source work. Auth/paired refusal occurs before an unsupported response. Parent profile responses add `profileAccountLinkSupported: true` only when this complete gate is enabled; existing manifest protocol is unchanged. Existing clients must continue reading dual account/member aliases and must not infer links from a new field. Turning the new gate off blocks new proof/actions; it does **not** delete completed links, remove aliases, revive old profiles or roll back to code that cannot read the canonical member model. Safe reader/schema rollback and installed-client compatibility remain release gates.

## Deferred consolidated QA acceptance

No passing result is claimed. The later combined QA must cover:

- Schema generation/startup migration idempotence, FK cleanup, partial unique index, unchanged relation inventories and all existing contract gates.
- Two fabricated households; foreign/absent IDs/tokens, every role, paired and elevated tablet contexts, CSRF and rate limits, no raw token/password in persistence/logs/export/telemetry.
- Passwordless/unverified owners, wrong password, stale session, issuer/claimant household or role changes, profile archive/edit/erase, prior account mappings, conflicting/erased chore subjects.
- Issue/claim/approve/revoke race pairs, sorted lock order, request replay, lost responses, expiry, revoke-before-confirm, removal then replay and permanent erasure; no resurrection or duplicate link.
- Preserve stable profile ID, recurrence anchors, same-day/weekly routine assignments, completed history, author/approver provenance, XP/points and target account private access; newest and installed-client canonical reads after linking.
- EN/ES, child/teen/parent views, keyboard/focus/Back, long names, phone/tablet/desktop sheets, offline/stale/failure receipts, clipboard failure, locale change retaining exact in-memory token and no false success.

#557 stays open until these gates and lifecycle/compatibility acceptance are complete.
