# Competitive Product Success Criteria

The goal is not to claim “millions-ready” before evidence exists. It is to build a product/architecture/operating system that can grow from family dogfood to a competitive Play Store app without a rewrite.

## Product value
A household should reliably answer from the shared/phone experience:
- what is happening today;
- who needs to be where and when;
- what is for dinner;
- what food should be used soon;
- what needs to be bought;
- what household tasks need attention.

Core actions must remain useful without AI.

## Experience quality
- Glanceable 10–13 inch tablet experience.
- Efficient one-handed phone companion.
- Original, cohesive visual/graphic language.
- Fast perceived response, excellent empty/error/offline/undo states.
- Accessible and localization-ready.
- Android-native lifecycle/back/permission quality.

## Trust
- Zero tolerated cross-household exposure.
- Shared device least privilege/revocation.
- Privacy-safe analytics/logging.
- Clear account export/deletion/recovery.
- No manipulative engagement patterns.

## Reliability
Targets mature with scale, but the system must measure:
- availability and core mutation success;
- p50/p95/p99 latency;
- crash-free/ANR Android health;
- sync replay/conflict rate;
- backup/restore evidence;
- release identity and rollback readiness.

## Growth evidence
Use household-level value/retention, not vanity downloads:
- activation/time to first value;
- 1/7/28-day return;
- weekly active households;
- recurring calendar/grocery/meal/task use;
- tablet days active;
- qualitative coordination-friction improvement;
- willingness to pay before billing implementation.

## Scale posture
Remain a modular monolith while it meets SLOs. Load-test progressively and extract services only after bottlenecks/failure-isolation needs are measured. “Millions” is a capacity/reliability destination, not an MVP infrastructure purchase.

## Store quality
Public Play release requires accurate Data Safety/privacy disclosures, original assets, reliable AAB/signing/update path, policy compliance, support/recovery and representative phone/tablet screenshots matching the actual app.

## Decision rule
Every large roadmap item should answer: does this improve repeated household value, trust, reliability, distribution readiness or measurable growth? If not, defer it.