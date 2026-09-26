# Shared Device Contract

**Status:** Proposed (#157). Nothing in this document is implemented yet. Decision record: ADR-0006
(`adr/0006-shared-device-session-contract.md`), which implements ADR-0002.
**Last grounded against source:** 2026-09-26.
**Parent:** #127. **Related:** #120 (Android appliance), #131 (Figma), #136 (security), #159 (Today board),
#162 (offline/idempotency).

This is the implementation contract for a fridge/wall tablet that belongs to a household rather than to a
person. It covers identity, tokens, pairing, elevation, revocation, the shared allowlist, audit, abuse limits,
endpoints, compatibility and tests. Numbers marked **(O-n)** are recommended defaults for an open owner decision
listed in §16.

Until the child issues in §17 ship, a tablet signed in as a person has exactly that person's rights
(`docs/ROLE_AND_ISOLATION_MATRIX.md`).

## 1. Source facts this contract builds on

| Fact | Source |
|---|---|
| Person auth is a 7-day JWT in the httpOnly `session_token` cookie. | `src/lib/auth.ts` `signToken`, `src/app/api/auth/login/route.ts` |
| Every auth path resolves `role`, `family_id`, `token_version` from the database per request; JWT claims are not authoritative. | `src/lib/session.ts` `resolveSession`, `verifySessionToken` |
| Logout and password reset/change bump `User.token_version`, revoking all of that person's sessions. | `src/app/api/auth/logout/route.ts`, `src/lib/tokens.ts` `consumeResetToken` |
| CSRF is a double-submit cookie (`csrf_token` + `X-CSRF-Token`) on every unsafe `/api/*` method except a fixed exemption list. | `src/middleware.ts`, `src/lib/csrf.ts` |
| Middleware only gates `/dashboard` and auth routes, and applies the kid allowlist. | `src/middleware.ts`, `src/lib/kid-access.ts` |
| Single-use secrets are stored as `sha256` hex and consumed with one atomic `updateMany`. | `src/lib/tokens.ts` |
| Rate limiting is Postgres-backed (`RateLimitEntry`, unique `key`), counts every call (`checkRateLimit`) or only failures (`isRateLimited` + `checkRateLimit` on failure), and falls back to per-process memory on DB error. | `src/lib/rate-limit-db.ts` |
| Client IP is taken `TRUSTED_PROXY_HOPS` from the right of `X-Forwarded-For`. | `src/lib/client-ip.ts` |
| Role capability helpers: `isParentRole`, `canCreateList`, `shapeHandoffForRole`, etc. | `src/lib/role-capabilities.ts` |
| Shared-surface DTO with explicit `select`s, scoped by `family_id`. | `src/app/dashboard/today/today-board-data.ts` |
| `buildTodayBoard` derives links from `canRoleAccessPath(role, …)`; a `null`/unknown role is treated as non-kid and would get **every** link. | `today-board-data.ts` `allowedLink`, `src/lib/kid-access.ts` |
| Dashboard layout passes `id, email, name, role, age, family_id, avatar_url, xp, level, streak, created_at` to `DashboardNav` and `TabBar`, so fridge mode still serialises them. | `src/app/dashboard/layout.tsx` |
| `Activity.user_id` is required, so device events cannot be stored there without a contract change. | `prisma/schema.prisma` `Activity` |
| `ListItem.added_by`, `Chore.created_by`, `Event.created_by`, `FamilyMeal.created_by` are required `User` FKs. | `prisma/schema.prisma` |
| Android is a Capacitor shell loading `https://family.ashbi.ca`; `MainActivity` is a bare `BridgeActivity`; backup and device transfer are disabled. | `capacitor.config.ts`, `android/app/src/main/java/.../MainActivity.java`, `docs/architecture/ANDROID.md` |
| The schema is applied by idempotent DDL on every container start (`CREATE TABLE IF NOT EXISTS`, `ADD COLUMN IF NOT EXISTS`, FK `DO $$ … duplicate_object`). | `scripts/migrate.js` |
| No scheduled jobs without Cameron's approval. | `AGENTS.md` |

## 2. Identity and ownership

- A **shared device** is a `HouseholdDevice` row. It belongs to exactly one `Family` (`family_id`, cascade on
  family delete). It is not a `User`, has no email, no password and no role.
- The parent who created the pairing code is recorded (`created_by`, `SetNull` on user delete). The device does
  **not** belong to that parent: removing the parent from the household, changing their role or signing them out
  does not affect the device.
- A device's credentials are `DeviceSession` rows. A device has at most one live (unrotated, unrevoked) session
  generation at a time.
- The device's household is always read from the database (`DeviceSession.family_id`, which must equal
  `HouseholdDevice.family_id`). Nothing the client sends (`family_id`, member id, role) is trusted without a
  household check (AUTHORIZATION.md "relationship injection").
- Actors on a device request:
  - `device` — the shared surface, no person;
  - `device + member` — a household member tapped their name for attribution (**O-5**); this never grants that
    member's capabilities;
  - `device + elevated parent` — a parent proved identity on the tablet (§6).

## 3. Data model (additive sketches)

All models are new. No existing column changes. Prisma sketches below; the implementing PR adds matching
relations on `Family` and `User` (list fields only, no new scalar columns).

```prisma
model HouseholdDevice {
  id                    String    @id @default(cuid())
  family_id             String
  label                 String    // parent-chosen, 1–40 chars, e.g. "Kitchen tablet"
  platform              String    // 'android' | 'web'
  created_by            String?   // parent who created the pairing code
  confirmed_by          String?   // parent who confirmed the claim
  paired_at             DateTime  @default(now())
  last_seen_at          DateTime?
  last_seen_app_version String?   // Android versionName or 'web', max 32 chars
  revoked_at            DateTime?
  revoked_by            String?   // null = system (token reuse, family deleted)
  revoke_reason         String?   // 'parent' | 'lost' | 'replaced' | 'token_reuse'
  // Elevation overlay: at most one per device (§6). Server keeps only a hash.
  elevation_token_hash    String?   @unique
  elevated_user_id        String?
  elevated_token_version  Int?      // User.token_version at elevation time
  elevation_method        String?   // 'pin' | 'password'
  elevation_started_at    DateTime?
  elevation_last_used_at  DateTime?
  elevation_expires_at    DateTime? // started + 15 min absolute
  created_at            DateTime  @default(now())
  updated_at            DateTime  @updatedAt

  family    Family          @relation(fields: [family_id], references: [id], onDelete: Cascade)
  creator   User?           @relation("DeviceCreator", fields: [created_by], references: [id], onDelete: SetNull)
  sessions  DeviceSession[]
  events    DeviceAuditEvent[]

  @@index([family_id, revoked_at])
}

model DevicePairing {
  id                 String    @id @default(cuid())
  family_id          String
  code_hash          String    @unique  // sha256(normalised 8-char code)
  label              String             // becomes HouseholdDevice.label
  created_by         String             // parent
  expires_at         DateTime           // created_at + 10 min
  claimed_at         DateTime?
  claim_token_hash   String?   @unique  // tablet's pending-claim handle, memory-only on the tablet
  confirm_digits_hash String?           // sha256 of the 4 digits shown on the tablet
  confirm_attempts   Int       @default(0)
  claim_platform     String?
  claim_app_version  String?
  confirmed_at       DateTime?
  confirmed_by       String?
  cancelled_at       DateTime?          // parent cancel/deny, or 3 wrong digit attempts
  device_id          String?   @unique  // set once, when the session is issued
  created_at         DateTime  @default(now())

  family  Family @relation(fields: [family_id], references: [id], onDelete: Cascade)
  creator User   @relation("DevicePairingCreator", fields: [created_by], references: [id], onDelete: Cascade)

  @@index([family_id, expires_at])
}

model DeviceSession {
  id                 String    @id @default(cuid())
  device_id          String
  family_id          String    // denormalised; must equal device.family_id
  access_token_hash  String    @unique
  access_expires_at  DateTime  // issued + 60 min
  refresh_token_hash String    @unique
  refresh_expires_at DateTime  // issued + 30 days (idle; each rotation restarts it)
  first_used_at      DateTime? // first access or refresh with this generation
  rotated_at         DateTime? // this generation was replaced
  replaced_by_id     String?   @unique
  revoked_at         DateTime?
  created_at         DateTime  @default(now())

  device HouseholdDevice @relation(fields: [device_id], references: [id], onDelete: Cascade)

  @@index([device_id, revoked_at])
  @@index([family_id])
}

model ParentElevationPin {
  user_id      String    @id
  family_id    String
  pin_hash     String    // bcrypt cost 12 (src/lib/auth.ts hashPassword)
  locked_until DateTime? // set by the cross-device lockout (§11)
  created_at   DateTime  @default(now())
  updated_at   DateTime  @updatedAt

  user   User   @relation("ParentElevationPin", fields: [user_id], references: [id], onDelete: Cascade)
  family Family @relation(fields: [family_id], references: [id], onDelete: Cascade)

  @@index([family_id])
}

model DeviceAuditEvent {
  id            String   @id @default(cuid())
  family_id     String
  device_id     String?
  actor_user_id String?  // parent (management, elevation) or member (attributed action); null = device/system
  type          String   // fixed vocabulary, §10
  metadata      Json?    // fixed keys only, §10; never content, credentials or IPs
  created_at    DateTime @default(now())

  family Family           @relation(fields: [family_id], references: [id], onDelete: Cascade)
  device HouseholdDevice? @relation(fields: [device_id], references: [id], onDelete: SetNull)
  actor  User?            @relation("DeviceAuditActor", fields: [actor_user_id], references: [id], onDelete: SetNull)

  @@index([family_id, created_at])
  @@index([device_id, created_at])
}
```

