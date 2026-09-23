# Observability Contract

Family Planner must be operable without exposing private household content.

## Structured request context
Target fields:
- request/trace ID;
- release/build identity;
- route/domain;
- status/error code;
- latency;
- pseudonymous actor/device/family identifier only where operationally necessary;
- retry/idempotency outcome where relevant.

Do not log message bodies, child names, exact addresses, medical/finance descriptions, tokens/secrets, arbitrary event text, grocery/food notes or full AI prompts.

## Metrics
Track by domain/release:
- request count/error rate/latency percentiles;
- DB connection/slow-query/timeout signals;
- background queue depth/retry/dead-letter where implemented;
- offline mutation replay/conflict/failure;
- notification provider outcome;
- AI latency/cost/schema/error outcome without prompt content;
- Android crash/ANR/build version;
- backup freshness/restore verification.

## Alerts
Alert on user impact and error budgets, not every transient exception. Define ownership/runbook link and recovery signal for each alert.

## Release markers
Dashboards/logs should make it possible to correlate a regression with exact server/client release identity.

## Privacy review
Every new telemetry field must answer why it is needed, retention, cardinality/cost risk and whether it contains private content. Analytics and operational telemetry have different purposes but share the same data-minimization rule.

## Scale
Observability should reveal objective extraction/scaling triggers from ADR-0001 rather than assume them.