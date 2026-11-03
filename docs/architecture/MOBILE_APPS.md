# iPhone, iPad and Android apps

Request and implementation tracking: #465, parent #128. Cameron's latest request adds iOS companion work to the Android-first programme; the single web/backend/household model remains canonical.

## Local candidate refresh — 2026-11-03

Source `1efe4fc7` aligns the generated iOS Swift package and resolved dependency
with the installed/locked Capacitor iOS/core/CLI 8.5.3. Regenerate with
`npx cap sync ios` after dependency updates; do not hand-edit the managed package
or leave its resolved pin on an older framework. App, Network and Share remain
the same three plugins. No new native permission, association, account or provider
was enabled.

Xcode 27.2 (27B52) successfully built the Debug generic iOS Simulator app using
`CODE_SIGNING_ALLOWED=NO` and `COMPILER_INDEX_STORE_ENABLE=NO`, after the original
dependency extraction failed for disk space. The six shared-native test suites
passed (41 tests), and the source plist/project passed `plutil -lint`. Build logs
and file hashes are in the sibling continuation artifacts, `ios-build.log` and
`ios-build-evidence.json`. The binary has developer defaults version 1.0/build 1;
it has only linker ad-hoc simulator signing (no team or sealed resources), not
a distribution signature or approved release. No simulator
runtime/device is installed here, so no app launch or physical-device behavior
is claimed. No signing credentials, store upload or production change occurred.

The shell still loads `https://family.ashbi.ca`; the compiled native source does
not establish the loaded live web SHA. Verify both identities in a release.
The Android reminder registration and shared URL validation now have local
source/tests documented in [ANDROID.md](ANDROID.md). iOS domain association and
entitlements remain outstanding. Android local-voice preview source exists;
its real-device noise, distance, permission and lifecycle acceptance remains
separate. The older capability table below is a dated baseline, not a current
completion checklist. #473/#138 and original per-platform acceptance remain open.

## Current local candidate, 2026-10-09

Android and iOS use Capacitor 8.5.2 and the same live HTTPS application, `https://family.ashbi.ca`. Adding these native projects does not deploy any of the accumulated web changes. An installed native app still shows the deployed web version. This is a hybrid app with native capabilities, not an entirely Swift/Kotlin interface. Do not advertise full native parity yet.

The generated iOS project uses Swift Package Manager, iOS 15 minimum, iPhone/iPad orientation support, scene lifecycle and stable bundle ID `com.ashbi.familyplanner`. Its display name is Herewoven. Signing team and distribution credentials are deliberately unset. Version/build defaults are developer-only; supply the release version and unique increasing build number from the release pipeline before distribution. Generated Capacitor icon/splash artwork is scaffolding and must be replaced with approved correctly sized Herewoven artwork before distribution.

Shared native plugins:

- App: foreground/resume dispatches the existing focus refresh signal; no page reload and no unsaved form reset. No new Android Back listener; existing shared-device navigation and cookie flush remain in place.
- Network: actual connection state feeds the existing offline UI, resamples on resume and removes only each subscriber's listeners. Stale asynchronous samples cannot overwrite newer events. A connected network does not prove server reachability.
- Share: the existing parent sitter-link Share tap opens the system share sheet when the plugin exists. No automatic sharing; only the existing explicitly shareable link is forwarded. Browser share and Copy remain available. No new public links or tokens are created by this adapter.

Older installed Android apps without these plugins keep browser fallbacks until their native update. No server/API/schema migration is needed. The iOS scene covers the window while inactive to keep household content out of the app switcher; actual device snapshot and permission checks remain required. Camera/photo purpose strings cover the existing WebView image picker; a purpose string alone does not implement a native camera workflow.

## Build and verify

Use Node 22+, locked dependencies, Xcode 26+ for Capacitor 8. Android prerequisites and gates are in ANDROID.md.