Notes:

- `ParentElevationPin.family_id` must be re-checked against `User.family_id` on use; a parent who moves household
  keeps no PIN power in the old one (and the row is deleted when `family_id` differs at use).
- The PIN is kept off `User` so the many `user` selects in the codebase cannot widen into it by accident.
- Retention without a scheduler: rotated `DeviceSession` rows older than 7 days are deleted for that device on
  each refresh; expired `DevicePairing` rows older than 1 day and `DeviceAuditEvent` rows older than 180 days
  (**O-12**) are deleted for that family when a parent opens the device list. Revoked devices stay listed for 30
  days, then are hidden (not deleted) until their last audit row ages out.

### 3.1 `scripts/migrate.js` DDL notes

All five tables reference `Family`/`User`, which are created in `CREATE_TABLES_SQL`, so the DDL belongs in
`CREATE_TABLES_SQL` (not `POST_FEATURE_SQL`). Pattern, for `HouseholdDevice`:

```sql
-- ============ HouseholdDevice (#157 shared device; additive) ============
CREATE TABLE IF NOT EXISTS "HouseholdDevice" (
  "id" TEXT PRIMARY KEY,
  "family_id" TEXT NOT NULL,
  "label" TEXT NOT NULL,
  "platform" TEXT NOT NULL,
  "created_by" TEXT,
  "confirmed_by" TEXT,
  "paired_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "last_seen_at" TIMESTAMP(3),
  "last_seen_app_version" TEXT,
  "revoked_at" TIMESTAMP(3),
  "revoked_by" TEXT,
  "revoke_reason" TEXT,
  "elevation_token_hash" TEXT,
  "elevated_user_id" TEXT,
  "elevated_token_version" INTEGER,
  "elevation_method" TEXT,
  "elevation_started_at" TIMESTAMP(3),
  "elevation_last_used_at" TIMESTAMP(3),
  "elevation_expires_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS "HouseholdDevice_elevation_token_hash_key" ON "HouseholdDevice"("elevation_token_hash");
CREATE INDEX IF NOT EXISTS "HouseholdDevice_family_id_revoked_at_idx" ON "HouseholdDevice"("family_id", "revoked_at");
```

and, in the idempotent foreign-key block:

```sql
DO $$ BEGIN
  ALTER TABLE "HouseholdDevice" ADD CONSTRAINT "HouseholdDevice_family_id_fkey" FOREIGN KEY ("family_id") REFERENCES "Family"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "HouseholdDevice" ADD CONSTRAINT "HouseholdDevice_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
```

Repeat for `DevicePairing`, `DeviceSession` (FK `device_id` cascade), `ParentElevationPin` (FKs `user_id`,
`family_id` cascade) and `DeviceAuditEvent` (`family_id` cascade, `device_id` and `actor_user_id` set null), with
every `@unique`/`@@index` above as `CREATE [UNIQUE] INDEX IF NOT EXISTS` using Prisma's default names
(`<Model>_<cols>_key` / `_idx`). Expand only: no backfill, no contract step, nothing to roll back beyond leaving
the empty tables. The implementing PR must run `npx prisma generate`, a fresh-database `node scripts/migrate.js`
and a second run to prove idempotency.

## 4. Tokens, cookies and rotation

| Item | Value |
|---|---|
| Access token | `fpd1_a_` + base64url(32 random bytes). Opaque, not a JWT. |
| Refresh token | `fpd1_r_` + base64url(32 random bytes). Single use. |
| At rest | `sha256` hex only (`hashToken` in `src/lib/tokens.ts`). Plaintext exists only in the `Set-Cookie` header. |
| Access TTL | 60 minutes. |
| Refresh TTL | 30 days idle (**O-8**); each rotation issues a new 30-day refresh. No absolute cap while the device keeps refreshing. |
| Access cookie | `fp_device`, httpOnly, `Secure` in production (same rule as `session_token`), `SameSite=Lax`, `Path=/`, `Max-Age=3600`. |
| Refresh cookie | `fp_device_refresh`, httpOnly, `Secure` in production, `SameSite=Strict`, `Path=/api/device/session`, `Max-Age=2592000`. Sent only to the refresh endpoint. |
| Elevation token | `fpd1_e_` + base64url(32 bytes). Returned in the JSON body, held in JS memory only, sent as `X-Device-Elevation`. Never a cookie, never in storage. |
| Pairing claim token | `fpd1_p_` + base64url(32 bytes). JSON body, memory only, sent in the status POST body. |

The `fpd1_` prefix versions the format and makes the values recognisable to secret scanners.

**Per-request resolution** (`src/lib/device-session.ts`, new): one query,
`deviceSession.findUnique({ where: { access_token_hash }, select: { access_expires_at, revoked_at, rotated_at, family_id, device: { select: { id, family_id, label, revoked_at, elevation_* } } } })`.
Reject when missing, expired, rotated, session revoked, device revoked, or `session.family_id !== device.family_id`.
Set `first_used_at` if null. Update `HouseholdDevice.last_seen_at` at most once per 5 minutes. Fail closed on
database error, as the middleware does for person sessions.

**Refresh** (`POST /api/device/session/refresh`): look up `refresh_token_hash`.

1. Not found, expired, or session/device revoked → `401 DEVICE_SESSION_INVALID` (or `DEVICE_REVOKED` when the
   device row is revoked) and clear both cookies.
2. Live and unrotated → in one transaction create the successor session, set `rotated_at` and `replaced_by_id` on
   the old row, return new cookies.
3. Already rotated and the successor has **never been used** (`first_used_at` null) → the client lost the previous
   response (WebView killed mid-refresh). Revoke the unused successor, issue a fresh successor from this row,
   return new cookies. No time window is needed: a legitimate device uses its successor within one access TTL.
