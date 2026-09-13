# ADR-0001: Keep Family Planner as a modular monolith until measured extraction triggers exist

**Status:** Accepted
**Date:** 2026-09-08
**Related:** #128, #134, #137

## Context
Family Planner already has one Next.js/PostgreSQL/Prisma backend and many household domains. The new tablet, offline, AI and scale roadmap increases complexity, but prematurely splitting into microservices would add distributed transactions, deployment, observability and consistency costs before traffic requires them.

## Decision
Keep one primary application/backend and database while enforcing domain boundaries in code/contracts. Extract background/provider-heavy domains only when objective load, failure-isolation, security or organizational triggers justify it.

## Alternatives
- Immediate microservices: rejected as premature complexity.
- Separate tablet backend: rejected because it would duplicate household/auth/data rules.

## Consequences
Positive: simpler transactions, local development, migration and release; shared authorization model; faster vertical product work.

Risk: domain boundaries can decay inside one codebase. Mitigate with architecture docs, service/domain layers where useful, canonical APIs and issue/PR review.

## Extraction triggers
Examples include realtime/notification/AI/media workloads materially degrading core API SLOs, independent security/runtime needs, or evidence that a domain needs separate scaling/failure isolation.

## Validation
#134 should produce domain boundaries/query/load evidence. #137 should identify capacity bottlenecks before extraction.

## Revisit trigger
Measured SLO/capacity/security evidence shows a specific domain cannot meet requirements within the modular monolith at reasonable operational cost.