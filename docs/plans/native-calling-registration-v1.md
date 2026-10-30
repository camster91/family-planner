# Native calling registration — #612

This slice supplies personal-phone routing registration, not background ringing.
Existing foreground calling stays unchanged. No native plugin, push provider,
media engine, credential, production migration or flag is activated here.

## Implemented boundary

`GET/PUT/DELETE /api/calls/installations` requires both `CALLING_ENABLED=1` and
`CALLING_NATIVE_REGISTRATION_ENABLED=1`, a native D1 binding, current person
membership/session generation, and the household calling feature. The new flag
is absent from the production config. Paired-device cookies do not authorize a
personal-phone registration. Shared-screen native registration remains separate.

GET returns the authenticated owner's context, server time and at most eight
own active registrations. An optional `installationId` selects one owned
registration, including its tokenless revoked state, for reconciliation. PUT requires that exact owner context, an installation UUID,
platform/provider match (iOS/APNs VoIP or Android/FCM), label, opaque push token,
a fresh command UUID/time and the expected registration epoch/revision (null for
creation). DELETE requires the exact owner and epoch/revision. Writes require
CSRF, canonical origin and a bounded body; admission is rate limited. Command
age is five minutes with 30 seconds of future clock tolerance. Native clients
must preserve a command/body for an uncertain retry and reconcile a conflict,
not silently generate a replacement command.

D1 checks membership, generation, role and feature inside the write, not just
before asynchronous work. One token destination cannot be registered to a
second installation/account. Competing writes use epoch/revision CAS; exact
command/body replay returns the existing receipt, while changed-body key reuse
and stale unlink refuse. A recreated installation gets a fresh epoch so a late
unlink cannot remove it. Each person has at most eight registrations.

Private routing tokens use AES-256-GCM with dedicated `NATIVE_CALL_TOKEN_KEY`
(canonical base64, 32 bytes), independent of JWT/calendar secrets. AAD binds the
installation, owner, family, generation, platform and registration stamp. Key
rotation reads can use `NATIVE_CALL_TOKEN_KEY_PREVIOUS`; token dedupe fingerprints
stay stable across encryption rotation. Never return/log ciphertext, tokens,
fingerprints or command hashes. Account exports include only own device metadata.

Registration eligibility expires 30 days after renewal. Expired registrations
are omitted from reads and cleared on the next registration mutation. This is
not a promise of scheduled physical erasure at day 30: no scheduler is added.
Logout/password/session-generation changes and account/household deletion
physically remove routing records. Explicit unlink, household departure without
a generation change, and household calling-off immediately clear encrypted push
material and retain a six-minute tokenless tombstone, holding the destination
fingerprint and incremented revision. This outlives the five-minute command
window plus clock allowance, so delayed old opt-ins cannot resurrect a disabled
installation or reclaim its destination under a different ID. Eligible registry
reads exclude tombstones. An owned GET with `installationId` can inspect the
current stamp; re-enabling requires a new explicit command with that stamp and
a command time after revocation. Never auto-renew a revoked installation after
an uncertain response. Expired tombstones are removed during a subsequent owned
registration mutation; lifecycle deletion still erases them immediately.

## Still required before background calling

- Native installation ownership/rotation handshake and push-delivery proof;
  possession of a routing token alone must never authorize an answer.
- Stable sleeping-target discovery, bounded incoming-call state, cancellation,
  expiry and one winning answer in the existing calling state machine.
- Event-driven FCM/APNs delivery with private server credentials and neutral
  lock-screen payloads; actual delivery from the Cloudflare runtime.
- Android Telecom/notifications/native media and iOS PushKit/CallKit/native
  media. Do not remove browser visibility/capture cleanup to imitate native
  background audio. All registry receipts intentionally say
  `backgroundRinging: false` until that end-to-end capability exists.
- Account switching must remove the previous native registration before
  changing identity; old-owner push, stale callbacks and token rotation need
  native evidence. Normal process termination and explicit OS force-stop are
  different delivery states; do not promise unconditional delivery.
- Native origin update from the legacy family hostname to canonical herewoven.com,
  with explicit installed-client/session/pairing and queued-operation acceptance.
  Do not copy cookies or parent credentials between origins.
- Signed test builds, provider ownership/configuration and physical lock-screen,
  background, permission/DND, network and audio tests under #138/#473.

## Migration and rollback

Apply additive D1 migration `0017_native_call_installations.sql` before promoting
this source: canonical deletion/export now include the new table even while the
registration flag is off. The Prisma/PostgreSQL compatibility schema is in
`database/migration-native-call-installations.sql`. Keep the additive table and
its security cleanup triggers on server rollback. Older foreground clients need
no change and never call this optional API. Keep native registration off unless
all relevant schema/secret/client gates are ready; registration alone never
makes a closed device ringable. No production migration or key setup is implied
by this source change.

## Verification

Focused HTTP/crypto/calling/device-isolation and personal-export tests; real
local workerd/D1 registration tests for encryption, replay, competing writes,
foreign ownership, stale unlink/recreation, limits, expiry, authority changes and
deletion; structural D1 schema check; native account-deletion/export fixtures;
PostgreSQL migration idempotence and Prisma schema parity. None is physical
native/push-provider acceptance. Current execution results belong in #612.
