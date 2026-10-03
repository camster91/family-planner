# Runbook: turn on two-way Google / Outlook calendar sync (#264)

Calendar sync is built but **off**. It turns on only when the settings below are in the production environment.
Creating the Google / Microsoft apps and setting production secrets is Cameron's job (`AGENTS.md`); agents must not
do it. How it works: [`docs/architecture/CALENDAR_SYNC.md`](../architecture/CALENDAR_SYNC.md).

You can turn on Google only, Outlook only, or both. Skip the part you do not need.

## Checklist (about 30 minutes)

### A. Google Calendar

1. Open <https://console.cloud.google.com> and sign in with the Google account that should own the app.
2. Top bar → project picker → **New project**. Name it `Family Planner`. Select it.
3. **APIs & Services → Library**. Search `Google Calendar API`. Click **Enable**.
4. **Google Auth Platform** (older screens call it **OAuth consent screen**) → **Get started**:
   - App name: `Family Planner`. User support email: your email.
   - Audience: **External**.
   - Contact email: your email. Agree and **Create**.
5. **Branding**: app home page `https://family.ashbi.ca`, privacy policy `https://family.ashbi.ca/privacy`,
   authorised domain `ashbi.ca`. Save.
6. **Data Access → Add or remove scopes**. Paste these two into "Manually add scopes", then **Update** and **Save**.
   Add nothing else:
   - `https://www.googleapis.com/auth/calendar.events`
   - `https://www.googleapis.com/auth/calendar.calendarlist.readonly`
7. **Audience**: choose one (see "Google review" below):
   - **Testing** (fastest): under **Test users** add the Google account of every family member who will connect.
     Each person must reconnect every 7 days.
   - **In production**: click **Publish app**. No weekly reconnect.
8. **Clients → Create client**:
   - Application type: **Web application**. Name: `Family Planner web`.
   - Authorised JavaScript origins: leave empty.
   - Authorised redirect URIs → **Add URI** → exactly:
     `https://family.ashbi.ca/api/calendar/connections/google/callback`
   - **Create**. Copy the **Client ID** and **Client secret** now (the secret is shown once).

**Google review, honestly.** Both scopes are "sensitive" (not "restricted"), so no paid security audit is needed.

- In **Testing**: only the test users (up to 100) can connect, and Google ends their access after 7 days. The app
  then shows "Reconnect" on that calendar.
- **In production without verification**: anyone can connect, but Google shows a "Google hasn't verified this app"
  screen first (click **Advanced → Go to Family Planner**). Limit 100 users. Fine for one family.
- **Verified**: no warning screen. Click **Prepare for verification**. Google asks for the privacy policy, a short
  screen recording of the connect flow, and why each scope is needed. It can take a few days to weeks. Before you
  ask: `https://family.ashbi.ca/privacy` does **not** yet mention Google or Outlook calendar data. Google requires
  the policy to say what calendar data the app reads and writes, that it is stored encrypted only to sync, never sold
  or shared, and that its use follows the Google API Services User Data Policy (Limited Use). Add that first.

### B. Outlook / Microsoft 365

1. Open <https://entra.microsoft.com> (any Microsoft account works; a free one is fine).
2. **Applications → App registrations → New registration**:
   - Name: `Family Planner`.
   - Supported account types: **Accounts in any organizational directory and personal Microsoft accounts**.
   - Redirect URI: platform **Web**, exactly:
     `https://family.ashbi.ca/api/calendar/connections/microsoft/callback`
   - **Register**. Copy the **Application (client) ID**.
3. **API permissions → Add a permission → Microsoft Graph → Delegated permissions**. Tick `Calendars.ReadWrite` and
   `offline_access`. **Add permissions**. You may remove `User.Read`; the app does not use it.
4. **Certificates & secrets → Client secrets → New client secret**. Pick 24 months. Copy the **Value** (not the
   Secret ID) now. Put a reminder in your calendar to make a new one before it expires.

**Microsoft review, honestly.** Personal accounts (outlook.com, hotmail.com) can connect right away; they see an
"unverified" label. Work or school accounts may be blocked until that organisation's admin approves the app, or
until you finish **Publisher verification** (needs a Microsoft Partner Network ID). No admin consent is needed for
these permissions on personal accounts.

### C. Make the token key

The app encrypts every calendar token with this key. Run once, on any computer:

```bash
openssl rand -base64 32
```

It prints 44 characters ending in `=`, for example `q3V...Zk=`. That whole line is `CALENDAR_TOKEN_KEY`. It must
be base64 of exactly 32 bytes; anything else (hex, a password) keeps sync off. No openssl? Use
`node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`.

Save it in the password manager. If it is lost, every connected calendar must be reconnected.

### D. Add the settings in Coolify

Coolify → the Family Planner app → **Environment Variables**. Add these as **runtime** variables. Do **not** tick
"Build variable" for any of them, and never prefix them with `NEXT_PUBLIC_`. (Still on the old VPS path? Put the same
lines in the `.env` file that `docker-compose.yml` reads.)

| Variable | Value |
| --- | --- |
| `APP_URL` | `https://family.ashbi.ca` (no slash at the end) |
| `CALENDAR_TOKEN_KEY` | the line from step C |
| `GOOGLE_CLIENT_ID` | from A8 (Google only) |
| `GOOGLE_CLIENT_SECRET` | from A8 (Google only) |
| `MICROSOFT_CLIENT_ID` | from B2 (Outlook only) |
| `MICROSOFT_CLIENT_SECRET` | from B4, the secret **Value** (Outlook only) |
| `MICROSOFT_TENANT` | `common` (Outlook only; see below) |

