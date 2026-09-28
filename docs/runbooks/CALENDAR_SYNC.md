# Runbook: enable two-way Google / Outlook calendar sync (#264)

Calendar sync ships **dormant**. It stays off until every variable below is set in the production environment.
Setting production secrets is an environment change that needs Cameron's explicit approval (`AGENTS.md`); agents
must not do it. Design and semantics: [`docs/architecture/CALENDAR_SYNC.md`](../architecture/CALENDAR_SYNC.md).

## 0. What you need

| Variable | Value | Notes |
| --- | --- | --- |
| `APP_URL` | `https://family.ashbi.ca` | Public origin. Falls back to `NEXT_PUBLIC_APP_URL`. Must be https (http only for `localhost`). Redirect URIs are built from it, never from request headers. |
| `CALENDAR_TOKEN_KEY` | base64 of 32 random bytes | `openssl rand -base64 32`. Encrypts OAuth tokens at rest. Keep it separate from `JWT_SECRET`. Losing it disconnects every calendar (members reconnect). |
| `CALENDAR_TOKEN_KEY_PREVIOUS` | optional | Only during a key rotation (section 6). |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | from Google Cloud | Enables Google. |
| `MICROSOFT_CLIENT_ID`, `MICROSOFT_CLIENT_SECRET`, `MICROSOFT_TENANT` | from Microsoft Entra | Enables Outlook / Microsoft 365. `MICROSOFT_TENANT=common` for personal + work accounts. |

A provider is enabled only when its client id and secret, a valid `CALENDAR_TOKEN_KEY` and a valid `APP_URL` are
all present. Missing anything = that provider's routes are 404 and it is not offered in Settings.

These are server-only variables. Do **not** prefix them with `NEXT_PUBLIC_` and do not put them in the Android /
Capacitor build.

## 1. Register the Google OAuth app

1. Google Cloud Console → create (or pick) a project for Family Planner.
2. **APIs & Services → Library → Google Calendar API → Enable.**
3. **OAuth consent screen**: User type External; app name "Family Planner"; support email; authorised domain
   `ashbi.ca`; privacy policy URL. Add scopes:
   - `https://www.googleapis.com/auth/calendar.events`
   - `https://www.googleapis.com/auth/calendar.calendarlist.readonly`
   These are "sensitive" scopes. While the app is in **Testing**, add each family member's Google account as a test
   user (limit 100; refresh tokens of testing apps expire after 7 days, so members must reconnect weekly). For
   long-lived use, submit the app for verification (publishing status: In production).
4. **Credentials → Create credentials → OAuth client ID → Web application.**
   - Authorised redirect URI: `https://family.ashbi.ca/api/calendar/connections/google/callback`
   - (Local development, optional, separate client: `http://localhost:3000/api/calendar/connections/google/callback`)
   - No JavaScript origins are needed.
5. Copy the client id and secret into the production secret store as `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`.

## 2. Register the Microsoft app

1. Microsoft Entra admin center → **App registrations → New registration**.
   - Name "Family Planner".
   - Supported account types: "Accounts in any organizational directory and personal Microsoft accounts" (then
     `MICROSOFT_TENANT=common`). For one organisation only, pick single tenant and set `MICROSOFT_TENANT` to its
     tenant id.
   - Redirect URI: platform **Web**, `https://family.ashbi.ca/api/calendar/connections/microsoft/callback`.
2. **API permissions → Add → Microsoft Graph → Delegated**: `Calendars.ReadWrite` and `offline_access`. Remove
   `User.Read` if you do not want it (the app does not use it). No admin consent is required for these for
   personal accounts; work tenants may require an admin to consent.
3. **Certificates & secrets → New client secret**. Note its expiry date and set a reminder to rotate it before then.
4. Set `MICROSOFT_CLIENT_ID` (Application (client) ID), `MICROSOFT_CLIENT_SECRET` (the secret **value**) and
   `MICROSOFT_TENANT`.

## 3. Configure the deployment

