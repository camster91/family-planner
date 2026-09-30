# Third-Party Processor Register

Do not treat a roadmap candidate as an active production processor. Add/update an entry only when the integration is actually selected/configured.

| Provider | Purpose | Status | Data sent | Credentials | Failure/disable path | Privacy/security review |
|---|---|---|---|---|---|---|
| PostgreSQL hosting / current infrastructure | Core app data storage | Verify current production provider before public release | household application data | server-side | backup/restore/migration runbooks | required |
| VPS/Docker hosting | application deployment/hosting | existing production host; provider and region require owner verification | application runtime/operational data | server-side | rollback runbook | required |
| AI provider | contextual assistance | not committed by roadmap | task-minimized authorized context only | server-side | feature kill switch/manual workflows | required before prod |
| Calendar provider | optional sync | not committed | authorized event/sync fields | server-side OAuth/token storage | disconnect/disable adapter | required before prod |
| Weather provider: Open-Meteo (`api.open-meteo.com` forecast, `geocoding-api.open-meteo.com` place search) | optional Today board weather tile (#262) | implemented, free, no API key; **off per household by default** (a parent opts in); server kill switch `WEATHER_ENABLED`, off unless explicitly set to `1`/`true`. Enabling it in production still needs this row's review | forecast: the household's chosen place as latitude/longitude rounded to 2 decimals (about 1 km), plus the requesting server's IP; place search: the text a parent types. No names, account or other household data | none (keyless); server-side only, never from the browser or Android bundle | tile hidden on any error or timeout (3 s); cached 30 min per household, failures back off 10 min; `WEATHER_ENABLED=false` or the household toggle turns it off | required before prod (Open-Meteo terms, including its non-commercial free tier, and privacy) |
| Transactional email: Mailgun (US region API, `src/lib/mail.ts`) | account emails: email verification, password reset, household invites, and notification emails a member has not switched off | implemented; sends only when `MAILGUN_API_KEY` is set (`MAILGUN_DOMAIN` defaults to `ashbi.ca`). Without them production sign-up cannot complete, because self-registered parents must verify their email first (`docs/runbooks/TRANSACTIONAL_EMAIL.md`) | recipient address and name, the email subject and body (which contain one-time links) | server-side API key (domain-scoped sending key) | email not sent; the request still succeeds or returns a clear error; open and click tracking must be off so one-time links are not rewritten | required before prod (DPA, region, retention of sending logs; name Mailgun on the privacy page) |
| Notification provider | push/email delivery | existing/future provider must be reconciled | purpose-limited delivery metadata | server-side | provider isolation/in-app fallback | required |
| Analytics/crash provider | product/reliability telemetry | reconcile actual dependencies/config | privacy-safe event/technical metadata | config-dependent | disable SDK/collection | required |

## Entry requirements
Record:
- exact service/product;
- why it is necessary;
- data categories and whether children/teens/shared devices are involved;
- data regions/retention settings where relevant;
- authentication/credential owner;
- current cost/plan and spend approval where applicable;
- deletion/export/revoke capability;
- outage/fallback behaviour;
- privacy/security documentation review date.

## Rule
No agent may enable a new paid/production processor or credentials based only on this table. Selection, spend, credentials and production rollout retain explicit approval gates.