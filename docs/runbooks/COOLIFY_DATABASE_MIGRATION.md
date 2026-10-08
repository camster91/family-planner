# PostgreSQL consolidation into Coolify

Supports #342, #145 and #128. This runbook prepares the existing single backend's
database move. It does not authorize merge, a live connection/credential change,
deployment, a new scheduler or removal of the original database.

## Network preparation

`docker-compose.coolify-development.json` connects the app to both its existing
`family-planner-internal` network and the existing `coolify` network. The first
keeps the original PostgreSQL connection and rollback available; the second
allows the native Coolify database UUID to resolve after an approved deployment.
No network is created, proxy setting edited or database URL changed by the file.
The upload bind, environment file, image build and public routing are preserved.

Validate without reading secret environment values:

```sh
docker compose -f docker-compose.coolify-development.json \
  config --no-env-resolution --no-interpolate --no-path-resolution -q
```

Adding a Coolify destination for the old network is a different operation:
the installed destination model also connects the shared proxy. That option
requires the consolidation plan's separate shared-proxy authorization.

## Verified recovery candidate — October 3, 2026 UTC

The live database is `family-planner-postgres`, with volume
`family-planner-postgres-data`. The private native Coolify copy is
`si3dssp9qjm9xfg1mtuqvwfn`, with separate volume
`postgres-data-si3dssp9qjm9xfg1mtuqvwfn`, synthetic credentials and no public port.
It is a snapshot, not a continuously synchronized replica.

A consistent source snapshot independently restored all 63 public-table hashes
and 12 saved rows. Global roles remain privately backed up and original image
filesystem layers retained. A pinned PostgreSQL 16.14 registry image passed the
same restore. The private native resource is healthy; all 63 hashes survived an
actual native container recreation, after its own independent backup restore
and retained-image checks.

The previously checked image, `c36c0acb0679186a1dfdf456b2a891d937f99909`, passed
full isolated startup/migrations, public health/login/register pages, fixture
registration, unverified-account rejection, real verification-token consumption,
wrong-password rejection, login, protected session cookies, CSRF and cross-origin
rejection, two-household reads, cross-household mutation rejection, persisted
household updates, chore listing and authenticated Today rendering. Test accounts
and token seeding existed only in a disposable restored database. The app and
database ran on an internal-only network without published ports, provider
credentials or production secrets; all fixtures were removed. Mail delivery,
phone password-manager behaviour, browser rendering, Android and every optional
integration are not proven by these HTTP checks.

During preparation, main advanced to
`a00d29d896e03effa38ef2f8f5064ebfc3eca5ae`, including additive schema and workflow
changes. The preceding image checks and database snapshot remain historical
recovery evidence. Recheck the current image and schema on a fresh restored copy
before cutover; do not describe the earlier private database copy as synchronized.

The private copy must not be substituted for live data merely because those
checks pass. All original volumes remain; the candidate adds one volume.

## Before the live switch

1. Revalidate main, the actually deployed image/revision, live database consumers,
   uploads, health and capacity. Follow `AGENTS.md`'s exact-action approval gates.
2. Pass normal PR CI, obtain merge/deployment approval, then verify the additive
   network change on the running app. A Compose parser pass alone does not prove
   live DNS/TCP/authenticated connectivity.
3. Prepare a single-writer window for this app only. Make a fresh consistent
   source backup, independently restore it and retain the preceding app/database
   images. Preserve current user/account records, database roles/grants, upload
   storage and connection options. The candidate's synthetic credentials do not
   authorize rotating or replacing production credentials.
4. Review the existing host deployment webhook and backup scripts. The repository
   backup script requires explicit `DB_CONTAINER`, `DB_USER` and `DB_NAME`.
   Neither the repository backup timer nor service was installed in the checked
   host state; do not create a scheduler without its separate approval. Ensure
   future deployment/recovery backups target the accepted database rather than
   the obsolete source.
5. Apply only the explicitly approved live connection and deployment changes.
   Keep any shared proxy, DNS, firewall or access changes behind their own gate.
6. Verify HTTPS, expected revision, login/household authorization, saved data,
   uploads and essential workflows. Observe a signed main event, its successful
   Coolify job and matching deployed SHA before claiming automatic deployment.
7. Retire the original container only after destination/data/domain/rollback
   acceptance. Never delete its volume or the verified rollback image.

## Rollback and recovery

Before new writes, an approved connection rollback can use the preserved original
database network and original credential/configuration receipt. Once writes have
occurred on the new database, do not reconnect a stale source copy: stop only this
app's writer, back up the new accepted state, and restore/reconcile data through
an approved rollback procedure. Rehearse the preceding app version on a copy first.

Source recovery:
`/opt/retired-deployments/family-postgres-migration-20261003T041101496828Z`.
Private candidate recreation recovery:
`/opt/retired-deployments/family-postgres-candidate-predeploy-20261003T042831411313Z`.
Full isolated runtime proof:
`/opt/retired-deployments/family-app-db-qualification-20261003T044307437726Z`.
Dump/role/inspection contents and credentials remain private on the VPS. Do not
include them in issue comments, PR bodies, logs or Git commits.
