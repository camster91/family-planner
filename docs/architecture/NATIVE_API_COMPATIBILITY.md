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
| Offline/process death | No durable inventory mutation queue or inventory cache; bounded online refresh and mounted-memory recovery only | Network interruption while mounted differs from restart/upgrade/process death. Reopening cannot promise to recover a lost draft or request key; do not auto-resubmit reconstructed stock |

Original-owner access loss suspends personal sheets and conceals cached reads.
It does not transfer pending work to a new account/household. Account/role remount
and explicit page reload clear memory; durable owner retirement in #564 is not
implicitly extended to inventory. Inventory must remain absent from
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
