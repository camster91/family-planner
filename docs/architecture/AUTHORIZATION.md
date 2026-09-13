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

## Not-found vs forbidden
Avoid revealing the existence of foreign-family records. Use consistent purpose-appropriate semantics. Tests should verify both status and response body do not leak foreign data.

## Relationship injection
If a request creates/updates a relation (`assigned_to`, `cook_id`, `person_id`, recipe, list, device, etc.), verify that related object belongs to the same household and that the actor may use it.

## Child/teen rules
Do not assume teen equals child forever. Role capability must be explicit per domain and reflected in `docs/ROLE_AND_ISOLATION_MATRIX.md` when changed.

## Device lifecycle
Shared device authorization needs pairing, revocation, token rotation, last-seen/health visibility and cache-clearing behaviour after revoke. Offline access never grants future refresh after revocation.

## Required tests
Every family-owned domain should have two-family negative tests and role/device tests. Direct API tests are required; browser navigation tests alone are insufficient.

## High-risk stop condition
Any confirmed cross-family read/write is a release/beta stop condition until contained and re-verified.