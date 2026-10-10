# Runbooks

- `RELEASE_AND_ROLLBACK.md`
- `COOLIFY_DEPLOY.md` — existing protected-main Coolify source-build route, verified compose/Dockerfile recipe, health and revision checks, retained database/uploads, and rollback. Preserve the current application; deployment needs task-specific authorization. New setup, configuration changes and future immutable-image promotion require separate approval.
- `INCIDENT_RESPONSE.md`
- `SUPPORT.md` — handling a beta support request: verification or reset email, export and deletion, bug intake, privacy or child-safety escalation, response times (#146)
- `TRANSACTIONAL_EMAIL.md` — Mailgun settings, DNS, verification/reset email tests and deliverability (#103); missing email is a beta launch blocker; production changes need Cameron's approval
- `BACKUPS.md` — daily database backup timer, retention (35 days) and the restore test (#145); installing the timer needs Cameron's approval
- `CALENDAR_SYNC.md` — register the Google/Microsoft OAuth apps, set secrets, verify, revoke and rotate for two-way calendar sync (#264); enabling it in production needs Cameron's approval
- `EVENT_IMPORT.md` — Anthropic workspace, key, spend cap, enabling, privacy and rollback for the review-first event import from text, photo or PDF (#270); enabling it in production needs Cameron's approval
- `MEALS_GROCERIES_BACKFILL.md` — gated production run of the ADR-0007 meal/grocery backfill (#250); needs Cameron's approval for the run
- `INVENTORY_SCAN.md` — enabling, capping and turning off the AI fridge photo scan (#265); enabling needs Cameron's approval

Future runbooks should cover device pairing/revoke, sync outage, auth/recovery, provider/AI degradation and Android bad-release handling as implementations become concrete.