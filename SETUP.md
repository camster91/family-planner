# Family Planner - Local Setup

This guide covers a local development checkout. Production deployment is documented in [DEPLOYMENT.md](DEPLOYMENT.md). Exact versions and scripts are defined in `package.json`; if this guide disagrees with executable source, the source wins.

## Prerequisites

- **Node.js 22** (pinned in `.nvmrc`; `package.json` engines require node >= 22 and npm >= 10). The fixture commands need Node 22.18 or newer.
- **Docker** with Compose, for the local PostgreSQL 17 database (or any PostgreSQL 17 you control).
- **Git**.

## 1. Clone and install

```bash
git clone https://github.com/camster91/family-planner.git
cd family-planner
nvm use        # reads .nvmrc
npm ci         # installs exactly what package-lock.json records (same as CI)
```

`setup.sh` / `setup.bat` perform the install and create `.env.local` for you.

## 2. Start PostgreSQL

`docker-compose.yml` reads `.env`. It refuses to start unless `POSTGRES_PASSWORD`, `DATABASE_URL` and `JWT_SECRET` are set.

```bash
cp .env.example .env
# Edit .env:
#   POSTGRES_PASSWORD=<openssl rand -hex 16>
#   DATABASE_URL=postgresql://family_planner:<POSTGRES_PASSWORD>@postgres:5432/family_planner
#   JWT_SECRET=<openssl rand -hex 32>
docker compose up -d postgres
```

The database is published on `127.0.0.1:5432` only. The `DATABASE_URL` in `.env` uses the `postgres` service host, which is what the `app` container needs.

If you have an old `postgres_data` volume from the previous `postgres:16` image, PostgreSQL 17 cannot open it; dump/restore it or remove the throwaway volume first (see the note in `docker-compose.yml`).

## 3. Point the host-side app at the database

When you run Next.js on your machine (not in the `app` container), it must reach the database via `localhost`. Next.js loads `.env.local` over `.env`:

```env
# .env.local
DATABASE_URL=postgresql://family_planner:<POSTGRES_PASSWORD>@localhost:5432/family_planner_dev
JWT_SECRET=<at least 32 characters>
NEXT_PUBLIC_APP_URL=http://localhost:3000
```

A database name containing `dev` keeps it clearly separate and is accepted by the fixture guard. See `.env.example` and the README environment table for optional variables.

## 4. Create the schema

The schema is applied by `scripts/migrate.js`, the same idempotent script the production container runs at start (via `docker-entrypoint.sh`). It creates the database if missing, creates/alters tables, then applies every `database/migration-*.sql` file in order.

`scripts/migrate.js`, the Prisma CLI and the fixture commands do **not** read `.env` files, so export `DATABASE_URL` in your shell:

```bash
export DATABASE_URL=postgresql://family_planner:<POSTGRES_PASSWORD>@localhost:5432/family_planner_dev
node scripts/migrate.js
npx prisma generate
```

Do not use `prisma db push` as a migration path. Schema changes must update `prisma/schema.prisma` and `scripts/migrate.js` (or a new idempotent `database/migration-*.sql`) together; see the header of `scripts/migrate.js`.

## 5. Optional: load fixture households

```bash
FIXTURES_ALLOW=1 npm run fixtures:seed    # idempotent
FIXTURES_ALLOW=1 npm run fixtures:reset   # removes fixture-owned rows only
```

The command refuses production-like targets. Accounts, the shared fake password and the guard rules are in [docs/testing/TEST_DATA.md](docs/testing/TEST_DATA.md).

## 6. Run the app

```bash
npm run dev    # http://localhost:3000
```

Register at `/register` (or sign in with a fixture account) and create or join a family.

### Running the full stack in Docker instead

```bash
docker compose up --build
```

This builds the production image and runs it with `NODE_ENV=production` against the compose database; the container runs `scripts/migrate.js` before starting the server. Production mode enforces a `JWT_SECRET` of at least 32 characters.

## Everyday commands

```bash
npm run lint
npm run typecheck
npm test                  # Jest
npm run validate          # typecheck + prisma validate
npm run verify:app        # full local gate in release order
npx prisma studio         # browse data (needs DATABASE_URL exported)
```

Before opening a PR, follow [CONTRIBUTING.md](CONTRIBUTING.md) and `docs/engineering/DEFINITION_OF_DONE.md`.

## Authentication

Self-hosted JWT sessions: `/api/auth/register` and `/api/auth/login` set a `session_token` cookie; `src/middleware.ts` gates `/dashboard` and the auth routes. Roles are `parent`, `teen` and `child`. Implementation: `src/lib/auth.ts`, `src/lib/api-auth.ts`. There is no Supabase auth; `src/lib/supabase/` is a legacy name only.

## Common issues

- **`docker compose` fails with "set DATABASE_URL" / "set JWT_SECRET"**: fill in those values in `.env`; Compose checks them even when you start only `postgres`.
- **Database connection errors from the host**: the host-side `DATABASE_URL` must use `localhost`, not `postgres`.
- **`fixtures:seed` refuses**: set `FIXTURES_ALLOW=1`, make sure `NODE_ENV` is not `production`, and use a loopback host; see the guard rules in `docs/testing/TEST_DATA.md`.
- **Stale Prisma client**: run `npx prisma generate` and remove `.next/`.
- **Persistent 401s**: check `JWT_SECRET` and clear cookies; changing the secret signs out every session.
