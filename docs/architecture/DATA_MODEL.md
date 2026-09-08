# Data Model Policy

`prisma/schema.prisma` is authoritative for what exists today. This document defines how new work should treat it while #134/#143 canonicalize overlapping legacy/consolidated models.

## Ownership rule
Every private household-domain record must be traceable to exactly one household. Prefer an explicit `family_id` on high-value domain tables when it improves authorization/query safety; nested ownership must still be provable server-side.

## Current canonical decisions
- `User`/`Family` remain the identity/household foundation.
- Existing auth/family systems must be extended, not duplicated for the fridge tablet.
- `Event` remains the existing calendar foundation until a versioned migration says otherwise.
- Existing chore/task/reward models remain in place during vertical migration.

## Models requiring canonicalization before broad new writes
The repository contains overlapping generations of meal/list concepts, including older `FamilyMeal` / generic `List` + `ListItem` paths and newer recipe/meal-plan/shopping models. #134/#143 must record which models are canonical for:
- meal planning;
- recipes/ingredients;
- groceries/shopping;
- legacy import compatibility.

Do not create another parallel model to avoid this decision.

## Planned new domains
Subject to ADR/schema review:
- shared devices/sessions/preferences;
- food inventory/locations/adjustments/expiry observations;
- sync mutations/conflict metadata;
- AI suggestions/action proposals;
- integration connections;
- leftovers only after MVP evidence.

## Schema requirements
For new/changed models consider:
- household ownership and indexes;
- creator/actor where auditability matters;
- `created_at`/`updated_at` server timestamps;
- version/concurrency field for collaborative edits when needed;
- idempotency key for retryable user-visible mutations;
- soft-delete/tombstone only where offline/recovery semantics require it;
- uniqueness rules scoped correctly to household;
- explicit delete/cascade/restrict behaviour;
- retention/deletion/export requirements.

## Migration policy
Installed clients may be old. Prefer expand -> backfill -> dual-compatible read/write if needed -> switch -> contract after supported clients are clear. Backfills must be resumable/idempotent and observable. Never assume rolling back app code means database rollback is safe.

## Test fixtures
Developer/test seed data must include two households and foreign-ID cases so isolation is easy to prove.

## ADR requirement
Any change that replaces a canonical model, introduces dual writes, materially changes ownership, or breaks old clients requires an ADR in `docs/architecture/adr/` plus migration/rollback evidence.