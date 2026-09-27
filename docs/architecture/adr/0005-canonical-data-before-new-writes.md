# ADR-0005: Canonicalize overlapping meal/list models before broad new cross-domain writes

**Status:** Accepted as a migration constraint. The "exact canonical models pending" clause is superseded by [ADR-0007](0007-canonical-meal-recipe-grocery-models.md) (Accepted 2026-09-27), which names the canonical models. New cross-domain writes follow ADR-0007.
**Date:** 2026-09-08
**Related:** #122, #134, #143

## Context
Family Planner contains legacy/consolidated meal and list generations. The fridge roadmap connects inventory -> meal -> missing ingredients -> groceries. Building that flow against ambiguous models risks dual-write divergence and another migration later.

## Decision
Before the new end-to-end meal/grocery flow is implemented broadly, document which existing models become canonical and how legacy API/UI/import paths transition. Do not create a third model generation.

## Required decision output
- canonical meal-plan/recipe/ingredient models;
- canonical grocery/list models;
- compatibility adapter/import role for legacy models;
- read/write cutover sequence;
- duplicate/provenance handling;
- migration/backfill/rollback limitations;
- old-client compatibility.

## Validation
Counts/fixtures and core old/new journeys reconcile on review/test DB, with no competing production write paths after cutover.

## Revisit trigger
Only if source inspection proves the perceived overlap is not semantically conflicting.