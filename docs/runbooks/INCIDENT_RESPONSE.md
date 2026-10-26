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

## Communication and coverage definitions

Use [SUPPORT.md](SUPPORT.md#public-status-and-communication-strategy--defined-2026-10-24)
for approved-channel planning, severity-based draft/update targets, publication
readiness and support scaling triggers. Those definitions do not establish a
live status surface, staffing, sent notices or actual incident/recovery evidence.
External communication and production actions retain the approval boundary above.


## Credential rotation decision and recovery — defined 2026-10-25

Cameron owns the incident/containment decision; the explicitly authorized operator owns the exact production change. Agents may prepare the affected credential-class inventory and a bounded recovery proposal. This runbook does not grant live access, rotation, account/device mutation or an emergency exception beyond an already established mechanism for that exact action.

1. Record confirmed exposure versus suspicion, affected credential classes, services, release/time window and a content-minimal reason for containment. Separate person sessions, shared-device sessions, provider access/refresh credentials, signing material and data-encryption keys; replacing one does not prove the others were revoked.
2. Preserve the minimum existing evidence safely before disruptive changes where feasible, without delaying authorized containment. Identify the change owner, exact scope, dependent clients/queues/integrations and a usable recovery path. Never put key values, session tokens, raw request bodies or private household content in GitHub, logs, prompts or the change packet.
3. For encrypted integration state, follow the existing domain runbook (for example [CALENDAR_SYNC.md](CALENDAR_SYNC.md)). Preserve the protected ciphertext/key-version mapping and authorized recovery backup. Do not replace an encryption key and assume old ciphertext remains readable; review any required migration or reconnect path separately. Backup/restore and migration evidence must refer to the actual candidate.
4. Prepare private replacement/revocation steps, original-session invalidation, feature pause/manual fallback and affected-device recovery. Cameron approves the exact operational scope before execution. Generate/store replacements only in the approved secret system; record credential class/version/change receipt, never values. A rollback must not re-enable a known compromised credential.
5. After an authorized rotation, prove the intended old credentials fail, current authorized paths recover and household/role/device boundaries still hold. Check existing queued/unknown work without renewing old owner generations or silently re-keying it. Offline copies cannot be assumed erased immediately; protected cache invalidation at next contact and actual device behavior need their own evidence.
6. Keep incident status open until the operator supplies scoped containment/recovery results and unresolved limits. A configuration save, process restart or healthy endpoint alone is insufficient. No rotation, probe or drill is executed by writing this definition.

## User notification decision record — defined 2026-10-25

Use the existing [support communication strategy](SUPPORT.md#public-status-and-communication-strategy--defined-2026-10-24). Cameron records the decision owner/time, confirmed impact and unknowns, potentially affected audience, safe user action, selected private/public/provider channel, review responsibility and next reassessment. Seek appropriate specialist advice for any legal/contractual notification assessment; this runbook invents no legal deadline or automatic notice obligation.

A suspected incident is not automatically a public exposure claim. Record both a decision to notify and a decision to wait for more facts, with the reason and next review. Minimize any affected-user list and keep it in the existing protected support workflow; do not infer consent or reveal account existence, child details or specific households in a public status update. The exact content/audience/send action still needs Cameron's approval. Existing verification/recovery email delivery is not incident-mail authorization. Prepare drafts only until that authorization exists; preserve the actual send/publication receipt separately if later performed.

## Evidence preservation and handoff — defined 2026-10-25

The incident commander maintains a private evidence index and a redacted engineering timeline. Capture UTC observation/change times, request IDs, release/source/image identities, relevant configuration names/versions, affected domain/route, read-versus-write uncertainty and approved containment/change receipts. Record the origin, collector, storage location, access owner and transfer times for each artifact; retain original artifacts and identify later redactions/copies separately. Where an artifact digest is appropriate, keep the digest with its index entry; it does not prove the interpretation of its contents.

Use existing protected storage and least-privilege access. Do not collect full exports, raw payloads, screenshots or fresh household content by default. If specific sensitive forensic material is necessary, obtain exact scoped authority and record purpose/access/retention privately; never attach it to a public issue. Preserve existing relevant logs/backups within authorized scope without modifying production retention or deleting records merely to tidy the incident. The owner sets a case review/retention decision under the existing policy; no new retention duration or automatic destruction is introduced here.

At handoff, name the receiving owner, artifact locations, confirmed facts, hypotheses, missing evidence, actions taken versus only proposed, recovery limits and next decision. Require acknowledgement of custody/ownership. Leave the incident and affected release gate open when evidence or an authorized operator is missing. The definition satisfies documentation scope only; actual containment, credential rotation, user communication, restoration and evidence-handling drills remain unperformed and unverified under #136/#146/#377.
