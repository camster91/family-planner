# Beta Launch Checklist

What has to be true before the first real families use Family Planner, and who does it. The code side is done on `master` except where a row says otherwise. The rest needs the owner (Cameron).

Snapshot: 2026-09-30. Keep this list short. When an item is done, mark it done with the PR or date; do not delete it.

## Must do before the first family signs up

| # | Item | Who | How | Status |
|---|------|-----|-----|--------|
| 1 | Production is running the current `master` | Owner | Add the SSH settings to the GitHub `production` environment and run **Build, Test & Release**, or set up Coolify (`runbooks/COOLIFY_DEPLOY.md`) | Open. The last recorded deploy is `b408170` (2026-09-23). The 2026-09-30 release run built and tested, then stopped: the SSH host, user, key and known-hosts are not set |
| 2 | Email sends | Owner | Mailgun domain, DNS (SPF, DKIM, DMARC), sending key in production, open and click tracking off (`runbooks/TRANSACTIONAL_EMAIL.md`) | Open. Without it a new parent cannot verify their email, so cannot sign in, and invites fail |
| 3 | `TRUSTED_PROXY_HOPS` matches the real proxy chain | Owner | See `runbooks/COOLIFY_DEPLOY.md` or `engineering/CI_AND_RELEASE.md`. The server warns at start when it is missing | Open |
| 4 | Backups run every day and a restore has been tested | Owner | Install the timer (`runbooks/BACKUPS.md`) or use Coolify scheduled backups, then do the restore test | Open. Scripts and retention are on `master` |
| 5 | Support contact | Owner | Fill in `<SUPPORT_EMAIL>` in `product/BETA_OPERATIONS.md` and on the privacy page | Open |
| 6 | Privacy page names Mailgun | Owner | Add it next to the other processors (`product/THIRD_PARTY_PROCESSORS.md` lists it) | Open |
| 7 | Smoke test on production after the deploy | Owner, with an agent | Register a test parent, verify by email, create a household, invite a child, assign and complete a chore; then delete the test household | Open. The same journey runs in CI (`e2e/signup.spec.ts`) |

## Ready in code (done)

- Sign up, verify (with a confirm step so mail scanners cannot use up the link), sign in, password reset, invites and joining with a family code.
- Household isolation and role checks on every API route, with two-household tests.
- Account and household deletion, data export, notification preferences, audit history.
- Privacy: page views are not stored; beta usage counts are off per household by default and hold no content.
- Security: rate limits on sign-in and password routes, same-origin redirects only, secret scanning in CI, the server refuses to start without `JWT_SECRET` or `DATABASE_URL`.
- Error, empty and offline states on the main pages; narrow screen and 200% zoom checks in CI.
- Backup retention matches the privacy page (about five weeks).

## Can wait until after the first families

- Turning the Content-Security-Policy from report-only to enforced, after real phone and tablet sessions show no violations (decision O-27).
- Shared fridge tablet on real devices (#242), Play Store build (#138, #160), app icon (#163).
- AI features, weather, calendar sync and email import: all off until the owner approves the provider, terms and spend (#123, #124, #125, #144).
- Per-household time zone (decision O-31).
- Legacy meal and shopping table cleanup (#254), after the backfill and a quiet release cycle.

## Running the beta

Recruiting, consent, the private cohort map, weekly scorecards and exit interviews are in `product/BETA_OPERATIONS.md` (#107, #108).
