# ADR-0002: A fridge tablet uses a dedicated shared-device identity/session

**Status:** Accepted at architecture level; implementation contract proposed in ADR-0006 (#157)
**Date:** 2026-09-08
**Related:** #120, #127, #136

## Context
A permanently mounted family tablet is physically shared. Reusing a parent’s normal session would expose parent-only data/controls and make lost-device revocation, attribution and offline caching unsafe.

## Decision
Introduce a dedicated household device identity and revocable shared-device session distinct from human parent/teen/child sessions. The device receives only purpose-limited shared-surface capabilities and fields.

Parent-sensitive actions initiated from the tablet require explicit temporary elevation/re-auth/PIN policy and automatically return to shared mode.

## Alternatives
- Persist parent login: rejected for privacy/security.
- Anonymous household URL/token: rejected because revocation/capability/audit requirements are too weak.
- Separate tablet backend/account system: rejected because it duplicates authorization and household logic.

## Consequences
Requires pairing, token rotation/revocation, capability-aware APIs, cache allowlist and lifecycle UI. Provides safer shared use, clean device management and future kiosk/offline support.

## Security
Device tokens are server-revocable, least-privilege and never equivalent to a parent password/session. Shared cache excludes finance, private messages, addresses, medical notes, account controls and secrets by default.

## Validation
Two-household/device tests, direct API field restrictions, lost-device revoke, offline/reconnect and process-restart tests.

## Revisit trigger
Only if Android platform constraints make the planned device identity impossible without unacceptable reliability/security trade-offs.