Then **Redeploy** (a restart is enough; nothing needs rebuilding). The database tables already exist.

`MICROSOFT_TENANT`: `common` = personal and work accounts (matches B2). Use `consumers` for personal accounts only,
or your organisation's tenant id if you chose "single tenant" in B2.

If the Settings card does not appear after the restart, look in the app logs for lines starting with
`[env] WARNING: Calendar sync:`. They name the missing or wrong setting (never its value).

### E. Test it (5 minutes)

1. Sign in as a parent → **Settings → Connected calendars**. You see one line of text and **Connect Google Calendar**
   / **Connect Outlook**. (Teens and children never see this card.)
2. Click **Connect Google Calendar**. Google shows only the two calendar permissions. Tick both and continue.
3. You come back to Settings with "Calendar connected." and a calendar list. Pick a calendar → **Save**. You see
   "Synced: N changes in, 0 out."
4. Open the family calendar. Your events for the next 6 months are there.
5. Edit one of those events in the app → Settings → **Sync now** → the change is in Google Calendar.
6. Change an event in Google Calendar → open the family calendar (it syncs at most every 5 minutes) or press
   **Sync now** → the change shows in the app.
7. Optional: choose "Also add new family calendar events to this calendar", add a family event, **Sync now** twice.
   It appears in Google once.
8. Repeat 2–6 with **Connect Outlook**.
9. Logs: only `[calendar-sync]` lines with ids and short codes. No tokens, titles or links with codes.
10. Database spot check: `SELECT provider, status, left(access_token_enc, 4) FROM "CalendarConnection";` shows
    `ct1.` only, never a readable token.

### F. Turn it off

- **Everything, now:** remove `GOOGLE_CLIENT_SECRET` and `MICROSOFT_CLIENT_SECRET` (or `CALENDAR_TOKEN_KEY`) and
  restart. The card disappears, every calendar route answers 404 and no sync runs. Stored connections stay, unused.
- **One provider:** remove only that provider's client secret and restart.
- To also delete the stored tokens (cannot be undone; a production data change, so Cameron approves it first):
  `UPDATE "CalendarConnection" SET access_token_enc = NULL, refresh_token_enc = NULL, status = 'reauth_required';`

## How syncing is started (no scheduled job)

There is no cron job and none is needed to turn this on (`AGENTS.md` forbids adding one without approval). A
calendar syncs when:

- someone presses **Sync now** in Settings (any parent; at most 6 times in 10 minutes per calendar), or
- anyone signed in opens the family calendar page (`/dashboard/calendar`) and that calendar has not synced in the last
  5 minutes. The sync runs after the page is sent, so the page is not slower.

So a change made in Google shows up the next time someone opens the calendar page. The fridge tablet's home screen
does not start a sync. Keeping calendars fresh with nobody using the app would need a scheduled job; that is not
built and needs Cameron's approval first.

## Disconnect and revoked access

- **A parent disconnects** in Settings: the app gives back the Google access (Microsoft has no way to do this from the
  app), deletes the tokens, the events that came from that calendar, and the connection. Nothing is deleted from the
  person's own calendar.
- **Outlook:** after disconnecting, the person can also remove the app at <https://account.live.com/consent/Manage>
  (personal) or <https://myapps.microsoft.com> (work/school). Deleting our copy of the token already stops all
  access.
- **Access removed at Google/Microsoft first, or a Testing-mode token expired after 7 days:** the next sync fails,
  the calendar shows "Reconnect this calendar to keep it in sync." and a **Reconnect** button for the person who
  connected it. Other parents see "<name> needs to reconnect this calendar."
- **A Google permission box was left unticked:** nothing is connected; Settings says to try again and tick every box.
- **Client secret leaked:** make a new secret at Google / Microsoft, update the variable, restart. Existing
  connections keep working.

## Rotate `CALENDAR_TOKEN_KEY`

1. In Coolify set `CALENDAR_TOKEN_KEY_PREVIOUS` to the current key and `CALENDAR_TOKEN_KEY` to a new
   `openssl rand -base64 32`. Restart.
2. Old tokens still open with the previous key. Each connection is re-saved with the new key the next time it
   syncs and its hour-long access token is renewed. A calendar nobody syncs stays on the old key.
3. Find the new key's short id from the app container's terminal:
   `node -e "const c=require('crypto');const k=Buffer.from(process.env.CALENDAR_TOKEN_KEY,'base64');console.log(c.createHash('sha256').update('family-planner:calendar-token-key:').update(k).digest('hex').slice(0,8))"`
4. Check what is left on the old key:
   `SELECT count(*) FROM "CalendarConnection" WHERE refresh_token_enc IS NOT NULL AND split_part(refresh_token_enc, '.', 2) <> '<new id>';`
   Press **Sync now** on any that remain (or wait), until the count is 0.
5. Remove `CALENDAR_TOKEN_KEY_PREVIOUS` and restart. Anything still on the old key shows "Reconnect".

## Rollback

Remove the provider variables (off again). The code can be reverted without touching the tables; imported events
then look like ordinary events. Dropping the tables is a separate migration that needs approval.

## Local development (optional)

Use a **separate** Google client / Microsoft app with redirect URI
`http://localhost:3000/api/calendar/connections/<google|microsoft>/callback` and `APP_URL=http://localhost:3000`
(plain http is accepted only for `localhost`).
