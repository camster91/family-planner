# Architecture Decision Records

Accepted/proposed ADRs capture decisions that should not be rediscovered by every agent.

- `0001-modular-monolith.md` — keep one modular application/backend until measured extraction triggers.
- `0002-shared-device-session.md` — fridge tablet uses a dedicated revocable shared-device identity/session.
- `0003-design-system-and-adaptive-ui.md` — one Figma-first adaptive design system across phone/tablet.
- `0004-api-compatibility.md` — server changes preserve a supported installed Android client window.
- `0005-canonical-data-before-new-writes.md` — canonicalize overlapping meal/list models before broad new writes.
- `0006-shared-device-session-contract.md` — (Proposed) shared-device pairing, token rotation, elevation and revocation contract for ADR-0002.

Use `../ADR_TEMPLATE.md` for new decisions. A new ADR is appropriate when changing canonical data models, auth/device boundaries, offline conflict policy, API compatibility, deployment architecture or another durable cross-cutting contract.