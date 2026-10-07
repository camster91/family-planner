# Beta Launch Checklist

What has to be true before the first real families use Family Planner, and who does it. Completion requires current evidence for every criterion; code and endpoint health alone do not prove real-family readiness.

Initial refresh snapshot: 2026-10-07. At that refresh `main` and live `/api/version` were `a243bd5b297bc1c02072451866722dc0c7061402`; `/api/health` healthy. Current `main` after PR #379 is `a80c4753bba6f9aa5f978d4a9cff4ee039f97d44`; live `/api/version` now reports that exact merge (built `2026-10-07T18:17:37.600Z`), health is healthy and all 26 approved asset hashes match. Authenticated child acceptance remains gated on an approved live test identity. Live role/email/backup/device acceptance remains open. See [the durable completion contract](engineering/COMPLETION_CONTRACT.md) and [all 51 issue criteria](engineering/COMPLETION_MATRIX.md). The older rows below are retained history awaiting per-row reconciliation.

Historical snapshot: 2026-10-01. Keep this list short. When an item is done, mark it done with the PR or date; do not delete it.

## Must do before the first family signs up

| # | Item | Who | How | Status |
|---|------|-----|-----|--------|
| 1 | Production is running the current `main` | Owner | Use the existing protected-main Coolify source-build path; read the exact merged revision from `/api/version`, healthy `/api/health`, approved assets and applicable safe journeys (`runbooks/COOLIFY_DEPLOY.md`). Do not dispatch SSH or change settings | Source-build revision verified 2026-10-07: PR #379 merge `a80c4753bba6f9aa5f978d4a9cff4ee039f97d44`, healthy `/api/health`, 26 approved asset hashes match. Existing Coolify path; no claim of immutable CI-image promotion. Live role/email/backup/device gates below remain open |
| 2 | Email sends | Owner | Mailgun domain, DNS (SPF, DKIM, DMARC), sending key in production, open and click tracking off (`runbooks/TRANSACTIONAL_EMAIL.md`) | Open. Without it a new parent cannot verify their email, so cannot sign in, and invites fail. The privacy page says Mailgun open and click tracking is off |
| 3 | `TRUSTED_PROXY_HOPS` matches the real proxy chain | Owner | See `runbooks/COOLIFY_DEPLOY.md` or `engineering/CI_AND_RELEASE.md`. The server warns at start when it is missing | Open |
| 4 | Backups run every day and a restore has been tested | Owner | Install the timer (`runbooks/BACKUPS.md`) or use Coolify scheduled backups, then do the restore test | Open. Scripts and retention are on `master` |
| 5 | Support contact | Owner | Fill in `<SUPPORT_EMAIL>` in `product/BETA_OPERATIONS.md`, on the privacy page and in `src/lib/support.ts` (shown on the in-app Help page, `/dashboard/help`). How to handle requests: `runbooks/SUPPORT.md` | Open |
| 6 | Privacy page names Mailgun | Agent | The privacy page names Mailgun and what it receives, and says its open and click tracking is off | Done 2026-10-02. Row 2 must keep tracking off so the page stays true |
| 7 | Smoke test on production after the deploy | Owner, with an agent | Register a test parent, verify by email, create a household, invite a child, assign and complete a chore; then delete the test household | Open. The same journey runs in the E2E workflow (`e2e.yml`, `e2e/signup.spec.ts`), which is informational, not a required check: a merge does not prove it passed, so check that run or do this smoke test |

## Ready in code (done)

- Sign up, verify (with a confirm step so mail scanners cannot use up the link), sign in, password reset, invites and joining with a family code.
- Household isolation and role checks on every API route, with two-household tests.
- Account and household deletion, data export, notification preferences, audit history.
- Privacy: page views are not stored; beta usage counts are off per household by default and hold no content.
- Security: rate limits on sign-in and password routes, same-origin redirects only, secret scanning in CI, the server refuses to start without `JWT_SECRET` or `DATABASE_URL`.
- Error, empty and offline states on the main pages; narrow screen and 200% zoom checks in CI.
- Backup retention matches the privacy page (about five weeks).
- In-app Help for parents and a support runbook (`runbooks/SUPPORT.md`); the support address is one constant in `src/lib/support.ts`.
- A parent can remove a household member (their sessions end at once) and get a new family code if the old one leaked (O-34).
- Five full code reviews on 2026-10-01; every finding was fixed in #320 to #326.

## Can wait until after the first families

- Turning the Content-Security-Policy from report-only to enforced, after real phone and tablet sessions show no violations (decision O-27).
- Shared fridge tablet on real devices (#242), Play Store build (#138, #160), app icon (#163).
- AI features, weather, calendar sync and email import: all off until the owner approves the provider, terms and spend (#123, #124, #125, #144).
- Per-household time zone (decision O-31).
- Legacy meal and shopping table cleanup (#254), after the backfill and a quiet release cycle.

## Running the beta

Recruiting, consent, the private cohort map, weekly scorecards and exit interviews are in `product/BETA_OPERATIONS.md` (#107, #108).