```
npm ci
npx cap sync ios
npx cap sync android
xcodebuild -project ios/App/App.xcodeproj -scheme App -configuration Debug \
  -destination 'generic/platform=iOS Simulator' \
  -derivedDataPath /tmp/herewoven-ios-build CODE_SIGNING_ALLOWED=NO build
```

The generic simulator build verifies compilation and resources, not installation, login, permissions, live provider calls, device acceptance or App Store approval. Keep build paths outside source. Do not publish a developer default version. Store submission needs an owner-approved distribution action and protected signing inputs.

## Full native capability roadmap

| Capability | Current evidence | Required next work |
| --- | --- | --- |
| iPhone/iPad app | New SPM project and unsigned simulator compilation | Install/launch, safe areas, keyboard, split screen, rotation, role journeys and real-device checks |
| Android app | Existing shell; plugins synchronized | JDK21/android36 host gates, phone/tablet lifecycle and device acceptance |
| System sharing | Typed adapter and existing sitter UI tests | Physical iPhone/Android share, cancellation and return tests |
| Photos/camera | Existing file upload; iOS purpose strings | Native camera picker, process-death result restore, denial/cancel, HEIC and canonical private upload checks |
| Native voice/AI | Browser voice draft; typed AI actions from #464 | Native speech bridge, microphone/speech permissions, denial and interruption tests; live configured AI verification |
| Push/reminders | Existing app notifications; native push absent | APNs/FCM ownership and private device-token backend, scoped opt-in, quiet hours/snooze, revoke/logout and delivery evidence; do not add a scheduler without exact authorization |
| Offline cold launch | #466 bundles private recovery; native service worker remains disabled | Real-device offline cold-start/reconnect checks; private snapshot expiry/revoke and conflict/idempotent queued-write design |
| Widgets/shortcuts | Not implemented | Opt-in minimal safe household glance data, role rules, expiry and real OS refresh limits |
| Calendar access | Existing server OAuth/subscriptions | Native/system-calendar permissions and per-user explicit import/write review; no silent phone-calendar copying |
| Biometric unlock | Not implemented | Reauthenticate canonical session without storing parent passwords, secure storage and shared-device exclusions |
| Universal/app links | Not enabled | Domain association files, exact allowed routes and cold/warm signed-in/signed-out tests; avoid secrets in custom schemes |
| Native navigation | Existing Android shared-device Back | Phone Back/sheets, external browser/OAuth return, keyboard and safe-area device matrix |
| Store release | Not submitted or accepted | Correct artwork, privacy/disclosure audit, account deletion, signed provenance, owner accounts and store review |

## Evidence and rollback

Local #465 evidence is under the task's `work/469-*` logs. Full web compilation and Android/device gates are separate, not inferred from iOS compilation. Reverting #465 removes the new plugins, adapters and iOS scaffold without changing household records or the existing Android shell's backend contract. Run Capacitor sync after reverting dependencies.

Primary references: [Capacitor environment](https://capacitorjs.com/docs/getting-started/environment-setup), [Capacitor 8 migration requirements](https://capacitorjs.com/docs/updating/8-0), [native API documentation](https://capacitorjs.com/docs/apis).

## Bundled native recovery (#466)

`server.errorPath` loads the self-contained `public/native-offline.html` when native startup/navigation fails. It has no scripts, requests, external assets, forms, storage or household snapshot. Its two explicit links use the existing trusted HTTPS personal entry and `/device/today`; canonical session/pairing checks remain on the server. There is no automatic retry loop and no claim that a failed connection is necessarily an offline network. Android Back from the localhost recovery page backgrounds the task. Rebuild/sync clients to get this capability; the service worker exclusion and older native clients are unchanged.

Phone/tablet browser rendering, bundled-source identity, web/security tests and unsigned simulator compilation are local checks only. Physical network-loss/cold-launch, Android JVM/instrumented gates and shared-tablet revoke/re-pair checks remain pending. Official configuration reference: https://capacitorjs.com/docs/config (`server.errorPath`).
