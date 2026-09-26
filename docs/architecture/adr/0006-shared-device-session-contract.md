# ADR-0006: Shared-device session, pairing, elevation and revocation contract

**Status:** Proposed
**Date:** 2026-09-26
**Owners:** Cameron Ashley (decision); implementation via the #157 child issues
**Related issues/PRs:** #157 (this contract), parent #127, #120 (Android appliance), #136 (security), #131 (Figma flows), #162 (offline/idempotency), #159 (Today board); implements ADR-0002; constrained by ADR-0004

## Context
ADR-0002 decided that a fridge/wall tablet gets a dedicated household device identity instead of a parent's
session, but left the implementation contract open. Today there is no device concept in the code:

- Every authenticated path reads the person cookie `session_token` (a 7-day JWT) and resolves it through
  `resolveSession` (`src/lib/session.ts`), which re-reads `role`, `family_id` and `token_version` from the
  database on every request. A tablet on the fridge is therefore signed in as a person and has that person's
  rights.
- The Today board (`/dashboard/today`, `?mode=fridge`) already builds a shared-surface DTO
  (`src/app/dashboard/today/today-board-data.ts`) that excludes private data at the query level, but it renders
  inside the dashboard layout, which serialises the signed-in person's profile (name, email, age, XP, level,
  streak) into `DashboardNav`/`TabBar` props even when the nav is hidden.
- The Android app is a Capacitor shell that loads the live site (`capacitor.config.ts` `server.url`), so the
  shared-device experience is delivered by the web layer and cookies live in the WebView cookie store.

The detailed contract (models, numbers, endpoints, allowlists, tests) is `docs/architecture/SHARED_DEVICE.md`.
This ADR records the durable decisions.

## Decision
1. **Separate identity, separate credential, deny by default.** A shared device is a `HouseholdDevice` row
   owned by exactly one `Family`, with its own `DeviceSession` credentials. It is never a `User`, never carries a
   person JWT and never changes `User.token_version`. Existing person auth helpers (`authenticateRequest`,
   `getServerUser`, `verifySessionToken`) stay person-only, so every existing route refuses a device by
   construction. Devices reach data only through new `/api/device/*` routes and `/device/*` pages that call
   shared domain functions with a device audience.
2. **Opaque, hashed, rotating tokens.** Device access and refresh tokens are 256-bit random opaque values
   (not JWTs), stored only as SHA-256 hashes (the `src/lib/tokens.ts` pattern). Access tokens live 60 minutes;
   refresh tokens are single-use, rotate on every refresh and expire after 30 days idle. Reuse of a rotated
   refresh token revokes the device unless it arrives within 60 seconds and its successor was never used (a
   lost response). The refresh cookie is `Path=/` so cold launch and the login guard can see it; it is only
   rotated at the refresh endpoint.
3. **Parent-initiated, confirmed pairing.** A parent (person session, parent role) creates a single-use
   8-character code valid for 10 minutes; the tablet claims it; the parent confirms by typing a 4-digit number
   shown on the tablet. The household is always taken from the code, never from the client. Creation, claim,
   status and confirmation are rate-limited per parent, family, IP and pairing.
4. **Elevation is an overlay, not a login.** A parent elevates on the tablet with their own per-parent 6-digit
   elevation PIN (recommended; password as fallback and alternative). The server returns an elevation token that
   the client keeps in memory only; it expires after 5 minutes idle or 15 minutes absolute, and the client drops
   it on explicit exit, page hide, reload or process death. Elevation grants a short, enumerated list of parent
   actions on the shared surface; it never sets `session_token` and never exposes parent-only data domains.
5. **Revocation is server-authoritative and terminal.** Revoking sets `HouseholdDevice.revoked_at`, which blocks
   every access, refresh and elevation on the next request. The device answers any terminal auth error
   (`DEVICE_REVOKED`, `DEVICE_SESSION_INVALID`) by purging its device-scoped cache and returning to the pairing
   screen. A revoked device is never reinstated; re-pairing creates a new device.
6. **Allowlisted shared surface.** The device read surface is the Today board DTO with a device audience
   (no navigation links, names only). Finance, allowance, messages, notifications, medical, emergency cards,
   locations/addresses, pickups, handoff, travel, account/settings/export/invites/AI keys/feed tokens, calendar
   subscription URLs, rewards/XP/badges/leaderboards, wishlist, capture and activity/analytics are prohibited.
7. **Audit.** Device-management and elevation events are written to a new family-scoped `DeviceAuditEvent`
   table with fixed-vocabulary metadata and no content, credentials or raw IPs.
