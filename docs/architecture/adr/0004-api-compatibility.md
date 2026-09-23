# ADR-0004: Server changes must preserve a supported installed Android client window

**Status:** Accepted
**Date:** 2026-09-08
**Related:** #134, #138, #145

## Context
Web clients can update with the server, but Play-distributed Android builds can remain installed for days or months. Breaking APIs/database assumptions can strand households even when the server deploy succeeds.

## Decision
Treat Android-facing API contracts as version-compatible product contracts. Prefer additive fields/routes and expand/contract migrations. Define a supported old-client window before public release and test at least the previous supported client against new server candidates.

## Consequences
Server releases may need compatibility adapters/feature flags. Schema contraction happens later than feature rollout. VersionCode/versionName and build identity become operational inputs.

## Validation
CI/release tests include old-client contract fixtures or actual prior Android build smoke where risk warrants it.

## Revisit trigger
A future explicit versioned public API strategy supersedes this compatibility mechanism.