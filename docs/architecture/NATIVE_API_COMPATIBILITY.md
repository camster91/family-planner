# Native, web and API compatibility (#473)

This extends accepted ADR-0004 and the existing cross-device roadmap. The Capacitor configuration loads `https://family.ashbi.ca`; installing a binary does not pin its web/server behavior. A source check, host build, browser viewport, device test and store release are different evidence.

## Current additive implementation

`GET /api/capabilities` returns a public, uncached `herewoven.capabilities.v1` manifest. It contains protocol metadata only: supported member protocols, queue container version and compiled queue action/version/namespace entries. It does not report household feature flags, login/device identity, installed native plugins, permission grants, provider keys, database state or release settings. Protocol support is never authorization; every existing route retains its live checks.

Member protocol **1** uses the existing account-backed assignee/member IDs and payloads. Protocol **2** will use explicit HouseholdMember IDs and separate optional linked-account identity. The current manifest advertises **[1] only**. Dormant schema and internal profile commands do not make profile assignments supported. Never put a profile ID into legacy `assigned_to` or `actingMemberId`, substitute the parent's account, or manufacture a User for a child.

The four current offline actions and their version-one payloads are derived from the production allowlist, not a second list. Capability checks can distinguish unsupported action versions and personal/device scope while preserving the caller's original key/body. Unknown or absent manifest, HTTP failure, invalid JSON and future manifest versions mean **support cannot be checked**. Existing routes/queues are unchanged; this slice does not wire a new replay gate into them or claim old-client/device acceptance.

The native helper `readNativeBuildIdentity` reads the existing App plugin's actual `version` and `build` fields separately: Android versionName/versionCode; iOS short version/build version. It requests no permission. Web has no installed build; missing/failing old plugins or invalid values remain explicitly unknown. It adds no native plugin, registration, pairing policy, minimum version or privacy permission. It is a read helper, not a hardware verification result.

## Activation and recovery rules

### Personal food capture compatibility (#125, source 2026-10-20)

Food capture does not add a queue action or change the public capability
manifest. Its request-specific protocols are enforced at their routes; a
manifest response alone cannot establish a generated schema, household feature,
provider gate, camera permission or supported installed binary.

| Surface | Current source behavior | Forward/rollback and native evidence still needed |
| --- | --- | --- |
| Personal list/use-soon/cook/history | Optional original-person/household header; canonical success echo; new reader checks before parsing private data | Backend-first deployment; old unbound clients still read. Older server without echo leaves new bound UI in explicit unsupported recovery. Check real proxy/WebView header preservation |
| Reviewed intake | `herewoven.inventory-intake.v1`, original actor/family, issued-at and immutable key/body | Unsupported/malformed reply never confirms a save; missing/deleted target cannot be recreated by receipt replay. Check current/previous web-server candidates and additive schema prerequisites |
| Stock changes | `herewoven.inventory-change.v1`; versioned edit/remove/consume/discard and owned Undo | Original key/body survives unknown replies while mounted; rollback must retain these routes and receipt semantics or stop writes without translating intent to legacy routes |
| Photo/document review | Explicit versioned original-context response and gated document modes | No provider activation. Camera/file permission denial, image formats, upload/review interruption and actual target devices remain unverified |
| Barcode review | Local camera detection with typed fallback; explicit private/public metadata apply | Web source does not establish scanner availability or installed camera permission. Verify denied permission, unsupported detector, background/resume and hardware |
| Offline/process death | Unadopted inventory stays memory-only; gated owned exact-online-request journals and EN/ES recovery UI are authored, not accepted. No offline inventory action/cache is advertised | Verify restart/upgrade/process death, original scope/key/body retention, paused-write review and local dismissal on real clients. Never auto-resubmit reconstructed stock |

Original-owner access loss suspends personal sheets and conceals cached reads.
It does not transfer pending work to a new account/household. Account/role remount
and explicit page reload clear mounted memory; adopted inventory journals reuse
#564 owner/generation/household retirement with a separate inventory scope. That
source integration is not proof of physical lifecycle or durable purge acceptance. Inventory must remain absent from
`QUEUEABLE_ACTIONS` until a separate approved payload/storage/retirement contract
and later recovery QA establish support. No physical-device, native build,
schema migration, provider, release or rollback execution is claimed here.

### Bounded storage candidate recovery (#565)

The follow-on #564 owner/retirement implementation is in progress; see
[its source contract and remaining integration work](QUEUE_OWNER_RECOVERY.md).
It is off by default and does not establish durable purge acceptance.

Source reconciliation on 2026-10-18 found the requested earlier-candidate retry
already present in `src/lib/offline-queue.ts` (`391844c9`). No replacement
algorithm is needed. Before each write, `fallbackQueueStore` probes candidate
contents. The current readable authority is tried first, followed by every
other candidate in preference order, including candidates earlier than a
previously selected fallback. Each candidate is attempted once per requested
write; there is no background retry loop. This can move a failed localStorage
write back to a recovered IndexedDB store without changing the serialized
request keys, operation bodies or public queue format.

