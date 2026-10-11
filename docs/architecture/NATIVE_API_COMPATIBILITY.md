# Native, web and API compatibility (#473)

This extends accepted ADR-0004 and the existing cross-device roadmap. The Capacitor configuration loads `https://family.ashbi.ca`; installing a binary does not pin its web/server behavior. A source check, host build, browser viewport, device test and store release are different evidence.

## Current additive implementation

`GET /api/capabilities` returns a public, uncached `herewoven.capabilities.v1` manifest. It contains protocol metadata only: supported member protocols, queue container version and compiled queue action/version/namespace entries. It does not report household feature flags, login/device identity, installed native plugins, permission grants, provider keys, database state or release settings. Protocol support is never authorization; every existing route retains its live checks.

Member protocol **1** uses the existing account-backed assignee/member IDs and payloads. Protocol **2** will use explicit HouseholdMember IDs and separate optional linked-account identity. The current manifest advertises **[1] only**. Dormant schema and internal profile commands do not make profile assignments supported. Never put a profile ID into legacy `assigned_to` or `actingMemberId`, substitute the parent's account, or manufacture a User for a child.

The four current offline actions and their version-one payloads are derived from the production allowlist, not a second list. Capability checks can distinguish unsupported action versions and personal/device scope while preserving the caller's original key/body. Unknown or absent manifest, HTTP failure, invalid JSON and future manifest versions mean **support cannot be checked**. Existing routes/queues are unchanged; this slice does not wire a new replay gate into them or claim old-client/device acceptance.

The native helper `readNativeBuildIdentity` reads the existing App plugin's actual `version` and `build` fields separately: Android versionName/versionCode; iOS short version/build version. It requests no permission. Web has no installed build; missing/failing old plugins or invalid values remain explicitly unknown. It adds no native plugin, registration, pairing policy, minimum version or privacy permission. It is a read helper, not a hardware verification result.

## Activation and recovery rules

Before advertising protocol 2, migrate every member-subject reader/writer and affected domain, finish route/setup/assignment/rotation/points and safe shared attribution, and verify the current/previous client and forward/rollback candidates. Separate account authority from profile eligibility and preserve original #480 acceptance. The currently unused negotiation helpers must be integrated with the actual new consumers; a metadata check alone cannot enforce write support or prevent data loss.

On unsupported capability, retain pending work, its original key and body; refresh server capabilities and canonical data, then offer a compatible update or browser fallback. Do not silently drop, reinterpret, renew, or replay a profile operation as an account operation. For an unavailable server, retain the pending intent rather than treating the missing manifest as a new feature grant. A previous server without this endpoint is an explicit unknown state.

The existing queue parser drops unfamiliar container/action versions and reports them as dropped. Therefore no new member operation/container version may be persisted until its actual reader and rollback/quarantine recovery are implemented and tested. Protocol decision helpers here do not alter that parser. Existing version-one queued actions remain covered by the original queue tests, with additional real stored-container parsing checks; this is not a physical restart/rollback proof.

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
