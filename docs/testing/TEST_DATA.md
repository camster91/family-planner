# Test Data & Seed Contract

The repository needs deterministic, synthetic fixtures so agents can build/test without private family data.

## Required households
Create at least two clearly fake households (`fixture-family-a`, `fixture-family-b`) with stable synthetic identities.

Each should include:
- one parent;
- one teen;
- one child;
- optional paired shared device fixture;
- calendar events across today/tomorrow/week and DST/timezone edges;
- pending/completed/verified chores;
- rewards;
- grocery/list data;
- meal/recipe data using whichever models #134 declares canonical;
- inventory/use-soon data once implemented;
- empty-state variants.

## Security fixtures
Include stable foreign IDs so tests can deliberately attempt family A -> family B reads/writes and relationship injection.

## UX fixtures
Provide deterministic scenarios such as:
- empty new household;
- busy school/work morning;
- evening dinner/use-soon/grocery state;
- long names/titles/translated strings;
- offline/pending/conflict UI mock data;
- parent-only content that must never appear in shared-device fixtures.

## Rules
- Never seed real names, emails, addresses, medications, messages or other private data from production.
- Fixture IDs/data should be repeatable enough for snapshots/E2E.
- Seed command should be safe for a dedicated development/test DB and refuse obvious production environments.
- Re-running should be idempotent or reset only a clearly fixture-owned dataset.
- Avoid using `prisma db push` as a hidden production migration strategy.

## Target commands
Implementation issue should introduce documented commands similar to:
```bash
npm run db:seed:test
npm run test:e2e
```
Exact implementation belongs in an agent issue; this document defines the contract.

## Acceptance for seed implementation
- two-household isolation fixtures exist;
- one command creates/reconciles fixtures;
- command refuses production-like target;
- E2E can authenticate/use fixtures without manual DB edits;
- visual snapshots are deterministic;
- no production data dependency.