8. **Additive and dark by default.** All schema is additive (`scripts/migrate.js` idempotent DDL). All device
   routes are behind a server kill switch that defaults off. Tablets currently signed in as a person keep
   working unchanged; moving to device mode is an opt-in re-pair, not a migration.

## Alternatives considered
- **Device JWT in the existing `session_token` cookie with a `typ` claim.** Rejected: every existing route
  would accept it unless each one learnt to refuse it (fail-open), and the codebase already treats JWT claims
  as non-authoritative (D6, #102).
- **Parent session persisted on the tablet (status quo).** Rejected by ADR-0002: exposes parent-only data and
  makes revocation and attribution impossible without signing the parent out everywhere (`/api/auth/logout`
  bumps `token_version` for all of that parent's sessions).
- **Tablet shows a code and a parent confirms on the phone (device-initiated).** Viable, and the confirmation
  step keeps most of its benefit. Rejected as the primary path because the issue asked for a parent-initiated
  code and because it needs an unauthenticated "create pending device" endpoint anyone can call.
- **Account password for elevation.** Kept as the fallback. Not the default because typing the parent's full
  account password on a wall screen in front of the household leaks a credential that works from anywhere; a
  PIN leak only works on a paired tablet of that household and is rate-limited and lockable.
- **Elevation grants a full parent session on the tablet.** Rejected: it re-creates the persisted-parent
  problem for the elevation window and puts finance/medical/messages on a shared screen.
- **Single long-lived device token without rotation.** Rejected: no theft detection and a stolen copy lives
  until manually revoked.

## Consequences
### Positive
- Device identity is structurally distinct; forgetting to add a device check to an existing route fails closed.
- Lost-tablet revocation is one parent action and needs no password change.
- The shared DTO already exists; the device read path is mostly re-use.
- Shared-device actions become attributable (device id, and member or elevated parent id).

### Costs/risks
- Three new tables plus one PIN table, new routes, a new layout and a middleware branch.
- Some domain logic must be extracted from route handlers into shared functions so `/api/device/*` does not
  fork business rules (AGENTS.md: one backend).
- Refresh rotation in a WebView can race with process death; mitigated by the 60-second "successor never used" grace rule and an
  Android cookie flush on pause.
- Elevation PIN is a new credential to store (bcrypt), rate-limit, reset and explain.

## Compatibility / migration
- Schema: additive tables only; no change to `User`, `Family` or existing columns. Rollback of app code leaves
  unused tables behind, which is safe.
- Person sessions, cookies, JWT claims, `token_version` semantics and CSRF exemptions are unchanged.
- Installed Android builds (currently `versionCode 1`) load the web app from the server, so device mode needs no
  new APK. Native improvements (cookie flush, back behaviour, kiosk) are additive and ship later.
- Kill switch off: device routes return 404 and device cookies are ignored; tablets fall back to the current
  person sign-in behaviour. Turning the switch on in production is a Cameron-approved action.
- No existing tablet is migrated automatically; the boundary in #157 ("no production auth/session migration")
  holds.

## Security / privacy
- Household ownership: `HouseholdDevice.family_id` from the pairing record; `DeviceSession.family_id` denormalised
  and checked equal; every device query is scoped by it. Foreign ids return the same 404 as missing ids.
- Role/device context: device capability comes from a server-side allowlist, never from the client; elevated
  requests re-read the parent's role, family and `token_version` on every request.
- Data exposure: prohibited domains are enumerated in `SHARED_DEVICE.md` and guarded by a route-allowlist test.
- No reusable parent credential is persisted in shared mode: no `session_token` is issued to a device, login is
  refused while a device cookie is present, and elevation tokens are memory-only.
- Provider implications: none. The device never spends the household AI key (capture is prohibited).

## Validation
- Route-allowlist test: every `src/app/api/**/route.ts` handler refuses a device-only request unless listed.
- Two-household/device negative tests and revocation/rotation/elevation tests in `SHARED_DEVICE.md` §14.
- E2E: pair, view, elevate, auto-return, revoke, cache purge, with privacy canaries on HTML and RSC payload.
- Android: process death during refresh, old APK against new server.

## Revisit trigger
- Android WebView cookie persistence proves unreliable enough that devices re-pair more than rarely (then move
  the refresh token to native secure storage via a plugin).
- Households need parent-only data on the tablet under elevation (would need a new privacy decision).
- A future versioned public API or native client supersedes cookie-based device auth.
