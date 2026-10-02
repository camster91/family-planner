# Transactional Email (Mailgun)

Owner runbook for #103. Setting up the provider account, DNS, production secrets and the test inbox are owner actions that need Cameron's approval (`AGENTS.md`). Agents must not change them.

**Provider: Mailgun.** Issue #103 proposes Resend (`RESEND_API_KEY`, `EMAIL_FROM`) and links `docs/TRANSACTIONAL_EMAIL_RUNBOOK.md`. That plan came from PR #101, which was not merged; `master` sends through Mailgun only (`src/lib/mail.ts`) and has no Resend code (`docs/decisions/PR101_DISPOSITION.md`). Setting `RESEND_API_KEY` does nothing. Switching providers would be a code change.

## Launch blocker

Without `MAILGUN_API_KEY` in production, **a parent who signs up on their own can never sign in**:

1. `POST /api/auth/register` creates the account with `email_verified = false` and answers 200 with `requiresVerification: true`.
2. Sending the verification email throws (`sendMail` refuses to run in production without a key). Registration swallows the error on purpose and only logs a `route.warn` line.
3. `POST /api/auth/login` answers **403** "Please verify your email before signing in" for as long as the account is unverified.
4. "Resend verification" and "Forgot password" fail the same way, silently (they always answer with the same message, so the address cannot be probed).

Every new household starts with a self-registered parent, so no new household can start. Joining is blocked too:

- An email invite creates the member already verified, but sending it answers **503** "Email is not configured", so the link never arrives.
- A family code (`/join?code=...`) needs a signed-in account. Someone who registers without an invite link is unverified, so they hit the same 403 and cannot use the code.