Different readable nonempty snapshots pause the adapter without merging,
overwriting or selecting a preferred winner. An empty readable fallback does
not establish that an unreadable primary is empty. After a successful write,
every other candidate must be removed before durability is reported; uncertain
cleanup blocks the adapter. The exact saved operations remain available for
explicit recovery, not automatic guessed replay. Existing paused/recovery EN/ES
UI and the operation/container compatibility gate remain the presentation and
protocol authority.

Browser adapters obtain a stable `persistenceLane` per database/key. Custom
wrappers around the same persisted namespace must pass the **same lane object**
to `fallbackQueueStore(candidates, lane)` and route mutations through the queue's
serialized persistence lane. One active queue owns a namespace; retire the old
instance before replacement. A fresh wrapper object without the shared lane
does not serialize against its predecessor. The lane orders in-page writes and
cleanup; it is not a durable retirement record or a cross-tab/process lease.

Existing test source includes fallback-to-primary write recovery, divergent and
identical copies, recovered stale primaries, exhausted/read-failing stores and
uncertain cleanup. No tests were rerun during this implementation-first pass.
#565 remains open for the later consolidated recovery/concurrency acceptance.
#564 is separate: a fresh runtime cannot infer an earlier failed purge from a
sole surviving stale version-one snapshot. An in-memory lane/blocked flag alone
cannot establish durable authority after process death.

Before advertising protocol 2, migrate every member-subject reader/writer and affected domain, finish route/setup/assignment/rotation/points and safe shared attribution, and verify the current/previous client and forward/rollback candidates. Separate account authority from profile eligibility and preserve original #480 acceptance. The currently unused negotiation helpers must be integrated with the actual new consumers; a metadata check alone cannot enforce write support or prevent data loss.

On unsupported capability, retain pending work, its original key and body; refresh server capabilities and canonical data, then offer a compatible update or browser fallback. Do not silently drop, reinterpret, renew, or replay a profile operation as an account operation. For an unavailable server, retain the pending intent rather than treating the missing manifest as a new feature grant. A previous server without this endpoint is an explicit unknown state.

