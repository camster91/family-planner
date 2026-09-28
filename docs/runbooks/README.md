# Runbooks

- `RELEASE_AND_ROLLBACK.md`
- `INCIDENT_RESPONSE.md`
- `CALENDAR_SYNC.md` — register the Google/Microsoft OAuth apps, set secrets, verify, revoke and rotate for two-way calendar sync (#264); enabling it in production needs Cameron's approval
- `EVENT_IMPORT.md` — Anthropic workspace, key, spend cap, enabling, privacy and rollback for the review-first event import from text, photo or PDF (#270); enabling it in production needs Cameron's approval
- `MEALS_GROCERIES_BACKFILL.md` — gated production run of the ADR-0007 meal/grocery backfill (#250); needs Cameron's approval for the run
- `INVENTORY_SCAN.md` — enabling, capping and turning off the AI fridge photo scan (#265); enabling needs Cameron's approval

Future runbooks should cover device pairing/revoke, sync outage, auth/recovery, backup/restore, provider/AI degradation and Android bad-release handling as implementations become concrete.