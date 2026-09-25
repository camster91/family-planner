# Deployment

Family Planner uses GitHub-hosted Actions for validation and controlled production promotion. The production VPS remains the Docker host, but it no longer runs a GitHub Actions runner and it does not build application code during a release.

## Validation

The `Build, Test & Release` workflow runs the required `Build & Test` check for pull requests and default-branch pushes. It installs locked dependencies, runs the application and database checks, builds the production container, and smoke-tests it against an ephemeral PostgreSQL database with synthetic credentials.

Pull requests and ordinary pushes do not receive production credentials and do not deploy.

## Production release

A release is started manually from the repository's default branch through GitHub Actions. The same workflow run:

1. Builds and smoke-tests the exact container image for that commit.
2. Saves the image identity and deployment script as a short-lived workflow artifact.
3. Transfers the image over SSH to the production host using a pinned SSH host key.
4. Verifies that the host loaded the image with the same immutable image ID.
5. Runs `.github/scripts/deploy-vps.sh` to start and health-check the replacement before stopping the current container.

The previous container is retained on the host for recovery. The workflow does not stream application/container logs or health diagnostics into public Actions logs.

## GitHub configuration required

The repository `production` environment must be configured before production releases can run:

- Add environment variables `FP_SSH_HOST`, `FP_SSH_USER`, and optionally `FP_SSH_PORT` (defaults to `22`).
- Add environment secrets `FP_SSH_PRIVATE_KEY` and `FP_SSH_KNOWN_HOSTS`.
- Use a dedicated deploy identity. It needs the existing host permissions required to load and run Docker images and access the persistent upload mount; Docker-group access is privileged.
- Pin the host key in `FP_SSH_KNOWN_HOSTS` for the exact configured host and port. Do not use `ssh-keyscan` at workflow runtime.
- Configure the `production` environment to allow deployments only from the default branch and require a reviewer before secrets are released to the job.

The workflow fails closed if these values are missing or invalid. Do not paste private keys into source files, issues, pull requests, or chat.

## Host requirements

The production host must already have the Docker network, persistent upload storage, and release lock expected by `.github/scripts/deploy-vps.sh`. Keep host setup and application logs private to the host. A failed health check leaves the previous container running; inspect the private host log before retrying a release whose SSH connection was interrupted.

## Paths intentionally removed

The old local SSH release helper and duplicate CI/GHCR image-publishing workflow were removed. There is one canonical CI workflow and one manually triggered production path.

`scripts/webhook-receiver.sh` and `scripts/family-planner-webhook.service` remain in the repository as a legacy, pull-based deploy trigger. They are not the supported production path. Do not install, enable or use them on a production host without Cameron's explicit approval for that exact action. See `docs/engineering/CI_AND_RELEASE.md`.