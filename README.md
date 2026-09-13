# Family Planner

Family Planner is one private, role-aware household operations product for families. Its future primary shared surface is a premium Android fridge/wall tablet, supported by companion phone experiences and one household backend.

The existing application includes household membership, chores and rewards, calendar events, lists, meals, messaging and other household domains. The fridge-tablet refactor has **not** started; repository reconciliation and prerequisite release/security work come first.

## Start here

Agents and contributors must read, in order:

1. [AGENTS.md](AGENTS.md)
2. [docs/START_HERE.md](docs/START_HERE.md)
3. [docs/CURRENT_STATE.md](docs/CURRENT_STATE.md)
4. [docs/FRIDGE_TABLET_PROGRAM.md](docs/FRIDGE_TABLET_PROGRAM.md)
5. The selected GitHub issue and its dependencies

The original release programme remains in [docs/PRODUCT_PROGRAM.md](docs/PRODUCT_PROGRAM.md). It is a release/security gate beneath the fridge programme, not a competing product plan.

## Source truth

- Exact dependency versions and scripts: `package.json` and lockfile
- Actual database models: `prisma/schema.prisma`
- Actual authentication and authorization: implementation under `src/`
- Actual Android configuration: `capacitor.config.ts` and `android/`
- Actual automation: `.github/workflows/`

Do not copy version, workflow, feature or model counts from older prose. Inspect the executable source.

## Current architecture

- Next.js App Router and strict TypeScript
- PostgreSQL with Prisma
- Self-hosted JWT/session authentication
- React, Tailwind CSS and reusable components
- Capacitor Android project
- Docker/Coolify production path
- Figma-first design for significant phone/tablet flows

For exact versions, use `package.json`; they intentionally are not duplicated here.

## Local setup

```bash
npm ci --legacy-peer-deps
cp .env.example .env.local
npx prisma generate
npm run dev
```

Use a non-production PostgreSQL database and a development-only JWT secret. Do not use `prisma db push` against production.

## Common verification

```bash
npx prisma generate
npm run typecheck
npm run lint
npm test -- --runInBand
npm run build
```

These are only the baseline. Migration, household-isolation, E2E, visual/accessibility, Android and release gates apply when relevant; see [docs/engineering/DEFINITION_OF_DONE.md](docs/engineering/DEFINITION_OF_DONE.md).

## Important unresolved decisions

The schema contains two overlapping generations:

- older `FamilyMeal`, `List` and `ListItem`;
- newer `Recipe`, `Ingredient`, `RecipeIngredient`, `MealPlan`, `MealPlanEntry`, `ShoppingList` and `ShoppingItem`.

Issue #149 is the canonical decision issue. Do not add a third meal, recipe, grocery or list model generation before that decision is accepted.

## Release boundary

Planning or code completion does not authorize a merge or deployment. Do not deploy production, publish to Google Play, change secrets/DNS/access/billing, contact beta households, spend money, or destructively alter production data without Cameron's explicit approval for that exact action.

## Transactional email

Production email is fail-closed unless an approved provider credential and a
verified sender are configured. Local development and CI use
`EMAIL_DELIVERY_MODE=log`. See
[the transactional email runbook](docs/TRANSACTIONAL_EMAIL_RUNBOOK.md) and
[provider decision](docs/TRANSACTIONAL_EMAIL_PROVIDER_DECISION.md) before
changing production delivery.

Relevant environment variables are `MATON_API_KEY`, `RESEND_API_KEY`,
`EMAIL_FROM` and `EMAIL_DELIVERY_MODE`.

## License

MIT — Cameron Ashley
