# Family action flow — approved direction, 2026-10-27

Related: #499 (unified UI), #464 (assistant), #450 (routines), #128 (programme).
Cameron approved the competitive critique: reduce choices and connect existing
capabilities before adding more dashboard features. Keep the approved Woven Grove
identity and canonical APIs, role gates, private/shared boundaries and recovery.

## Interaction specification

1. Today has one primary **Add or ask** entry. The same entry remains available
   from the dashboard shell. Controls/configuration stay secondary.
2. A compact shared Dialog offers **Ask assistant**, **Add from a photo** and
   direct manual destinations. Only existing role/feature-authorized destinations
   appear. Photo means existing image capture, not unsupported document formats.
3. Asking leads to the existing text/voice composer first; help/navigation stays
   available in a collapsed disclosure. Existing proposals remain reviewable;
   the UI never treats a proposed write as a saved result.
4. Photo entry opens the existing calendar Capture sheet only after capability
   resolution. An unavailable capability displays a clear explanation and a
   permitted manual fallback. Opening this path must not invoke a provider or
   submit a write by itself.
5. Guided routines show the next incomplete step, progress and completed/waiting
   state. List mode remains available. View choice never changes ownership,
   verification, profile-only permissions or the canonical completion callback.

## Composition and accessibility

Use existing Dialog, typography, surfaces and minimum44px controls. One primary
action per region; secondary help/settings do not displace the composer. Restore
focus on dismissal and preserve pending-work navigation guards. Maintain EN/ES,
long-text wrapping and phone/tablet/desktop layouts. Do not duplicate editable
forms or voice listeners to reposition them.

## Explicit remaining stages

- Recompose Today schedule/attention/dinner hierarchy after rendered comparison;
  this slice changes the action hierarchy, not the full board layout.
- Offer photo/text/voice in one shared review surface rather than destination
  handoff; retain original-owner and idempotency contracts during that work.
- Shared-device assistant: separate paired-device actor/capability contract,
  household-safe read model, reviewed proposals, revocation and role-change
  handling. Do not expose the parent assistant or parent endpoints on /device.
- Native wake listening: explicit microphone state, visible cancellation,
  permissions/lifecycle/offline behavior and physical-device acceptance. Current
  local voice preview is not an always-listening wake assistant.
- Independence settings and custom routine photos remain separate from this
  presentation-only guided/list change.

Competitor documentation informed the principles, not copied layouts or claims
of tested performance: Cozyla CalendarOS release notes, Skylight Sidekick/import
help and Hearth routine help. No merge, production rollout or provider activation
is implied by this interaction specification.
