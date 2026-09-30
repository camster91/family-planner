# Runbooks

- `RELEASE_AND_ROLLBACK.md`
- `COOLIFY_DEPLOY.md` — planned Coolify setup (build pack, database, health check, uploads volume, every environment variable, proxy hops, release-commit check, rollback); not the current production path, and setting it up needs Cameron's approval
- `INCIDENT_RESPONSE.md`
- `TRANSACTIONAL_EMAIL.md` — Mailgun settings, DNS, verification/reset email tests and deliverability (#103); missing email is a beta launch blocker; production changes need Cameron's approval
- `BACKUPS.md` — daily database backup timer, retention (35 days) and the restore test (#145); installing the timer needs Cameron's approval
- `CALENDAR_SYNC.md` — register the Google/Microsoft OAuth apps, set secrets, verify, revoke and rotate for two-way calendar sync (#264); enabling it in production needs Cameron's approval
- `EVENT_IMPORT.md` — Anthropic workspace, key, spend cap, enabling, privacy and rollback for the review-first event import from text, photo or PDF (#270); enabling it in production needs Cameron's approval
- `MEALS_GROCERIES_BACKFILL.md` — gated production run of the ADR-0007 meal/grocery backfill (#250); needs Cameron's approval for the run
- `INVENTORY_SCAN.md` — enabling, capping and turning off the AI fridge photo scan (#265); enabling needs Cameron's approval

Future runbooks should cover device pairing/revoke, sync outage, auth/recovery, provider/AI degradation and Android bad-release handling as implementations become concrete.