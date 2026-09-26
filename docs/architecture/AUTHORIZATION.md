# Authorization Model

## Roles and contexts
Family Planner must reason about four access contexts:
- parent human session;
- teen human session;
- child human session;
- shared household device session.

A shared tablet is not a parent session.

## Server decision order
For every private API operation:
1. authenticate the session/device;
2. resolve current user/device state from authoritative server data;
3. resolve household membership/ownership;
4. enforce role/device capability;
5. validate all related IDs belong to the same authorized household;
6. perform the operation;
7. return only fields allowed for that context.

Do not trust client-supplied `family_id`, role, assignee, person or related-record IDs without server verification.

## Shared-device default capability
Allowed by explicit shared-surface design: glanceable schedule, approved household tasks, meals, groceries, inventory/use-soon and other purpose-limited fields.

Excluded by default: detailed finance, private messages, precise addresses, medical notes, account/security settings, secrets/tokens, billing and destructive admin/member operations.

Parent-only operations from a shared device require explicit elevation/re-auth/PIN design and must automatically return to shared mode.

Proposed contract (#157, not implemented): ADR-0006 and [`SHARED_DEVICE.md`](SHARED_DEVICE.md). In short: a device authenticates with its own opaque, hashed, rotating credentials and never with `session_token`; existing routes stay person-only so a device is refused by default; the device reads only the Today board DTO with a device audience; a parent elevates with a per-parent tablet PIN (password fallback) for 5 minutes idle / 15 minutes maximum, memory-only on the client; step 2 for an elevated request re-reads the parent's `role`, `family_id` and `token_version`.

## Not-found vs forbidden
Avoid revealing the existence of foreign-family records. Use consistent purpose-appropriate semantics. Tests should verify both status and response body do not leak foreign data.

## Relationship injection
If a request creates/updates a relation (`assigned_to`, `cook_id`, `person_id`, recipe, list, device, etc.), verify that related object belongs to the same household and that the actor may use it.

## Child/teen rules
Do not assume teen equals child forever. Role capability must be explicit per domain and reflected in [`docs/ROLE_AND_ISOLATION_MATRIX.md`](../ROLE_AND_ISOLATION_MATRIX.md) when changed.

The matrix records the per-domain parent/teen/child capability decided on issue #102 (D1–D9). Shared code: `src/lib/role-capabilities.ts` for per-domain capability, `src/lib/kid-access.ts` for which `/dashboard` pages a teen or child may open.

## Current role and household
Step 2 above is implemented in `resolveSession` (`src/lib/session.ts`): one query per request reads `token_version`, `role` and `family_id`. `verifySessionToken`, and therefore `authenticateRequest`, `getServerUser()` and the middleware kid gate, return the database role and family, never the JWT claims.

## Device lifecycle
Shared device authorization needs pairing, revocation, token rotation, last-seen/health visibility and cache-clearing behaviour after revoke. Offline access never grants future refresh after revocation. The proposed pairing, rotation, revocation, purge, audit and rate-limit contract is in [`SHARED_DEVICE.md`](SHARED_DEVICE.md) §4–§11.

## Required tests
Every family-owned domain should have two-family negative tests and role/device tests. Direct API tests are required; browser navigation tests alone are insufficient.

## High-risk stop condition
Any confirmed cross-family read/write is a release/beta stop condition until contained and re-verified.