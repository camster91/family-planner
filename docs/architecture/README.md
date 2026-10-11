# Architecture Index

- `SYSTEM.md`
- `DATA_MODEL.md`
- `MEALS_AND_GROCERIES.md` (ADR-0007 detail, proposed: canonical meal/recipe/grocery models, backfill, recipe → grocery contract, child issues)
- `API_CONTRACTS.md`
- `AUTHORIZATION.md`
- `OFFLINE_SYNC.md`
- `ANDROID.md`
- `CALENDAR_IMPORT.md` (read-only ICS subscriptions, #232)
- `CALENDAR_SYNC.md` (two-way Google/Outlook sync, #264; dormant until configured)
- `SHARED_DEVICE.md` (contract #157; schema/auth/API implemented behind `SHARED_DEVICE_ENABLED`, #240)
- `OBSERVABILITY.md`
- `adr/0009-household-members-and-login-accounts.md` (proposed #480 identity/migration contract; no profile support claim)
- `member-relation-inventory.json` (checked inventory of explicit User relationship owners)
- `adr/README.md`

Durable cross-cutting decisions belong in ADRs. Source code/schema/config remain authoritative for exact current implementation.