# Deployment

Family Planner uses GitHub-hosted Actions for validation and controlled production promotion. The production VPS remains the Docker host, but it no longer runs a GitHub Actions runner and it does not build application code during a release.

## Validation

The `Build, Test & Release` workflow (`.github/workflows/release.yml`) runs the required `Build & Test` check on a GitHub-hosted runner for pull requests, `main`/`master` pushes and manual dispatch. It installs locked dependencies, runs the application and database checks, builds the production container, and smoke-tests it against an ephemeral PostgreSQL database with synthetic credentials.

Pull requests and ordinary pushes do not receive production credentials and do not deploy.

## Production release

A release is started manually from the repository's default branch through GitHub Actions. The same workflow run:

1. Builds and smoke-tests the exact container image for that commit.
2. Saves the image identity and deployment script as a short-lived workflow artifact.
3. Transfers the image over SSH to the production host using a pinned SSH host key.
4. Verifies that the host loaded the image with the same immutable image ID.
5. Runs `.github/scripts/deploy-vps.sh` to start and health-check the replacement before stopping the current container.

The previous container is retained on the host for recovery; see `docs/runbooks/RELEASE_AND_ROLLBACK.md`. The workflow does not stream application/container logs or health diagnostics into public Actions logs.

## GitHub configuration required

The repository `production` environment must be configured before production releases can run:

- Add environment variables `FP_SSH_HOST`, `FP_SSH_USER`, and optionally `FP_SSH_PORT` (defaults to `22`).
- Add environment secrets `FP_SSH_PRIVATE_KEY` and `FP_SSH_KNOWN_HOSTS`.
- Use a dedicated deploy identity. It needs the existing host permissions required to load and run Docker images and access the persistent upload mount; Docker-group access is privileged.
- Pin the host key in `FP_SSH_KNOWN_HOSTS` for the exact configured host and port. Do not use `ssh-keyscan` at workflow runtime.
- Configure the `production` environment to allow deployments only from the default branch and require a reviewer before secrets are released to the job.

The workflow fails closed if these values are missing or invalid. Do not paste private keys into source files, issues, pull requests, or chat.

## Container runtime

The production image is built from `Dockerfile` (Node 22 Alpine, Next.js standalone output). On start, `docker-entrypoint.sh` runs `scripts/migrate.js` when `DATABASE_URL` is set, then starts the server. The migration is idempotent: it creates the database if missing, creates/alters tables, and applies every `database/migration-*.sql` file in order. There is no separate migration step in the release workflow. The container health check calls `/api/health`.

Runtime configuration is documented in `.env.production.example` (`DATABASE_URL`, `JWT_SECRET`, `NEXT_PUBLIC_APP_URL`, `MAILGUN_*`, `CRON_SECRET`, `MIGRATE_FALLBACK_DB`) and in the README environment table (including `TRUSTED_PROXY_HOPS`, `UPLOAD_DIR` and the optional `CAPTURE_AI_*` fallback). `.github/scripts/deploy-vps.sh` does not take configuration from GitHub: the replacement container inherits the environment of the container it replaces, and mounts the host upload directory at `/data/family-planner-uploads`. `NEXT_PUBLIC_*` values are inlined by Next.js at build time (the `Dockerfile` defaults `NEXT_PUBLIC_APP_URL` to the production URL), so changing them needs a new image. Changing production values is an owner-controlled action under `AGENTS.md`.

`docker-compose.yml` is for local, self-contained runs only and is not used by the release.

## Host requirements

The production host must already have the Docker network, persistent upload storage, and release lock expected by `.github/scripts/deploy-vps.sh`. Keep host setup and application logs private to the host. A failed health check leaves the previous container running; inspect the private host log before retrying a release whose SSH connection was interrupted.

## Paths intentionally removed

The old local SSH release helper and duplicate CI/GHCR image-publishing workflow were removed. There is one canonical CI workflow and one manually triggered production path. Coolify, Vercel, GHCR publication and Supabase are not part of the current deployment.

`scripts/webhook-receiver.sh` and `scripts/family-planner-webhook.service` remain in the repository as a legacy, pull-based deploy trigger. They are not the supported production path. Do not install, enable or use them on a production host without Cameron's explicit approval for that exact action. See `docs/engineering/CI_AND_RELEASE.md`.