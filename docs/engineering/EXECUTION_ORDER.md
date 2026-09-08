# First Build Execution Order

The master roadmap is issue #128. This document gives an agent-friendly first wave; issue dependencies remain authoritative if they change.

## Wave A — make decisions and remove ambiguity
1. Repository agent foundation / source-of-truth cleanup.
2. Current route/component/domain inventory and placeholder-data audit.
3. Canonical meal/recipe/grocery/list data ADR.
4. Shared-device data/session contract.
5. Premium visual reference/Figma direction.
6. Adaptive information architecture and core household flows.

These items may proceed in parallel only where they do not invent competing contracts.

## Wave B — build reusable foundations
1. Code/Figma token alignment and component state system.
2. Responsive/adaptive app shell/navigation.
3. Deterministic two-household seed fixtures.
4. Browser E2E + visual/accessibility harness.
5. Development design-system/state gallery.
6. API/error/idempotency conventions for new work.

## Wave C — first vertical product slice
Refactor the parent/shared Today dashboard around real canonical data:
- schedule;
- tonight meal;
- groceries;
- tasks;
- inventory/use-soon placeholder only until the real inventory domain lands;
- no fake values;
- phone + 1280×800 tablet;
- empty/loading/error/offline states;
- role/shared-device field restrictions;
- E2E/visual/a11y evidence.

## Wave D — shared appliance + inventory loop
1. Device pairing/session/revoke foundation.
2. Android lifecycle/appliance shell.
3. Inventory/expiry schema + API + UI.
4. Offline queue/realtime primitives for approved actions.
5. Meal/ingredient/grocery canonical flow.

## Wave E — intelligence and launch quality
AI, calendar integrations, capture automation, notifications, Play Store packaging, observability/load testing, analytics and beta work follow their roadmap gates.

## Agent selection rule
Only pick an issue whose prerequisites are resolved. If an issue is too broad for one reviewable PR, split it before implementation. Use `docs/engineering/AGENT_WORKFLOW.md` and `DEFINITION_OF_DONE.md`.