The beta (#107) must not start until the test steps below pass.

## What the app sends

All account email goes through `sendAccountMail` (`src/lib/notification-delivery.ts`) and is always sent (no member setting turns it off).

| Email              | Sent by                                                         | Link                                        | Link lifetime |
| ------------------ | --------------------------------------------------------------- | ------------------------------------------- | ------------- |
| Email verification | `POST /api/auth/register`, `POST /api/auth/resend-verification` | `<APP_URL>/api/auth/verify-email?token=...` | 24 hours      |
| Password reset     | `POST /api/auth/forgot-password`                                | `<APP_URL>/reset-password?token=...`        | 1 hour        |
| Family invite      | `POST /api/family/invites`                                      | join link                                   | 48 hours      |

Tokens are single use. A used reset token also signs out every existing session of that account (`token_version` goes up).

## Settings

Server-only. Never prefix these with `NEXT_PUBLIC_`.

| Variable              | Needed         | Meaning                                                                                                                                                            |
| --------------------- | -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `MAILGUN_API_KEY`     | **yes** (prod) | A Mailgun **domain sending key** for the sending domain only, not the account's primary key                                                                        |
| `MAILGUN_DOMAIN`      | yes            | The Mailgun sending domain. The code defaults to `ashbi.ca` if unset; set it explicitly                                                                            |
| `MAILGUN_FROM`        | yes            | Sender, for example `Family Planner <noreply@SENDING_DOMAIN>`. Must be on the sending domain. Falls back to `FROM_EMAIL`, then `Family Planner <noreply@ashbi.ca>` |
| `NEXT_PUBLIC_APP_URL` | yes            | Base of every link in the emails. Inlined at **build** time; changing it needs a new image. Falls back to `https://family.ashbi.ca`                                |

Region: the code calls `https://api.mailgun.net` (Mailgun's US region). A domain created in Mailgun's EU region will not work without a code change. Create the domain in the US region.

Production values are set on the running container; the deploy copies the old container's environment to the new one (`DEPLOYMENT.md`). Never commit or paste the key.

## DNS (owner step)

Use a subdomain so the main domain's mail is not affected, for example `mg.ashbi.ca` (the name is the owner's choice). Mailgun shows the exact records when the domain is added. Expect:

| Record | Name                                                          | Purpose                                                                |
| ------ | ------------------------------------------------------------- | ---------------------------------------------------------------------- |
| TXT    | the sending subdomain                                         | SPF: `v=spf1 include:mailgun.org ~all`                                 |
| TXT    | `<selector>._domainkey.<subdomain>`                           | DKIM public key from Mailgun                                           |
| TXT    | `_dmarc.<subdomain>` (or the parent domain's existing record) | DMARC. Start with `p=none` and a report address you read, then tighten |
| CNAME  | `email.<subdomain>`                                           | Tracking host. **Not needed**: keep tracking off (below)               |
| MX     | the subdomain                                                 | Only for receiving. Not needed for sending                             |

Check the parent domain's existing DMARC policy first: a strict `p=reject` with `aspf=s`/`adkim=s` can reject mail from a subdomain that is not aligned.

Wait until Mailgun shows SPF and DKIM as **verified** before testing.

### Tracking must be off

In Mailgun, domain settings → Tracking: turn **off** open tracking, click tracking and unsubscribe links.

- Click tracking rewrites the verification and reset links through Mailgun, which puts single-use tokens in a third party's logs and can break the link.
- Open tracking adds a tracking pixel. The privacy page says "no tracking pixels".

## Test (owner, on review first, then production with separate approval)

Use an owner-controlled test inbox and a throwaway account. Record only non-secret evidence: date, environment, pass/fail, Mailgun message status. No tokens, no full links.

1. **Health.** `GET /api/health` answers healthy. (It does not check email; that is what the steps below are for.)
2. **Verification.** Register a new household with the test address.
   - Email arrives within a minute, from the expected sender, not in spam.
   - The link points at the right host (review host on review, production host on production).
   - Before clicking: signing in gives 403 "Please verify your email".
   - Click: lands on `/login?verified=1`. Signing in works.
   - Click the same link again: lands on `/login?error=invalid_token` (single use).
3. **Resend.** Register a second throwaway address, use "resend verification". The newest link works.
4. **Password reset.** On "Forgot password", enter the test address.
   - Email arrives. The link opens `/reset-password`.
   - Set a new password. The old password no longer works; the new one does. Any other signed-in session of that account is signed out.
   - Use the same link again: it fails.
   - Enter an address with no account: the page shows the same message, and no email is sent (enumeration-safe).
5. **Invite.** From the test household, invite a second test address. It arrives, and joining works.
6. **Throttling.** Six "Forgot password" requests from one IP within an hour: the sixth answers 429. Resend-verification has the same limit.
7. **Headers.** In the received email, "Show original": SPF pass, DKIM pass, DMARC pass. No `email.<subdomain>` tracking links.
8. **Clean up.** Delete the throwaway household: Settings → Privacy & data → Delete Account (`docs/product/ACCOUNT_DELETION.md`).

## When it breaks

**Logs.** A failed send is logged as `route.warn` with the route `POST /api/auth/register (verification email)`, `POST /api/auth/resend-verification (mail)` or `POST /api/auth/forgot-password (reset email)`. The log line holds the error name only, not the message, by design (`src/lib/logger.ts`). So check the settings and Mailgun, not the log text.

**Mailgun dashboard** (Sending → Logs): each message shows accepted, delivered, failed or bounced, with the reason. Check Suppressions: an address that bounced or complained is blocked by Mailgun from then on, and the app cannot tell. Remove a suppression only when the person confirms the address works.

**Deliverability check** (weekly during the beta, with the scorecard):

- Mailgun delivered rate close to 100%, no new permanent failures;
- DKIM and SPF still verified in Mailgun;
- DMARC reports (if set up) show Mailgun passing;
- a test reset email to a Gmail and an Outlook inbox lands in the inbox, not spam.

**Key leaked or rotated.** Create a new domain sending key in Mailgun, set it on the container (owner, approval), redeploy or restart, run step 4, then delete the old key in Mailgun.

## Privacy

Mailgun receives each recipient's email address, the account name in the greeting, and the email body with its link. It is a data processor and should be listed in `docs/product/THIRD_PARTY_PROCESSORS.md`, which currently has only a generic "Notification provider" row (owner follow-up).