1. Generate the token key once: `openssl rand -base64 32` → `CALENDAR_TOKEN_KEY`. Store it with the other
   production secrets and in the password manager; it is needed to read existing connections after a restore.
2. Add the variables to the production environment (the same place `JWT_SECRET` lives). `docker-compose.yml`
   passes them through for self-hosted runs.
3. No schema step: `scripts/migrate.js` already created the tables on deploy (they stay empty while dormant).
4. Redeploy / restart so the server reads the new environment.

## 4. Verify (staging first if available)

1. As a parent, open **Settings**. A "Connected calendars" card appears with "Connect Google Calendar" / "Connect
   Outlook / Microsoft 365". As a teen/child: no card (and `GET /api/calendar/connections` → 403).
2. Connect Google with a test account. Consent screen shows only the two calendar scopes. You land back on
   Settings with "Calendar connected".
3. Choose a calendar → "Syncing starts now" → counts shown. Check the family calendar shows the account's events
   for the next weeks.
4. Edit one imported event in the app → Sync now → the change appears in Google Calendar. Delete one in the app →
   Sync now → gone in Google. Edit / delete one in Google → reload `/dashboard/calendar` after 5 minutes or press
   Sync now → reflected in the app.
5. Switch "Also add new family calendar events to this calendar" on, create a family event, Sync now → it appears in
   Google once (Sync now again: still once).
6. Repeat 2–5 for Microsoft (confirm `calendarView/delta` works for a non-default calendar).
7. Check logs contain only `[calendar-sync]` lines with ids and codes — no tokens, titles or URLs with codes.
8. Database spot check: `SELECT provider, status, left(access_token_enc, 4) FROM "CalendarConnection";` → `ct1.`
   prefixes only, never plaintext.

## 5. Revocation and disconnect

- **A member disconnects** in Settings: the app revokes the Google grant (best effort), deletes the tokens, the
  events imported from that calendar and the connection. Nothing is deleted from the member's own calendar.
- **Microsoft has no app-side revocation endpoint** for delegated consent. After disconnecting, the member can
  remove the app at <https://account.live.com/consent/Manage> (personal) or <https://myapps.microsoft.com>
  (work/school). Deleting our copy of the refresh token already stops all access from Family Planner.
- **A member revokes access at Google/Microsoft first**: the next sync fails the token refresh, the connection shows
  "Reconnect this calendar", and the member can reconnect or disconnect.
- **Emergency: stop all sync immediately**: unset `GOOGLE_CLIENT_SECRET` / `MICROSOFT_CLIENT_SECRET` (or
  `CALENDAR_TOKEN_KEY`) and restart. Every route 404s and no sync runs. To also delete stored tokens (irreversible,
  production data change → needs Cameron's approval):
  `UPDATE "CalendarConnection" SET access_token_enc = NULL, refresh_token_enc = NULL, status = 'reauth_required';`
- **Suspected client-secret leak**: rotate the secret at Google / Microsoft (existing refresh tokens keep working
  with the new secret), update the env var, restart.

## 6. Rotate `CALENDAR_TOKEN_KEY`

1. Set `CALENDAR_TOKEN_KEY_PREVIOUS` to the current key and `CALENDAR_TOKEN_KEY` to a new `openssl rand -base64 32`.
2. Restart. Existing rows decrypt with the previous key; the next access-token refresh of each connection (at most
   about an hour after its next sync) re-encrypts both the access and the refresh token with the new key.
3. When no row still uses the old key, remove `CALENDAR_TOKEN_KEY_PREVIOUS`. Check with
   `SELECT count(*) FROM "CalendarConnection" WHERE split_part(refresh_token_enc, '.', 2) <> '<new kid>';` — the
   new key's `kid` is the second dot-separated part of any freshly written value. Connections still on the old key
   after removal show "Reconnect".

## 7. Rollback

Unset the provider variables (dormant again). The code can be reverted without touching the new tables; imported
events then look like ordinary events. Removing the tables is a separate, approval-gated contract migration.