4. Already rotated and the successor **has been used** → token reuse. Revoke the device
   (`revoke_reason = 'token_reuse'`, `revoked_by = null`), write `device.token_reuse_detected`, return
   `401 DEVICE_REVOKED`. This also kills a thief who refreshed first.

Refresh is a normal CSRF-protected POST (the tablet page has a `csrf_token` cookie from the middleware); no new
CSRF exemption is added anywhere in this contract.

**Client refresh rule:** on `401 DEVICE_ACCESS_EXPIRED` call refresh once, then retry the original request once.
On `DEVICE_REVOKED` or `DEVICE_SESSION_INVALID` from anything, run the purge in §8. Refresh proactively when the
access token has less than 5 minutes left and the page is visible. A single in-flight refresh is shared by all
callers.

**Coexistence with person cookies:**

- Pairing completion clears `session_token` on that browser (`Max-Age=0`). It does **not** bump
  `token_version`, so the parent's other sessions keep working.
- `POST /api/auth/login` returns `409 DEVICE_MODE_LOGIN_BLOCKED` when the request carries a valid device cookie
  (**O-13**), so a parent cannot leave a persisted parent session on a shared tablet. Parents use elevation instead.
- `/device/*` pages and `/api/device/*` routes authenticate only the device cookie. `/dashboard/*` pages and all
  existing `/api/*` routes authenticate only `session_token`, so a device alone is redirected to `/login` or gets
  `401`.

## 5. Pairing

### 5.1 Flow

1. **Initiate (parent, phone or desktop).** Settings → Devices → "Pair a tablet". Parent enters a label.
   `POST /api/family/devices/pairings` (person session, `isParentRole`, same household). Server creates a
   `DevicePairing` and returns the code once, formatted `ABCD-EFGH`, and `expiresAt`.
2. **Claim (tablet).** The tablet opens `/device/pair` (public page, no session needed) and types the code.
   `POST /api/device/pair/claim { code, platform, appVersion }`. Server normalises the code, hashes it, and in one
   `updateMany` sets `claimed_at`, `claim_token_hash`, `confirm_digits_hash`, `claim_platform`,
   `claim_app_version` where `code_hash` matches, `expires_at > now`, `claimed_at IS NULL`, `cancelled_at IS NULL`.
   Zero rows → uniform `400 PAIRING_CODE_INVALID` (same for unknown, expired, used, cancelled). One row → returns
   `claimToken`, the 4 random `confirmDigits` (shown large on the tablet), and `expiresAt` (the code's original
   expiry; claiming does not extend it).
3. **Confirm (parent).** The parent's pairing dialog polls `GET /api/family/devices/pairings/:id` (every 3 s while
   the dialog is open, stops at expiry) and switches to "Type the number shown on the tablet" when claimed. The
   parent types it: `POST /api/family/devices/pairings/:id/confirm { digits }`. Wrong digits increment
   `confirm_attempts`; the third wrong attempt cancels the pairing. Right digits set `confirmed_at`/`confirmed_by`.
   The parent can instead press "This isn't my tablet" (`DELETE …/pairings/:id`), which cancels it.
4. **Issue (tablet).** The tablet polls `POST /api/device/pair/status { claimToken }` every 3 s until expiry.
   After confirmation, the first status call atomically sets `DevicePairing.device_id` (where it is still null),
   creates `HouseholdDevice` + `DeviceSession`, sets the device cookies, clears `session_token`, and returns
   `{ status: 'paired', device: { id, label } }`. Any later status call with that claim token returns
   `410 PAIRING_EXPIRED`. The tablet navigates to `/device/today`.

The 4-digit confirmation defeats a shoulder-surfed or intercepted code: an attacker who claims first gets the
digits on **their** screen, the real tablet shows "code already used", and the parent has nothing correct to type
(**O-6**).

### 5.2 Code format

- 8 characters from Crockford base32 (`0-9 A-Z` without `I L O U`): 32^8 ≈ 1.1 × 10^12 values.
- Displayed `XXXX-XXXX`. Input normalised: uppercase, strip spaces and hyphens, map `O→0`, `I→1`, `L→1`.
- Generated with `crypto.randomInt`; retried on the (unlikely) `code_hash` unique collision.
- Expiry 10 minutes. Single use. At most 3 unexpired, unclaimed codes per household; creating a fourth cancels the
  oldest.
- Purpose-limited: a code can only claim a pairing; it is not a session, invite or login credential, and the claim
  token can only poll that pairing.

### 5.3 Limits

- Max 5 active (unrevoked) devices per household (**O-9**); pairing creation returns `409 DEVICE_LIMIT_REACHED`.
- Rate limits in §11.

## 6. Elevation (parent on the tablet)

### 6.1 Credential (O-1)

- **Recommended:** a per-parent 6-digit **elevation PIN**, set from the parent's own person session
  (`PUT /api/users/elevation-pin`, which also requires the current account password). Stored as bcrypt cost 12 in
  `ParentElevationPin`. It is useful only through a live device session of the same household, is rate-limited
  and lockable, and cannot sign in anywhere. PIN rules: exactly 6 digits; reject the 20 most common PINs
  (`000000`, `123456`, repeated digits, simple ascending/descending runs).
- **Fallback:** the parent's account password, for a parent with no PIN or a locked PIN. It shares the login
  account-failure key (`login-fail:<email>`), so elevation cannot be used to bypass login lockout.
- **Alternative (not recommended):** password only in v1. Simpler (no new credential) but puts the full account
  password on a shared wall screen.
- A password **reset** (`consumeResetToken`) deletes the parent's `ParentElevationPin`, because reset implies
  possible compromise. A password **change** does not.

### 6.2 Flow

1. The tablet shows "Parent" → member picker listing parents only (names from `GET /api/device/me`).
2. Parent enters PIN (or password). `POST /api/device/elevation { userId, method, secret }`.
3. Server checks, in order: device session valid; `userId` is a member of the device's household with
   `role = 'parent'` (database); rate limits (§11); PIN lock; bcrypt compare (always run against a dummy hash
   when no PIN exists, as `safeVerifyPassword` does). Every failure returns the same
   `401 ELEVATION_INVALID_CREDENTIAL`, whether the user is unknown, foreign, not a parent or the secret is wrong.
4. Success writes the elevation columns on `HouseholdDevice` (replacing any earlier elevation), records
   `elevated_token_version = User.token_version`, and returns `{ elevationToken, expiresAt, idleTimeoutSeconds:
   300, member: { id, name } }`.

### 6.3 Enforcement

- Every elevated request sends `X-Device-Elevation`. The server matches its hash against the device row, then
  re-reads the parent (`role`, `family_id`, `token_version`) in one extra query. The elevation is void if the
  parent is no longer a parent, moved household, or `token_version` changed (logout, password change or reset).
- Idle timeout **5 minutes**, absolute **15 minutes** (**O-2**). Each successful elevated request moves
  `elevation_last_used_at`; the server rejects with `403 ELEVATION_EXPIRED` past either limit and clears the
  columns.
- The client drops the token and returns to shared mode on: expiry (a visible countdown banner in the last
  60 seconds), the "Done" button, `visibilitychange` to hidden, `pagehide`, navigation to the shared home, reload
  and process death (memory-only token). It calls `DELETE /api/device/elevation` best effort; the server limits
  apply regardless.
- Elevation is bound to the device: the token is useless with another device's cookie.
- Elevation never issues `session_token`, never unlocks `/dashboard/*` pages and never changes the device's read
  DTO. Responses to elevated requests carry `Cache-Control: no-store` and are never written to the offline
  snapshot.

### 6.4 What elevation allows (O-3)

Recommended v1 elevated capabilities, all on the shared surface, all audited as `device.elevated_action`:

