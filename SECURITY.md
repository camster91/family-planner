# Security

Family Planner contains private household data and supports children/teens and shared devices. Security and privacy are release requirements.

## Report/security work
For repository work, link findings to the appropriate security issue without posting secrets, real participant data, private household content or exploit credentials. High-risk issues should be treated as P0/P1 and connected to #102/#136.

## Engineering principles
- Authorize by authenticated identity/role/device and household ownership on the server.
- UI hiding is never authorization.
- Reject foreign-family IDs and relationship injection.
- Validate every mutation input.
- Keep secrets server-side.
- Use secure session/cookie/header practices and appropriate CSRF/rate-limit controls.
- Uploaded/media access must be authenticated/authorized where private.
- Shared-device caches are allowlisted and exclude sensitive parent-only domains.
- Device sessions must be revocable and rotated.
- Retry/offline mutation tokens must not permit replay outside their authorized scope.
- Analytics/logs must avoid private content.
- AI/tool context must use least-privilege retrieval and typed action validation.

## Required negative testing
New family-owned domains should include at least:
- family A cannot read/write family B records;
- child/teen cannot reach parent-only operations;
- shared-device mode cannot fetch prohibited fields;
- foreign related IDs are rejected;
- stale/revoked sessions fail closed;
- direct API calls cannot bypass UI gates.

## Sensitive shared-surface exclusions
Unless a separately reviewed feature intentionally elevates access, shared tablet surfaces must exclude finance details, private messages, exact addresses, medical notes, account/security controls, tokens, secrets and destructive admin actions.

## Incident stop condition
Any confirmed cross-household exposure is a stop condition for beta/release until contained, investigated and re-verified. Follow `docs/runbooks/INCIDENT_RESPONSE.md`.

## Dependencies/integrations
A new third-party integration requires a data-flow/privacy/security review before production credentials are added. Keep provider failure isolated from core household functionality.

## Approval boundary
Normal repository work does not authorize production credential rotation, access/permission changes, incident communication, account modification or production data deletion without explicit approval.