# Privacy Requirements

## Product principles
- Minimum necessary collection.
- Private household data is not an analytics product.
- Shared-device access is purpose-limited.
- Children/teens receive appropriate data minimization and role boundaries.
- Third-party processors receive only what their approved feature needs.
- Privacy disclosures must match actual code/configuration.

## Engineering requirements
- Maintain `DATA_INVENTORY.md` and processor register.
- Document retention/export/deletion per domain.
- Keep secrets and provider credentials server-side.
- Avoid private content in logs, analytics, crash reports, issue attachments and AI telemetry.
- Provide clear permission/notification/integration explanations before collection/access.
- Revoke provider/device access cleanly.
- Feature flags/kill switches should disable optional processors without breaking core app use where feasible.

## Shared tablet
Do not display/cache detailed finance, private messages, precise addresses, medical notes, account controls, tokens or destructive admin state by default. Screen previews/notifications must avoid sensitive lock-screen content.

## AI
Send only task-relevant authorized context. Prefer structured fields over broad household transcripts. Store cost/latency/outcome metrics without full prompt/response content unless a separately reviewed debugging mechanism explicitly requires temporary access.

## Children/teens
Do not use child/teen experiences for manipulative engagement experiments. Minimize profile/telemetry data. Guardian/role rules must be explicit in authorization and product copy.

## Release review
Before public Play release reconcile:
- Android permissions;
- network/provider data flows;
- analytics/crash SDKs;
- privacy policy text;
- Data Safety answers;
- deletion/export behaviour;
- support/contact process.

Legal/privacy advice may be needed before broad public release; this engineering document does not substitute for jurisdiction-specific legal review.