- rename or revoke **this** device;
- approve/verify chore completions (`ChoreAssignment`/`Chore` verify rules unchanged);
- edit and delete grocery list items and lists (parent-only deletes, D9);
- create/edit events and dinners from the tablet (once those tablet flows exist);
- change tablet display preferences (night dim, screen-on window; #120).

Never under elevation in v1 (parents use their own phone): budget/transactions, allowance, messages,
medications/sick days/emergency cards, locations/addresses, pickups, handoff and share links, travel, account,
password, export, invites, family settings/features, AI settings/keys, feed token, calendar subscription URLs,
rewards approval with XP, device list for other devices, audit history.

## 7. Device management UX (parent)

Page: `/dashboard/settings/devices` (person session, parent only; teens and children do not see it).

- List: label, platform, "Paired 12 Sep", last seen ("Active now" under 10 minutes, "Seen 3 hours ago",
  "Not seen for 9 days" warning after 7 days), app version, status (Active / Removed / Expired).
- Actions per active device: **Rename**; **Remove tablet** (confirm dialog: "Remove Kitchen tablet? It stops
  showing your family's information the next time it connects." with optional reason Lost / Replaced / Other).
  Revoke is idempotent.
- **Pair a tablet** (creates a code) and **Replace** (pairs a new tablet with a "Remove Kitchen tablet when the new
  one is connected" checkbox, applied at confirmation).
- Recent activity per device: last 50 `DeviceAuditEvent` rows, rendered from the fixed vocabulary.
- Removed devices stay visible, greyed, for 30 days. There is no "restore": re-pair instead.
- Elevation PIN: Settings → Security → "Tablet PIN" (set, change, remove).

Tablet states:

- **Unpaired** (`/device/pair`): code entry, then the 4 confirmation digits, then pairing progress.
- **Paired** (`/device/today`): the Today board in fridge mode, chrome-free.
- **Removed / expired**: "This tablet was disconnected from its household. A parent can pair it again." with a
  "Pair this tablet" button. No household name or data.
- **Offline / stale**: existing Today board offline/stale states.
- **Unavailable** (kill switch off): "Tablet mode is not available right now." with a sign-in link.

Figma: no frames exist yet. **TODO (#131):** pair (phone create code, tablet enter code, tablet confirm digits,
phone type digits, success/expired/denied), device list and remove confirm, removed-tablet screen, elevation
(parent picker, PIN pad, lockout, elevated banner with countdown, auto-exit), PIN setup in settings, and
rate-limited states, at 1280×800, 800×1280 and 390×844. Implementation of the UI child issue should not start
large layout work before these frames exist (AGENTS.md "Figma-first").

## 8. Revocation, expiry and cached-state cleanup

**Server:**

- Revoke = set `HouseholdDevice.revoked_at`, `revoked_by`, `revoke_reason`, set `revoked_at` on all its
  `DeviceSession` rows and clear the elevation columns, in one transaction, then write `device.revoked`.
- Triggers: parent in device settings; elevated parent on the tablet ("Remove this tablet"); token reuse (§4);
  family deletion (cascade removes the rows, so the next request finds nothing → `DEVICE_SESSION_INVALID`).
- Effect: the next access, refresh or elevation returns `401 DEVICE_REVOKED` with `Set-Cookie` clearing
  `fp_device` and `fp_device_refresh`. Offline access never grants a future refresh.
- Idle expiry (no refresh for 30 days) returns `401 DEVICE_SESSION_INVALID` and the device shows as "Expired" in
  the list. It is not revoked, but it cannot be revived either; re-pair.

**Client purge** (runs on `DEVICE_REVOKED`, `DEVICE_SESSION_INVALID`, a device id different from the cached one, or
`404` from `/api/device/me` when the kill switch is off):

1. Drop in-memory state, the elevation token and any claim token.
2. Delete every client storage key under the `fp-device:v1:` namespace (localStorage and IndexedDB database
   `fp-device`) and any Cache Storage entry the device layer created.
3. Drop the offline mutation queue (#162). Pending items are not replayed; they were never server-confirmed.
4. Navigate (replace, not push) to the "Removed" screen.

**Cache rules (for #162):** the only cached payload is the latest device `TodayBoardData` plus `generatedAt`,
stored under `fp-device:v1:<deviceId>:today`. Never cache elevated responses, parent pages or any non-allowlisted
payload. Show stale age from `generatedAt`. After **24 hours** without a successful refresh (**O-7**) hide the
content and show "Reconnect to see today's plan" (a revoked tablet that never reconnects stops showing data).
Android backup and device transfer are already disabled (`ANDROID.md`), so cookies and storage do not leave the
tablet.

## 9. Shared capability and field allowlist

### 9.1 Device read surface (not elevated)

The device reads exactly the Today board DTO, built by `buildTodayBoard` with a new `audience: 'device'` option:

| DTO part | Fields | Source model |
|---|---|---|
| `members` | `id`, `name` | `User` (no email, age, avatar, role, XP, level, streak) |
| `events` | `id`, `title`, `start`, `end`, `isTask`, `source { name, color }` | `Event`, `CalendarSubscription` (no `location`, `description`, `recurrence`, `url_enc`) |
| `chores` | `id`, `title`, `dueDay`, `status`, `assigneeId` | `Chore` (no `description`, `points`, `photo_url`, `verified_notes`, `difficulty`) |
| `dinners` | `id`, `day`, `recipeName`, `cookName` | `FamilyMeal` (no `notes`); `null` when meals feature is off |
| `shopping` | `items[] { id, content, quantity, listId, listName }`, `total` | `ListItem`/`List` of type `grocery`/`shopping` (no `price`, `notes`, `added_by`) |
| `links` | all `null` for the device audience | — |
| `generatedAt` | server time | — |

Plus `GET /api/device/me`: `device { id, label }`, `household { name }` (`Family.name`), `features` (booleans for
calendar, chores, meals, lists only), `parents [{ id, name, hasPin }]`, `elevation { active, memberId, expiresAt }`.

**Required code change:** `buildTodayBoard` must not receive `role: null` for a device. `allowedLink` treats a
null role as non-kid and would return every link. The device audience sets all links to `null`; shopping is
included only when the `lists` feature is on.

### 9.2 Device writes

v1 ships **read-only**. The first write candidates, each behind #162 (idempotency key, device context in the
envelope) and a per-household flag:

| Action | Rule |
|---|---|
| Grocery item tick/untick | Existing list item of the household; attribution per **O-5**. |
| Grocery quick add | Existing grocery list of the household; `content` 1–200 chars; attribution per **O-5**. |
| Chore complete (**O-4**) | Chores due today of the household; status to `completed` (existing verify flow unchanged); no photo from the device; no XP shown on the device. |

Attribution (**O-5**): the tablet asks "Who's this?" and the chosen member id is written where a `User` FK is
required (`ListItem.added_by`, `checked_by`, `ChoreAssignment.completed_by`). The server verifies the member
belongs to the device's household. It records the device id in `DeviceAuditEvent`. The choice is unverified
attribution only: it never grants the member's capabilities.

### 9.3 Prohibited on a device (not elevated), with the models and routes that hold them

| Domain | Models / fields | Routes |
|---|---|---|
| Budget and finance | `Transaction`, `BudgetCategory`, `FinancialArchiveRecord`, `ListItem.price` | `/api/budget/**` |
| Allowance | `Allowance` | `/api/allowance/**` |
| Messages | `Message` | `/api/messages` |
| Notifications / push | `Notification`, `PushSubscription` | `/api/notifications` |
| Medical | `Medication`, `SickDay` | `/api/medications/**`, `/api/sick-days/**` |
| Emergency cards (**O-10**) | `EmergencyContact` (blood type, allergies, medications, insurance, phones, notes) | `/api/emergency-contacts/**` |
| Locations / addresses | `FamilyLocation` (`address`, lat/long), `Event.location`, `Pickup.location` | `/api/locations/**` |
| Pickups (**O-11**) | `Pickup` (`location`, `notes`) | `/api/pickups/**` |
| Handoff | `Handoff` (sitter phone, code words, authorised pickups, notes, `share_token`) | `/api/handoff/**` (public `/handoff/[token]` is unaffected) |
| Travel | `Family.travel_*` | `/api/family/travel` |
| Account and security | `User.email`, `age`, `password`, `reset_token`, `verify_token`, `token_version`, `ParentElevationPin` | `/api/users/**`, `/api/users/export`, `/api/auth/me`, `/api/auth/change-password` |
| Household admin | `FamilyInvite`, `Family.invite_code`, `features` writes, members management | `/api/family`, `/api/family/invites/**`, `/api/family/join`, `/api/family/members`, `/api/family/features` (write), `/api/family/lookup` |
| Secrets and tokens | `Family.capture_ai_key_enc`, `capture_ai_*`, `Family.feed_token`, `CalendarSubscription.url_enc`, device tokens | `/api/family/ai-settings`, `/api/family/feed-token`, `/api/calendar/feed/**`, `/api/calendar/subscriptions/**` |
| AI capture | spends the household AI key | `/api/capture` |
| Gamification | `User.xp`, `level`, `streak`, `best_streak`, `Reward`, `RewardRedemption`, `BadgeDefinition`, `EarnedBadge`, `Habit`, `HabitLog`, `FamilyGoal`, leaderboards | `/api/rewards/**` and any XP/leaderboard read |
| Wishlist | `WishlistItem` (gift surprises) | `/api/wishlist/**` |
| Notes and dates (**O-11**) | `PinnedNote` (free-text body), `Anniversary` | `/api/notes/**`, `/api/anniversaries/**` |
| Projects | `Project`, `ProjectTask` | `/api/projects/**` |
| Activity and analytics | `Activity` | `/api/activity`, `/api/analytics/**` |
| Imports, uploads, files | `ImportJob`, `ImportedRecord`, `Upload` | `/api/admin/imports/**`, `/api/upload`, `/api/files/**` |
| Free text in allowed domains | `Event.description`, `FamilyMeal.notes`, `Chore.description`, `Chore.verified_notes`, `ListItem.notes` | — |
| Destructive operations | any delete, member/role changes | all |
| Device management | other devices, audit history | `/api/family/devices/**` |

These routes need no change: they authenticate only `session_token`, so a device is refused. The route-allowlist
test (§14) keeps it that way.

## 10. Audit events

Stored in `DeviceAuditEvent`. `metadata` keys are fixed per type; no names, free text, codes, PINs, tokens, IPs or
user agents.

| Type | Actor | Metadata |
|---|---|---|
| `device.pairing_created` | parent | `{ pairingId }` |
| `device.pairing_claimed` | — | `{ pairingId, platform, appVersion }` |
| `device.pairing_confirmed` | parent | `{ pairingId }` |
| `device.pairing_cancelled` | parent or — | `{ pairingId, reason: 'parent' \| 'digits_mismatch' \| 'superseded' }` |
| `device.paired` | parent (confirmer) | `{ pairingId, platform }` |
| `device.renamed` | parent | `{}` |
| `device.revoked` | parent or — | `{ reason: 'parent' \| 'lost' \| 'replaced' \| 'token_reuse' }` |
| `device.token_reuse_detected` | — | `{ sessionId }` |
| `device.elevation_started` | parent | `{ method: 'pin' \| 'password' }` |
| `device.elevation_ended` | parent | `{ reason: 'exit' \| 'idle' \| 'max' \| 'revoked' \| 'credential_changed' }` (server-observed only) |
| `device.elevation_locked` | parent | `{ scope: 'device' \| 'account' }` |
| `device.elevated_action` | parent | `{ action, targetType, targetId }` (action from a fixed list) |
| `device.member_action` | member | `{ action, targetType, targetId }` |
| `parent_pin.set` / `parent_pin.removed` / `parent_pin.cleared_by_reset` | parent | `{}` |

Per-request activity (access, refresh, reads) is **not** audited; it only moves `last_seen_at`. Failed pairing
claims cannot be tied to a household and go to the structured log (`log.warn('device.pair_claim_throttled',
{ ipBucket })`) only when a rate limit trips. Privacy-safe analytics (FRIDGE_TABLET_PROGRAM.md §20
"device paired / revoked") may mirror `device.paired` and `device.revoked` with no identifiers beyond the event
name.

## 11. Rate limits and abuse cases

Keys use `checkRateLimit` (counts every call) unless marked *failure-only* (`isRateLimited` before, `checkRateLimit`
after a failure). All return `429 RATE_LIMITED` with `Retry-After`.

| Key | Limit | Window | Applies to |
|---|---|---|---|
| `device-pair-create:<userId>` | 5 | 1 h | pairing creation, per parent |
| `device-pair-create-fam:<familyId>` | 10 | 1 h | pairing creation, per household |
| `device-pair-claim:<ip>` | 10 | 15 min | claim attempts, per IP (all attempts) |
| `device-pair-claim-fail:global` | 500 | 1 h | failed claims system-wide; trips a `log.warn` alert, not a block |
| `device-pair-status:<pairingId>` | 300 | 10 min | tablet status polling (≈1 per 2 s) |
| `device-pair-poll:<userId>` | 300 | 10 min | parent status polling |
| `device-pair-confirm:<pairingId>` | 3 wrong digits | pairing life | then the pairing is cancelled |
| `device-refresh:<deviceId>` | 30 | 1 h | refresh per device |
| `device-refresh-ip:<ip>` | 60 | 15 min | refresh per IP (unknown tokens) |
| `device-elev-fail:<deviceId>:<userId>` | 5 *failure-only* | 15 min | wrong PIN/password for one parent on one tablet |
| `device-elev-fail:<deviceId>` | 10 *failure-only* | 15 min | any parent on one tablet |
| `device-elev-fail-acct:<userId>` | 10 *failure-only* | 1 h | one parent across all tablets; on trip set `ParentElevationPin.locked_until = now + 1 h` and audit `device.elevation_locked` |
| `login-fail:<email>` | existing 10 *failure-only* | 15 min | password-method elevation shares the login account key |
| `device-revoke:<userId>` | 30 | 1 h | revoke/rename per parent |
| `device-pin-set:<userId>` | 5 | 1 h | PIN set/change (requires current password) |

Abuse cases and responses:

| Case | Mitigation |
|---|---|
| Brute-forcing a pairing code | 1.1 × 10^12 space, 10-minute life, ≤3 live codes per household, per-IP limit, global failure alert, uniform error. |
| Shoulder-surfed or photographed code | Parent confirmation by typing the tablet's 4 digits; attacker's claim leaves the real tablet failing visibly. |
| Replay of a used code | Atomic single-use claim. |
| Code creation spam by a parent | Per-parent and per-household limits, 3 live codes, 5 active devices. |
| Stolen access cookie | 60-minute life; revocation effective on next request. |
| Stolen refresh cookie | Rotation with reuse detection revokes the device (§4). |
| Stolen tablet | Parent revokes from phone; offline display hides after 24 h (**O-7**). |
| Child guessing the parent PIN | 5 failures per parent per tablet per 15 min, 10 per tablet, account lock after 10 per hour; password fallback shares login lockout. |
| Elevated session left open | 5-minute idle, 15-minute absolute, hide/exit drops it. |
| Parent logs in on the tablet | Login refused while a device cookie is present (409). |
| Foreign ids in device requests | Every lookup scoped by the device's `family_id`; foreign equals not found. |
| Rate-limit table unavailable | `checkRateLimit` falls back to per-process memory (fails open by design). Pairing and elevation still require the single-use code, confirmation digits and bcrypt, so the fallback weakens but does not remove protection; the implementing PR logs the fallback. |
| Device used to spend AI or provider quota | Capture and all provider-backed routes prohibited. |

## 12. API endpoints

Error envelope for all new routes (API_CONTRACTS.md target shape):
`{ "error": { "code": "…", "message": "…", "retryable": false } }`. All device responses send
`Cache-Control: private, no-store`. All unsafe methods require CSRF (existing middleware, no new exemptions).
When the kill switch is off every route below returns `404`.

### 12.1 Parent routes (person session, `role = 'parent'`, same household)

| Method | Path | Request | Response | Errors |
|---|---|---|---|---|
| POST | `/api/family/devices/pairings` | `{ label }` (1–40 chars) | `201 { pairingId, code: "ABCD-EFGH", expiresAt }` | 401, 403 `PARENT_REQUIRED`, 409 `DEVICE_LIMIT_REACHED`, 429 |
| GET | `/api/family/devices/pairings/:id` | — | `200 { status: 'waiting' \| 'claimed' \| 'confirmed' \| 'paired' \| 'expired' \| 'cancelled', claim?: { platform, appVersion } }` (never the digits) | 401, 403, 404, 429 |
| POST | `/api/family/devices/pairings/:id/confirm` | `{ digits }` (4 digits) | `200 { status: 'confirmed' }` | 400 `PAIRING_DIGITS_MISMATCH` (`attemptsLeft`), 404, 410 `PAIRING_EXPIRED` / `PAIRING_CANCELLED` |
| DELETE | `/api/family/devices/pairings/:id` | — | `204` (idempotent) | 401, 403, 404 |
| GET | `/api/family/devices` | — | `200 { devices: [{ id, label, platform, pairedAt, lastSeenAt, appVersion, status: 'active' \| 'removed' \| 'expired', revokedAt, revokeReason }] }` | 401, 403 |
| PATCH | `/api/family/devices/:id` | `{ label }` | `200 { device }` | 400, 401, 403, 404 |
| POST | `/api/family/devices/:id/revoke` | `{ reason?: 'lost' \| 'replaced' \| 'other' }` | `200 { device }` (idempotent) | 401, 403, 404, 429 |
| GET | `/api/family/devices/:id/events` | `?cursor` | `200 { events: [{ type, actorName?, createdAt, metadata }], nextCursor }` (50 per page) | 401, 403, 404 |
| PUT | `/api/users/elevation-pin` | `{ pin, currentPassword }` | `204` | 400 `PIN_TOO_WEAK`, 401 `INVALID_PASSWORD`, 403, 429 |
| DELETE | `/api/users/elevation-pin` | — | `204` | 401, 403 |

Teen and child sessions get `403 PARENT_REQUIRED` on every row. Foreign ids get `404`.

### 12.2 Pairing routes (no session)

| Method | Path | Request | Response | Errors |
|---|---|---|---|---|
| POST | `/api/device/pair/claim` | `{ code, platform: 'android' \| 'web', appVersion }` | `200 { claimToken, confirmDigits, expiresAt }` | 400 `PAIRING_CODE_INVALID` (uniform), 429 |
| POST | `/api/device/pair/status` | `{ claimToken }` | `200 { status: 'pending' }` or `200 { status: 'paired', device: { id, label } }` + device cookies, `session_token` cleared | 410 `PAIRING_EXPIRED` / `PAIRING_CANCELLED`, 429 |

### 12.3 Device routes (device cookie)

| Method | Path | Request | Response | Errors |
|---|---|---|---|---|
| POST | `/api/device/session/refresh` | refresh cookie | `200 { accessExpiresAt }` + rotated cookies | 401 `DEVICE_REVOKED` / `DEVICE_SESSION_INVALID` (cookies cleared), 429 |
| GET | `/api/device/me` | — | `200` (§9.1) | 401 `DEVICE_ACCESS_EXPIRED` / `DEVICE_REVOKED` / `DEVICE_SESSION_INVALID` |
| GET | `/api/device/today` | — | `200 TodayBoardData` (device audience) | 401 as above |
| POST | `/api/device/elevation` | `{ userId, method: 'pin' \| 'password', secret }` | `200 { elevationToken, expiresAt, idleTimeoutSeconds, member: { id, name } }` | 401 `ELEVATION_INVALID_CREDENTIAL`, 423 `ELEVATION_LOCKED`, 429 |
| DELETE | `/api/device/elevation` | `X-Device-Elevation` | `204` (idempotent) | 401 |
| POST | `/api/device/revoke-self` | `X-Device-Elevation` | `200` + cookies cleared | 403 `ELEVATION_REQUIRED` / `ELEVATION_EXPIRED` |
| PATCH | `/api/device/label` | `{ label }`, `X-Device-Elevation` | `200 { device }` | 403 `ELEVATION_REQUIRED` / `ELEVATION_EXPIRED` |

Phase 2 (after #162, flagged, **O-4/O-5**), shape only:
`PATCH /api/device/lists/items/:id { checked, actingMemberId, idempotencyKey }`,
`POST /api/device/lists/:id/items { content, actingMemberId, idempotencyKey }`,
`POST /api/device/chores/:id/complete { actingMemberId, idempotencyKey }`, and elevated
`POST /api/device/elevated/chores/:id/verify`. Each calls a domain function shared with the existing person
route; route handlers stay thin so business rules are not forked.

Pages: `/device/pair` (public), `/device/today`, `/device/removed`. Middleware: `/device/*` except
`/device/pair` and `/device/removed` requires a resolvable device cookie, else redirect to `/device/pair`; `/`
with a valid device cookie redirects to `/device/today` (the Capacitor start URL is the site root).

## 13. Compatibility

**Old Android clients.** The installed APK (`versionCode 1`, `versionName "1.0"`) is a WebView on
`server.url`. Device mode is served by the web layer, so any installed APK gets it with no update. Native
improvements (cookie flush on pause, back behaviour on `/device/*`, immersive/kiosk from #120) are additive and
optional. Older APKs that lack them only lose the process-death protection covered by §4 rule 3.

**Tablets signed in as a person today** keep working exactly as now (`/dashboard/today?mode=fridge`). There is no
automatic conversion; a parent opts in by pairing. No person session is revoked or migrated.

**Server rollout order.** (1) Ship tables and code with the kill switch off (inert). (2) Enable on a review
environment and run §14. (3) Enable in production (Cameron approval). Web and Android need no ordering because
the Android UI is served by the server.

**Server rollback.** Rolling back to a build without device routes: device cookies are ignored, `/device/*`
returns 404, tablets show the sign-in path. Tables stay (additive, unused). Rolling forward again: devices whose
refresh token has not expired resume; others re-pair. With the kill switch turned off (without rollback) the
client purge runs on `404 /api/device/me`, so turning it back on requires re-pairing; this is accepted.

**Kill switch.** Server env `SHARED_DEVICE_ENABLED` (default off). Setting it in production is an environment
change that needs Cameron's approval. A per-household opt-in (`Family.features` key) is not needed for v1.

**Person clients.** No change to `session_token`, JWT claims, `token_version`, `/api/auth/*` (other than the 409 on
login while a device cookie is present, which no existing client sends), CSRF exemptions or any existing route
response.

## 14. Test plan

Unit/route tests live next to the new routes (`src/app/api/device/**/__tests__/`,
`src/app/api/family/devices/**/__tests__/`) and in `src/lib/__tests__/device-session.test.ts`. Fixtures use two
synthetic households (docs/testing/TEST_DATA.md): **H1** with parent P1, teen T1, child C1, tablet D1 and a second
tablet D1b; **H2** with parent P2 and tablet D2. Each household has canary strings in every prohibited domain.

### 14.1 Structural

1. **Route allowlist:** enumerate every exported handler under `src/app/api/**/route.ts`; call each with only a
   valid D1 device cookie (plus CSRF); assert `401`/`404` for every route not in `DEVICE_ALLOWED_ROUTES`, and that
   no response body contains an H1 canary.
2. **Page allowlist (E2E):** with only D1's cookie, every `/dashboard/*` path redirects to `/login`; `/device/today`
   renders.
3. **Payload canaries (E2E):** `/device/today` HTML and RSC payload contain no member email, age, avatar URL, XP,
   level, streak, event location/description, meal notes, list item price/notes, or any prohibited-domain canary
   (closes the fridge-mode nav-props gap for devices).
4. `buildTodayBoard({ audience: 'device' })` returns all links `null`.

### 14.2 Two-household and two-device negatives

5. D1 `GET /api/device/today` returns only H1 data; no H2 canary.
6. D1 phase-2 writes against an H2 list item, list or chore → `404`, identical to a random id; nothing changes.
7. D1 with `actingMemberId` of an H2 member → `404`/`400`; nothing changes.
8. P2 `GET /api/family/devices` does not list D1; P2 revoke/rename/events on D1's id → `404`; D1 keeps working.
9. P2 confirm/cancel/poll on an H1 pairing id → `404`.
10. A code created by P2, claimed by a tablet whose body claims `family_id = H1` → device belongs to H2 only.
11. Elevation on D1 with P2's id and correct PIN/password → `401 ELEVATION_INVALID_CREDENTIAL`, counts toward limits.
12. Elevation on D1 with T1 or C1 ids and correct password → same `401`.
13. D1's elevation token sent with D1b's (same household) or D2's cookie → rejected.
14. Revoking D1 leaves D1b and D2 working.
15. P1 moved to H2 while elevated on D1 → next elevated request `403 ELEVATION_EXPIRED`; P1's PIN row for H1 is
    not usable on D1 or D2.

### 14.3 Tokens, revocation and expiry

16. Tokens are stored hashed: no plaintext `fpd1_` value in any table after pairing, refresh and elevation.
17. Access expired → `401 DEVICE_ACCESS_EXPIRED`; refresh → new cookies; old access token rejected.
18. Refresh reuse with unused successor → re-issue, device stays active.
19. Refresh reuse after the successor was used → device revoked, `device.token_reuse_detected`, both the old and
    the successor tokens rejected.
20. Revoke → next access, refresh and elevation return `401 DEVICE_REVOKED` with cookie-clearing headers.
21. Refresh after 30 days idle (fake clock) → `401 DEVICE_SESSION_INVALID`; list shows "Expired".
22. Family deletion → `401 DEVICE_SESSION_INVALID`.
23. E2E purge: seed `fp-device:v1:*` storage, revoke from P1, trigger a refresh; storage empty, queue dropped,
    removed screen shown, back navigation does not show cached data.
24. Offline snapshot older than 24 h is hidden (fake clock).

### 14.4 Pairing

25. Code is single use under concurrency (two parallel claims → one success).
26. Expired, used, cancelled and unknown codes return the identical `400 PAIRING_CODE_INVALID` body.
27. Fourth live code cancels the oldest; sixth active device → `409`.
28. Three wrong confirmation digits cancel the pairing; the tablet's status then returns `410`.
29. Status after `paired` returns `410`; a second status call cannot mint a second device.
30. Teen/child sessions get `403` on every parent route.
31. Rate limits in §11 trip at the documented counts with `Retry-After`.

### 14.5 Elevation

32. Idle 5 min and absolute 15 min expiry (fake clock) → `403 ELEVATION_EXPIRED`, columns cleared.
33. Parent logout, password change or reset (bumps `token_version`) ends elevation; reset also deletes the PIN.
34. Demoting the parent to teen ends elevation.
35. Elevated responses carry `no-store`; E2E asserts they are absent from `fp-device` storage.
36. E2E: `visibilitychange` hidden, reload and "Done" return the UI to shared mode; an elevated-only action then
    gets `403 ELEVATION_REQUIRED`.
37. Lockouts: 5/10/10 thresholds; account lock sets `locked_until`; password fallback shares `login-fail:<email>`.
38. Elevation never sets `session_token`; `/dashboard` stays inaccessible while elevated.

### 14.6 Coexistence and compatibility

39. Pairing clears `session_token` on the tablet and does not change P1's `token_version` (P1's phone session
    still works).
40. `POST /api/auth/login` with a valid device cookie → `409 DEVICE_MODE_LOGIN_BLOCKED`; without one, unchanged.
41. Existing suites (`src/__tests__/session-generation.test.ts`, `auth-tokens.test.ts`, every `isolation.test.ts`,
    `e2e/fridge.spec.ts`) pass unchanged.
42. Kill switch off: all device routes `404`, device cookies ignored, `/dashboard/today?mode=fridge` unchanged.
43. `node scripts/migrate.js` twice on a fresh database and once on a copy of the current schema: idempotent.
44. Android: current released APK against a candidate server pairs, shows the board, survives
    `adb shell am kill com.ashbi.familyplanner` during a refresh (rule 3), and handles revoke.

## 15. Security review checklist for implementers

- No new CSRF exemption; no device token in a URL, log line, analytics event or error message.
- `select` lists, never `include` of whole rows, on every device path.
- Constant-time comparisons are implicit (hash lookup); PIN/password use bcrypt with a dummy hash for unknown users.
- Device auth helper returns a discriminated actor type; no code path converts a device actor into a person
  `TokenPayload`.
- `docs/security/API_ISOLATION_AUDIT.md` gains rows for every new route.

## 16. Owner decisions

Genuinely open choices. Each has a recommended default that the child issues assume unless Cameron decides
otherwise on #157.

| # | Decision | Recommended default | Alternative |
|---|---|---|---|
| O-1 | Elevation credential | Per-parent 6-digit tablet PIN, password fallback | Account password only in v1 |
| O-2 | Elevation timeouts | 5 min idle, 15 min absolute | 2 min idle / 10 min absolute (stricter) |
| O-3 | Elevated scope | Short list of shared-surface parent actions (§6.4); parent-only data domains never on the tablet | Allow reading finance/messages/medical under elevation |
| O-4 | Kids complete chores from the tablet | Yes (phase 2): chores due today, completion pending parent verify, no photo, no XP shown | Chores read-only on the tablet |
| O-5 | Attribution of device writes | "Who's this?" member picker, unverified, device id audited | Device-only attribution (needs nullable `added_by`/`completed_by`, a contract migration) |
| O-6 | Pairing confirmation | Parent types the tablet's 4 digits | Code only, no confirmation step |
| O-7 | Offline snapshot max display age | 24 hours | 12 h or 72 h |
| O-8 | Refresh idle expiry | 30 days | 14 or 90 days |
| O-9 | Active devices per household | 5 | 3 or 10 |
| O-10 | Emergency contacts on the tablet | Excluded; later opt-in minimal card (contact name and phone only) | Show the kid-readable view |
| O-11 | Pinned notes, anniversaries, pickups on the tablet | Excluded in v1; per-domain opt-in later with field allowlists | Include pinned notes (a fridge note board is natural) |
| O-12 | Audit retention | 180 days, pruned on parent read | 90 or 365 days |
| O-13 | Block person login while a device cookie is present | Yes (409) | Allow, and warn |
| O-14 | "Turn this tablet into the family tablet" from a signed-in parent session | Defer; code flow only | Offer it, with password re-entry |

## 17. Child issues (ready to file)

### 17.1 `[Shared Device] Schema, device auth and API for pairing, sessions, elevation and revocation`

```markdown
Parent: #157
Depends on: #157 contract accepted (ADR-0006), owner decisions O-1…O-14 confirmed or defaulted
Related: #127, #136, #162, ADR-0002, ADR-0004

## Outcome
A household can pair, refresh, elevate on and revoke a shared device through the API, with device identity
fully separate from person sessions, behind a kill switch that defaults off.

## Scope
- Prisma models `HouseholdDevice`, `DevicePairing`, `DeviceSession`, `ParentElevationPin`, `DeviceAuditEvent`
  and relations (docs/architecture/SHARED_DEVICE.md §3); matching idempotent DDL in `scripts/migrate.js`
  `CREATE_TABLES_SQL` and the FK block (§3.1).
- `src/lib/device-session.ts`: token generation/hashing (`fpd1_*`), per-request resolution, refresh rotation with
  reuse detection (§4), elevation check, discriminated actor type, cookie helpers.
- Routes in §12.1–§12.3 (not phase-2 writes), error envelope, `Cache-Control: no-store`.
- `buildTodayBoard` `audience: 'device'` (links all null) and `GET /api/device/today`.
- Rate limits (§11) via `src/lib/rate-limit-db.ts`; audit writes (§10); opportunistic pruning (§3 notes), no cron.
- `POST /api/auth/login` 409 when a valid device cookie is present; password reset deletes `ParentElevationPin`.
- Middleware: `/device/*` gate and `/` redirect for a device cookie; no new CSRF exemptions.
- Kill switch `SHARED_DEVICE_ENABLED` (default off).
- Rows for every new route in `docs/security/API_ISOLATION_AUDIT.md`; matrix values move from "proposed" to
  "implemented" only for what ships.

## Out of scope
UI pages and dialogs; device writes (grocery/chore); offline cache; Android native changes; enabling the switch
in any shared environment.

## Acceptance criteria
- [ ] No existing route or page accepts a device cookie (route-allowlist test green).
- [ ] No plaintext device, claim, elevation token or PIN is stored.
- [ ] Pairing codes: 8 chars, 10 min, single use, ≤3 live per household, parent confirmation by 4 digits,
      uniform invalid error, rate-limited per parent, household, IP and pairing.
- [ ] Refresh rotates on every call; reuse after a used successor revokes the device.
- [ ] Revocation returns `401 DEVICE_REVOKED` with cookie clearing on the next access, refresh or elevation.
- [ ] Elevation: parent-only, PIN or password, 5 min idle / 15 min absolute, voided by role, household or
      `token_version` change; never sets `session_token`.
- [ ] Person auth behaviour unchanged except the documented login 409.
- [ ] Kill switch off: all device routes 404.

## Tests
SHARED_DEVICE.md §14.1 items 1 and 4, §14.2 items 5 and 8–15, §14.3 items 16–22, §14.4, §14.5 items 32–34 and
37–38, §14.6 items 39–43. Two-household fixtures per docs/testing/TEST_DATA.md. Commands: `npx prisma generate`,
`npm run typecheck`, `npm run lint`, `npm test -- --runInBand`, `npm run build`, fresh and repeat
`node scripts/migrate.js`.

## Boundary
No production deploy, no production env change (the kill switch stays off), no migration or revocation of
existing person sessions, no change to device-owner policy. Merge needs Cameron's approval.
```

### 17.2 `[Shared Device] Web UI: pairing, tablet shell, elevation and device management`

```markdown
Parent: #157
Depends on: schema/API child issue; Figma frames from #131 (pair, revoke, elevation, PIN setup)
Related: #119, #159, #151, #153, #162

## Outcome
A parent can pair a tablet from their phone, see and remove household tablets, and briefly act as a parent on the
tablet, while the tablet itself shows only the shared Today board and never holds a parent's session.

## Scope
- `/device/pair`: code entry, confirmation digits, progress, expired/cancelled/invalid/rate-limited states.
- `src/app/device/layout.tsx`: chrome-free layout that loads no person profile; `/device/today` renders
  `TodayBoard` in fridge mode from the device-audience DTO; `/device/removed`.
- Device client module: single-flight refresh, terminal-error purge (SHARED_DEVICE.md §8), memory-only elevation
  and claim tokens.
- Elevation sheet: parent picker, PIN pad (password fallback), lockout message, elevated banner with countdown,
  auto-exit on idle, max, hide, reload and "Done"; "Remove this tablet" and rename under elevation.
- `/dashboard/settings/devices` (parent only): list, last seen, rename, remove with reason, pair and replace
  dialogs with the confirmation-digits step, per-device recent activity.
- Settings → Security → Tablet PIN (set/change/remove, requires current password).
- Dashboard layout: pass only `{ id, name, role, avatar_url }` to `DashboardNav`/`TabBar` (removes email, age, XP,
  level and streak from every dashboard page payload, including `/dashboard/today?mode=fridge`).

## Out of scope
Device writes (grocery tick/add, chore completion); offline snapshot storage (#162); native Android changes.

## Acceptance criteria
- [ ] Pair → board → elevate → auto-return → remove → purge works end to end on a review environment.
- [ ] `/device/*` HTML and RSC payloads contain no person email, age, avatar, XP/level/streak or prohibited-domain
      canary.
- [ ] Elevation state is never written to storage and is gone after reload or backgrounding.
- [ ] Teens and children never see device management.
- [ ] 44×44 targets, visible focus, labelled PIN pad, reduced motion, no colour-only status; axe clean.
- [ ] Responsive QA at 1280×800, 800×1280, 1920×1200 (tablet) and 390×844, 430×932 (phone settings).

## Tests
SHARED_DEVICE.md §14.1 items 2–3, §14.3 items 23–24, §14.5 items 35–36, plus `e2e/device.spec.ts` covering the
full journey, and visual baselines for pair, removed, elevated banner and device list.

## Boundary
No production deploy or kill-switch change. Do not build large layouts before the #131 frames exist; small
placeholders are acceptable behind the switch.
```

### 17.3 `[Shared Device] Android integration for device sessions`

```markdown
Parent: #157
Depends on: schema/API and web UI child issues; #160 baseline
Related: #120, ADR-0004

## Outcome
The Android app behaves reliably as a paired shared device across launches, process death and revocation,
without storing any parent credential, and older installed builds keep working.

## Scope
- Flush the WebView cookie store when the activity pauses (`CookieManager.getInstance().flush()` in
  `MainActivity.onPause`) so rotated device cookies survive process death.
- Cold launch with a device cookie lands on `/device/today` (server redirect from `/`); verify on the installed
  start URL.
- Android back on `/device/*`: never navigates to `/dashboard` or `/login`; at the board root, back moves the task
  to the background instead of finishing.
- Confirm revocation purge also clears WebView storage for the origin (web purge first; native
  `WebStorage.deleteAllData()` only if the web purge proves insufficient).
- Confirm no device cookie or storage is included in backup or device transfer (extend `ManifestSecurityTest`
  expectations only if rules change; they currently exclude everything).
- Document the supported old-client window for device mode in `docs/architecture/ANDROID.md`.

## Out of scope
Kiosk/lock-task, immersive mode, screen-on/night dim, reboot launch (#120); any device-owner policy.

## Acceptance criteria
- [ ] Pair on a tablet; cold launch, warm launch, rotation and `adb shell am kill com.ashbi.familyplanner`
      (including during a refresh) all return to the board without re-pairing.
- [ ] After revoke, the next launch or network contact shows the removed screen and no cached board.
- [ ] Elevation does not survive backgrounding or process death.
- [ ] The currently released APK (versionCode 1) pairs and works against the candidate server.

## Tests
`./gradlew testDebugUnitTest`; device/emulator evidence for SHARED_DEVICE.md §14.6 item 44 and the lifecycle list
in docs/architecture/ANDROID.md; record Samsung-class and stock Android results.

## Boundary
No Play Store publication, no signing or secret changes, no device-owner or lock-task policy, no production
deploy.
```
