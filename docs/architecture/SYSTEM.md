# System Architecture

## Direction
Family Planner should evolve as a modular monolith first. Keep one deployable product/backend while enforcing clear domain boundaries. Extract services only when measured scale/reliability needs justify distributed-system cost.

## Primary surfaces
- Android fridge/wall tablet via Capacitor
- Android/phone responsive companion surface
- Browser/support/admin surface

All surfaces use the same canonical household APIs and authorization model.

## Major domains
1. Identity/authentication
2. Household/membership/roles
3. Shared devices/sessions
4. Calendar/events
5. Tasks/chores/rewards
6. Lists/groceries
7. Meals/recipes
8. Inventory/expiry
9. Notifications
10. Integrations
11. AI orchestration
12. Analytics/audit
13. Billing/entitlements only after validation

## Rules
- Domain code should own its validation/business rules rather than spreading them across components.
- API handlers stay thin: authenticate, validate, call domain/service, map response/errors.
- Components consume stable DTOs rather than Prisma records directly when a reusable boundary is warranted.
- Background work must be idempotent/retryable.
- Provider adapters isolate third-party APIs from core workflows.
- Feature flags protect incomplete/risky capabilities.
- No device-specific database fork.

## Scaling triggers
Document evidence before extracting a service. Examples:
- notification fanout or AI workloads materially interfere with core API latency;
- realtime connection workload requires independent scaling;
- media processing has different runtime/security constraints;
- a domain needs independent failure isolation or data residency.

## Deployment topology
Current deployment uses the existing web/API application, PostgreSQL and Docker/Coolify path. Exact production topology must be freshly verified before operational changes.

## Observability
Every request should eventually support request/trace identity, structured error codes and release/build identity. Private household content must not be required to operate the platform.

## Related
- #134 platform architecture
- #135 sync/offline
- #136 security/privacy
- #137 reliability/scale
- `API_CONTRACTS.md`, `DATA_MODEL.md`, `AUTHORIZATION.md`, `OFFLINE_SYNC.md`, `ANDROID.md`