The current queue loader quarantines unfamiliar containers/actions before invoking the low-level supported-operation parser; it retains the original bytes and pauses replay and mutation. Older shipped bundles still have the former drop behavior. Therefore no new member operation/container version may be persisted until actual supported readers, previous clients and rollback recovery are verified. Protocol decision helpers do not themselves enforce that recovery. Existing version-one queued actions and synthetic stored-container checks do not establish physical restart or previous-binary rollback acceptance. See [queue compatibility recovery](OFFLINE_SYNC.md#unfamiliar-stored-work-compatible-client-recovery-473).

Profile creation is not added to the queue allowlist by this contract. Never queue authentication, permissions, linking, erasure, financial/medical actions or arbitrary requests. Server migration remains expand/contract; keep records and supported read/queue adapters through rollback rather than rolling back to an account-only consumer that hides member-owned work. Minimum supported native version changes remain a separate owner-approved release decision.

## Candidate evidence record

For each release candidate, record in #473 and the existing release issue:

| Evidence | Required value |
|---|---|
| Native binary | APK/AAB or iOS archive name, SHA-256, build source SHA, real version/build and signing/distribution status |
| Loaded web/server | URL, `/api/version` version/commit/builtAt, actual response and checked-image identity |
| API | Actual `/api/capabilities` response and active member/queue protocols; caller context and direct API negatives |
| Schema | Exact startup migration candidate and applied/rollback evidence; dormant/active status, never inferred from manifest |
| Previous supported candidate | Exact prior binary/source and protocols, existing policy window, forward/rollback result |
| Pending work | Original stored key/body, current/previous parser, network/response loss, unsupported-version recovery and retention outcome |
| Lifecycle/privacy | Restart/process death, offline/permission fallback, device revoke, account token generation and safe shared/private boundary |
| Hardware | Device/OS/WebView, orientation, result and reviewer; physical versus host/emulator evidence labeled |

Per-platform camera/HEIC, voice/wake, push, deep links, storage and appliance provisioning remain governed by the existing [cross-device roadmap](../product/CROSS_DEVICE_ROADMAP.md), Android architecture and iOS/native issues. Availability must be measured on the target binary/device, not inferred from this API manifest or a phone-width browser. Signing, store upload, provisioning, providers and production permission/settings changes are not performed here.

## Per-platform capability and fallback contract — 2026-10-24

This restores the planning expansion from the absent earlier checkout using the
current source, not an assumed recovered commit. Status: **authored contract;
original #473 acceptance remains open**. A manifest, plugin declaration or web
viewport result is not a grant of native capability, permission or release support.

| Capability | Web / PWA | Android phone / personal tablet | Android shared fridge | iPhone / iPad | Required fallback / readiness boundary |
| --- | --- | --- | --- | --- | --- |
| Build identity | No installed build | App plugin version/build when available | Same binary identity; pairing is separate | App plugin version/build when available | Unknown identity stays unknown; `readNativeBuildIdentity` in `native-app.ts` requests no permission |
| Camera / barcode | Browser API and detector availability vary | Actual binary, OS permission and detector required | Same checks plus allowlisted shared action and ownership | Actual plugin/browser and OS permission required | Manual entry/file selection; no capability claim from screen size or manifest |
| HEIC / files | Actual accepted input and conversion path required | Do not assume selected files are JPEG | Same with safe scoped draft and no private gallery exposure | Native image support still needs actual input/conversion evidence | Explain unsupported input and allow another file or text; retain draft without fake conversion |
| Voice | Deliberate foreground browser input when supported | Gated LocalVoice experiment; plugin presence is not recognizer/model readiness | Same gate; wake phrase is not speaker identity or parent authority | Platform voice route needs implementation/device evidence | Typed draft; denial/cancel/timeout stays non-writing; no background listening claim |
| Push / reminders | Browser/platform permission and delivery needed | Registration, permission, resume/deep-link behavior need evidence | Quiet/shared content policy plus revoke required | Entitlements, permission and delivery need evidence | In-app inbox/manual refresh; never claim background delivery from a saved preference |
| Share / deep links | User-triggered share where supported, otherwise copy | Existing Share helper; URL ingress/lifecycle needs device evidence | Only explicit safe sharing actions; pairing never grants personal routes | Share helper only when actual plugin is available | Copy approved link; validate destination and current session before private reads/actions |
| Storage / queued work | Advertised version-one allowlist only | Actual scoped persistence/process-death evidence needed | Pair/session retirement and namespace recovery required | Same contract; actual storage/upgrade behavior needs evidence | Preserve original bytes/key/body and show recovery; unsupported versions never translate silently |
| Privacy / lifecycle | Auth/role/household checks on every canonical route | Resume/remount must not revive stale private reads or writes | Revoke/erase/role-change conceals private content and suspends work | Scene/lock/resume privacy needs physical-device evidence | Return to the proper signed-in/pairing surface; profile selection never elevates authority |
| Appliance / distribution | Browser install is not appliance provisioning | Native distribution has separate signing/support policy | Device-owner/kiosk, boot, display and hardware policy are separate owner inputs | Signing/entitlements/store inputs remain separate | Usable foreground web/manual surface; no device-owner, signing or store action from adopting this document |

### Supported-client window and unknown support

No numeric minimum native build, compulsory update policy or new support window
is established by this planning update. Before distribution, Cameron chooses
which actual prior/current binaries to support; Codex records their exact
identities and server/schema/protocol compatibility in the evidence record.
Unmeasured or missing clients remain **unverified**, never silently supported or
silently retired. Native distribution remains pending that decision and evidence.

The compatibility matrix must include current and previous supported client
against forward and rollback server candidates. Preserve both original online
requests with unknown outcomes and older persisted operations. A server
advertising support must not bypass fresh authorization, schema readiness or
feature adoption. A client that cannot read `/api/capabilities`, receives unknown
metadata, or lacks a plugin must keep the manual path and explain unavailable
support. Metadata alone must never authorize replay or erase pending work.

### Forward / rollback delivery sequence

1. Record current/previous binary and loaded web/server identities, manifest,
   schema/migration state, feature flags and original supported queue formats.
2. Prepare additive server/schema changes and backwards-readable adapters first.
   Keep old clients' canonical routes and original request/receipt semantics.
3. Establish the current/previous-client forward/rollback matrix with older
   stored operations, response loss, denied permissions and lifecycle changes.
   Execution is deferred here; an authored matrix has no passing result.
4. Enable a consumer only after its actual compatibility evidence and separately
   authorized release decision. Do not advertise member protocol 2 or a new
   queued action merely because dormant source exists.
5. For rollback, stop newly unsupported writes, preserve exact stored intent,
   keep additive data/receipts readable, and offer update/browser recovery.
   Never drop schema/records or reinterpret profile IDs as account IDs to make
   an older binary appear compatible. Restore/reconciliation is explicit work.
6. Record release and rollback observations separately from host builds,
   emulators, browser fixtures and physical-device results.

Codex owns source contracts, implementation and later isolated compatibility
verification. Cameron owns hardware targets, the supported-binary decision,
signing/distribution inputs and separately approved rollout/provisioning.
No physical-device check, previous-client check, schema change, provider call,
signing, provisioning or release execution occurred in this no-QA pass.
