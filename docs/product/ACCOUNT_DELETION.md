# Account & Household Deletion Contract

This document defines product/engineering requirements; exact legal copy is finalized before public launch.

## Principles
- Account deletion must be discoverable in-app for eligible account owners and satisfy current Play requirements at release time.
- Destructive actions require fresh authorization and explicit confirmation.
- A member deletion is not automatically a household deletion.
- Last-parent/household-owner rules must prevent accidentally orphaning a household.
- Shared-device sessions must be revoked when their household/account authority disappears.
- Deletion must not silently leave private content accessible through old links/tokens/caches.

## Required behaviours
Define and test:
- member leaves/is removed;
- parent deletes own account when another parent exists;
- last parent tries to delete/leave;
- whole household deletion;
- shared device/session/token revoke;
- pending invitations/recovery tokens;
- uploaded media;
- analytics/audit retention rules;
- third-party integration disconnect/delete behaviour;
- billing entitlement cancellation only after billing exists.

## Data execution
Prefer a documented job/transaction sequence with observable status for large cascades. Do not rely on accidental database cascades as the entire deletion policy. Retention exceptions must be explicit and minimal.

## Export
Where required/valuable, offer export before deletion. Export authorization must not leak another household.

## Testing
Use synthetic households. Test direct API authorization, last-parent protections, token/link invalidation, device revoke, retries/idempotency and partial-failure recovery.

## Approval boundary
Do not execute deletion against real production accounts/data during normal agent work.