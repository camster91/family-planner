# Legacy application migration rehearsal

## Source inventory

The approved source repositories are archived on GitHub and retained locally
for reference:

| Source       | Local data evidence                                                       | Production cutover state |
| ------------ | ------------------------------------------------------------------------- | ------------------------ |
| ChoreChamps  | Application/schema retained; no approved database dump is in the checkout | Awaiting owner export    |
| Meal Planner | `prisma/dev.db` inspected; all application tables contain zero rows       | No records to migrate    |
| Budget App   | Application/schema retained; no approved database dump is in the checkout | Awaiting owner export    |

Archived repositories are not proof that production data was migrated. The
Family Planner rehearsal therefore uses versioned, representative exports that
exercise every supported destination model while real source exports remain
unavailable.

## Automated rehearsal contract

The Ashbi gate runs
`src/lib/imports/__tests__/persistence.integration.test.ts` against its
disposable migrated PostgreSQL database. For each source it:

1. validates and normalizes the complete representative export;
2. supplies explicit source-to-Family-Planner identity mappings;
3. persists the import transactionally;
4. repeats the same import and requires every record to be reused;
5. requires zero rejected relationships;
6. reconciles unique `ImportedRecord` provenance and completed `ImportJob`
   records.

Expected reconciliation:

| Source       | Unique provenance records | Completed jobs | Second-run behavior  |
| ------------ | ------------------------- | -------------- | -------------------- |
| ChoreChamps  | 9                         | 2              | 9 reused, 0 created  |
| Meal Planner | 7                         | 2              | 7 reused, 0 created  |
| Budget App   | 14                        | 2              | 14 reused, 0 created |

Budget App's 14 records include three native records and all 11 advanced
finance model types preserved losslessly in `FinancialArchiveRecord`.

## Real-export cutover

When an approved ChoreChamps or Budget App export becomes available, do not
write production immediately. Record its SHA-256 checksum, run the importer in
dry-run mode against staging, resolve every identity mapping and skipped record,
then persist into an isolated restored copy of Family Planner. Counts must match
the source inventory and a second run must create zero records. Production
cutover still requires an exact pre-deployment backup and separate approval.
