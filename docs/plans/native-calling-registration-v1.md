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

### Android wake transport source

`android-wake-dispatch.ts` connects the encrypted installation registry to the
server-only FCM HTTP v1 transport in `android-wake.ts`. This is an internal
coordinator function, not a public API, native client, or activated call route.
It accepts only a personal caller and a same-household Android installation with
the exact owner generation and epoch/revision. Live caller authority and target
registration authority are checked before OAuth and again immediately before
dispatch. The future coordinator must also supply a live `stillRinging` check
for the exact call/participants/deadline; there is no permissive default.

The sender exchanges a scoped, five-minute RS256 service-account assertion at
Google's fixed OAuth endpoint, then sends one high-priority data-only hint to
the configured FCM project and Herewoven Android package. Tokens/keys remain
server-side. Both requests reject redirects; responses and total attempt time
are bounded. A zero-second delivery TTL prevents queued stale rings. Only opaque
call/installation IDs, installation stamp, protocol and deadline are sent: no
person labels, family IDs, message content, addresses, SDP/ICE or answer grants.
The native receiver must still fetch current canonical call state; knowing these
IDs never authorizes answering. Provider acceptance does not establish device
delivery. Cancellation can race an already-dispatched push, so receiver-side
reconciliation remains required even after the dispatch-time checks.

There is no send retry, scheduler, token cache, provider credential setup,
production flag, or automatic invalid-token deletion in this slice. A timeout
after dispatch is an unknown outcome, never permission to ring again. Only a
typed FCM `UNREGISTERED` result is classified as an invalid destination; a future
coordinator must fence any cleanup by the original installation stamp. Invalid
payload responses do not revoke a valid phone. No additional data is persisted.

Validation: focused transport cases use generated RSA keys and fake provider
responses. `node scripts/cloudflare/android-call-wake-smoke.mjs` executes actual
workerd crypto and native D1, with intercepted provider fetches, for valid registry
decryption, foreign households, expired calls, cancellation, logout, feature-off,
rotation and revocation during OAuth. This proves neither real FCM delivery nor
native/lock-screen acceptance. Existing production calling remains unchanged.

Provider contracts: [FCM authorization](https://firebase.google.com/docs/cloud-messaging/send/v1-api),
[Google service-account assertions](https://developers.google.com/identity/protocols/oauth2/service-account),
[FCM lifetime and acceptance semantics](https://firebase.google.com/docs/cloud-messaging/customize-messages/setting-message-lifespan).

### Sleeping-call coordinator source

`FamilyCallRoomCore` now has internal methods to begin a call to a registered
Android installation, reserve one wake attempt, check whether it is still
ringing, dispatch through the registry-backed FCM sender, and claim an answer.
The production Durable Object wrapper and the v1 WebSocket protocol do not expose
these methods. `CALLING_NATIVE_COORDINATION_ENABLED=1` and the native registration
flag are both required; neither flag is added to production configuration.

Pending state uses the caller's existing hibernatable WebSocket attachment,
with the call ID, target owner/generation/stamp, mode, deadline and wake-attempt
reservation. No new DO storage table, call history, D1 schema, bearer token,
SDP/ICE or media is persisted. The caller must remain connected. The ring
deadline is 30 seconds, checked on room activity and every answer; existing
heartbeat/close cleanup still applies. This is eligibility expiry, not a new
scheduled erasure promise. No alarms, cron, polling service or automatic wake
retry is added. A reconstructed room retains the reservation in its attachment.

Wake I/O and native ownership verification run outside the room's serialized
commit queue, so cancellation remains responsive during them. The commit then
rechecks the live caller, receiver, exact installation stamp, deadline, busy/DND
state and mode. Native ownership verification is mandatory with no permissive
default: a session, phone ID or push hint alone cannot answer. Concurrent answers
produce one active pair; video may downgrade to voice. The native target binding
remains attached to both active peers, so unlink, rotation or authority loss ends
the call during subsequent canonical action/heartbeat checks. Known send failure
ends a still-pending call; uncertain delivery stays pending until cancellation
or expiry and never releases its one-attempt reservation.

`node scripts/cloudflare/sleeping-call-smoke.mjs` exercises actual local DOs,
WebSockets and D1, including one winning answer, attachment reconstruction,
missing-proof refusal and active-call revocation. Its ownership verifier is
explicitly fabricated. Unit tests also cover cancellation during OAuth/proof,
expiry, same-household boundaries and default-off behavior. The existing local
WebRTC media diagnostic still sends audio/video and stops capture on revocation.
None establishes native hardware, real provider delivery or a real installation
ownership handshake. This source still cannot make a closed phone ring.

### Remaining integration

- Native installation ownership/rotation handshake and push-delivery proof;
  possession of a routing token alone must never authorize an answer.
- Expose stable sleeping-target discovery and the internal coordinator only
  after native ownership proof, readiness and compatible admission protocols
  exist. Add receiver/caller routes and native UI, with bounded retries and
  installation-specific ownership proofs; never accept the diagnostic verifier.
- Wire native readiness to the coordinator; implement APNs VoIP delivery. Configure private server
  credentials and verify actual provider delivery from the Cloudflare runtime.
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
makes a closed device ringable. Before rolling back to code unaware of native
call bindings, disable global calling and verify new-format active calls have
ended/disconnected; older room code cannot enforce installation-stamp revocation
on a native call attachment it does not understand. No production migration or key setup is implied
by this source change.

## Verification

Focused HTTP/crypto/calling/device-isolation and personal-export tests; real
local workerd/D1 registration tests for encryption, replay, competing writes,
foreign ownership, stale unlink/recreation, limits, expiry, authority changes and
deletion; structural D1 schema check; native account-deletion/export fixtures;
PostgreSQL migration idempotence and Prisma schema parity. None is physical
native/push-provider acceptance. Current execution results belong in #612.
