# Release & Rollback Runbook

This runbook defines evidence and sequencing. It does not authorize a production release.

## Candidate requirements
Before asking for production approval, record:
- exact Git commit SHA;
- immutable server image/artifact identity;
- Android APK/AAB versionCode/versionName and artifact identity when applicable;
- successful applicable Definition of Done gates;
- migration/backfill plan and rehearsal evidence;
- backup freshness and isolated restore evidence for risky data changes;
- role/two-family negative tests;
- representative UI/device QA;
- known issues and rollback limitations.

## Promotion principle
Promote the exact reviewed artifact. Do not rebuild different code during production promotion.

## Server rollout
1. Confirm approval applies to exact candidate.
2. Confirm prior healthy artifact/rollback target is retained.
3. Confirm DB compatibility with both new and supported old clients.
4. Apply only approved migration sequence.
5. Promote candidate.
6. Verify release identity, health, DB connectivity, logs and core smoke.
7. Verify negative authorization cases using disposable/safe data as approved.
8. Remove disposable QA data.
9. Record outcome.

## Android rollout
Use internal/closed/staged tracks before broad release as planned in #138. Verify install/update from prior supported version, app links, cold/warm start, process restart and server compatibility.

## Halt/rollback triggers
Examples:
- cross-family exposure;
- authentication/session failure;
- destructive data corruption;
- material crash/ANR regression;
- core household mutation failure above release threshold;
- incompatible installed Android client behaviour;
- migration failure or unexpected load.

## Rollback
- Stop rollout/disable feature via approved kill switch when available.
- Roll server to the last healthy compatible artifact when safe.
- Do not automatically roll back database schema/data unless the migration runbook proves it safe.
- For Android, halt staged rollout; server must remain compatible with already-updated and not-yet-updated clients.
- Re-verify health and data integrity after rollback.

## Post-release
Record exact versions, evidence, incidents and follow-up issues. A successful deployment claim requires observed runtime verification, not CI alone.

## Approval boundary
Merge approval, deployment approval and Play production publication are separate approvals.