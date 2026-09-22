# Incident Response

## Severity examples
**SEV0/P0:** confirmed cross-household exposure, widespread account compromise, destructive integrity loss.
**SEV1/P1:** authentication outage, core mutations unusable, major Android release regression, widespread sync corruption.
**SEV2:** degraded non-core integration/AI/notification feature with safe fallback.

## Response loop
1. Detect and preserve evidence without copying unnecessary private content.
2. Classify severity and affected release/domain.
3. Contain: feature kill switch, revoke credentials/device sessions, halt rollout or isolate provider as appropriate.
4. Verify containment with objective tests.
5. Recover using tested rollback/restore/reconciliation steps.
6. Verify user-facing integrity/security after recovery.
7. Decide required user/external communication with the authorized owner; do not send autonomously.
8. Create follow-up issues and a blameless technical review.

## Cross-household exposure
Immediate stop condition:
- halt affected rollout/beta path;
- disable vulnerable capability where possible;
- determine read vs write exposure and affected domain/time window;
- preserve relevant request/release/audit evidence;
- fix authorization root cause;
- expand two-household tests;
- re-run route/domain matrix before resuming.

## Lost/stolen shared device
- parent/operator identifies device;
- revoke device session/token;
- next network contact must prevent refresh and clear protected cache;
- verify no parent reusable credentials were stored;
- pair replacement device through approved flow.

## Provider incident
Core product should degrade gracefully. Disable provider-dependent feature if necessary; do not let calendar/weather/AI/notification outage take down core household functions.

## Android bad release
- halt staged rollout;
- confirm server compatibility with both affected and prior clients;
- use server/feature mitigation when possible because Play client rollback is not instantaneous;
- prepare corrected signed build after review.

## Evidence hygiene
Operational logs/notes should use request IDs, family/user pseudonymous identifiers and release identities. Avoid copying message bodies, child names, addresses, medical/finance details, tokens or secrets into GitHub.

## Approval boundary
Incident analysis/containment planning can be prepared by agents, but production access/credential changes, account modifications, public communication and destructive data actions require appropriate explicit approval unless an established emergency mechanism already authorizes that exact action.