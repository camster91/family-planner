# ADR-0008: Household audit history

**Status:** Proposed
**Date:** 2026-09-29
**Owners:** Cameron (product), agents (implementation)
**Related issues/PRs:** #285, PR101 D-4 (`decisions/PR101_DISPOSITION.md`, provisional yes in `decisions/PROVISIONAL_OWNER_DECISIONS.md`), #292 (account deletion), `SHARED_DEVICE.md` §10

## Context
Parents share control of household settings: features, invites, the Today board and the family tablet. When something
changes ("who turned off chores?", "when was the kitchen tablet removed?") there is no answer in the app. `master`
already has `DeviceAuditEvent` (`src/lib/device-audit.ts`), but it is a security trail for the shared tablet: best
effort, fixed metadata with ids only, 180-day retention, never shown as plain history, and silent about changes a
parent makes from a phone.

## Decision
1. **A separate `AuditLog` table** (`prisma/schema.prisma`, additive DDL in `scripts/migrate.js`): `family_id`,
   `actor_user_id` (nullable, `ON DELETE SET NULL`), `actor_kind` (`person` | `device`), `action`, `target_type`,
   `target_id`, `summary`, `created_at`; index `(family_id, created_at DESC)`; `ON DELETE CASCADE` from `Family`.
2. **Written in the same transaction as the change** (`writeAuditLog(tx, …)` in `src/lib/household-audit.ts`). A failed
   audit write fails the change; a failed change leaves no row. This is the opposite of the device trail on purpose.
3. **Fixed vocabulary.** `action` is one of `feature.turned_on`, `feature.turned_off`, `member.joined`,
   `board_settings.changed`, `device.paired`, `device.renamed`, `device.removed`, `invite.created`, `invite.revoked`.
   `summary` is built only from fixed templates plus names (a feature title, a member's or a tablet's name, a role
   word), at most 200 characters. Never an email address, code, token, PIN, place, coordinate, colour value or other
   free text.
4. **Audited changes:** `PATCH /api/family/features` (one row per feature that changed); joining a household
   (`POST /api/family/join`, which is where a member's role is set); `PATCH /api/family/board-settings` and
   `PATCH /api/device/elevated/board-settings` (section names only); tablet pairing (when the tablet is issued, plus the
   tablet it replaces), `PATCH /api/family/devices/[id]`, `POST /api/family/devices/[id]/revoke`, `PATCH /api/device/label`,
   `POST /api/device/revoke-self`; `POST /api/family/invites` and `DELETE /api/family/invites/[id]`. On the tablet the
   actor is the elevated parent and `actor_kind` is `device`.
5. **Read:** `GET /api/audit`, parents only, paired tablet refused before person auth, household-scoped, cursor-paged
   (1–50, default 20), `Cache-Control: private, no-store`. UI: Settings → Recent changes
   (`/dashboard/settings/activity`).
6. **Retention: 12 months**, enforced by pruning the reader's household in the read path (no scheduled job, AGENTS.md).
   The account export leaves out older rows even before a read prunes them.
7. **`DeviceAuditEvent` stays separate and unchanged.** It keeps pairing attempts, elevation, lockouts, token reuse and
   attributed tablet writes, which are security telemetry rather than household history, with its own 180-day retention
   (O-12). Where both apply (a parent removes a tablet) both are written: the device trail best effort, the household
   history in the transaction.

## Alternatives considered
- Feed the household history from `DeviceAuditEvent` — rejected: it is best effort by design (an audit failure must
  never block a revocation), has no plain summary, a different retention and a security audience.
- Port the PR #101 `AuditLog` (`database/migration-audit-history.sql`) as is — rejected: it predates the device trail,
  the kill switch and the canonical deletion plan; rebuilding against current routes was smaller than reconciling it.
- Free-form `metadata` JSON — rejected: it invites values (places, colours, emails) into a table many readers see.
- A scheduled prune — rejected: no scheduler is approved; pruning on read is enough for one household's rows.

## Consequences
### Positive
- Parents can see who changed household settings and when, from phone or tablet.
- The row exists exactly when the change committed.
### Costs/risks
- An audit write failure now fails the audited change (small table, simple insert).
- A household that never opens Recent changes keeps rows past 12 months until a parent does (the export filters them).
- There is no role-change endpoint on `master`; the role a member gets is audited when they join. A future
  "change a member's role" route must add a `member.role_changed` action and write it in its transaction.

## Compatibility / migration
Additive: one new table, no backfill, no change to any response shape except the new `auditLog` key in
`GET /api/users/export`. Old Android clients are unaffected. Rollback: stop reading; the table can stay.

## Security / privacy
Household-scoped on every read (`family_id` from the session) and write (the change's household). Parent-only; teen and
child get 403; a paired tablet gets 403 `DEVICE_WRITE_NOT_ALLOWED`. An actor who has left the household is shown as
"A former member". Deleted with the household (FK cascade on `master`; a `HOUSEHOLD_DELETION_PLAN` entry once account
deletion #292 lands). The privacy page describes it.

## Validation
`src/app/api/audit/__tests__/audit.test.ts` (roles, device 403, two-household isolation, paging, retention),
`audit-writes.test.ts` (every write path), `src/lib/__tests__/household-audit.integration.test.ts` (Postgres: atomic
commit and rollback, real paging, member and household deletion), the route-allowlist test, and the Recent changes
component test.

## Revisit trigger
A parent-facing need for older history, content-level history (who edited a chore), or a volume where read-path
pruning is visibly slow.
