# Architecture Decision Records

Accepted/proposed ADRs capture decisions that should not be rediscovered by every agent.

- `0001-modular-monolith.md` — keep one modular application/backend until measured extraction triggers.
- `0002-shared-device-session.md` — fridge tablet uses a dedicated revocable shared-device identity/session.
- `0003-design-system-and-adaptive-ui.md` — one Figma-first adaptive design system across phone/tablet.

Use `../ADR_TEMPLATE.md` for new decisions. A new ADR is appropriate when changing canonical data models, auth/device boundaries, offline conflict policy, API compatibility, deployment architecture or another durable cross-cutting contract.