# Android Architecture

## Product model
The Android app is a Capacitor shell around the Family Planner web experience. Keep business rules and household data contracts shared with the web/backend unless a measured native capability gap requires an isolated plugin/native module.

## Supported surfaces
- phone companion;
- portrait tablet;
- landscape fridge/wall tablet;
- resizable/split-screen Android windows.

Design by available window size, not brand/model detection.

## Shared appliance mode
Planned capabilities include:
- dedicated paired device identity/session;
- immersive/full-screen presentation;
- kiosk/lock-task only where supported and explicitly enabled;
- resilient restore after WebView/process restart;
- reboot/launch recovery where platform/device policy permits;
- configurable screen-on/night dim behaviour;
- offline recent dashboard;
- device revoke and re-pair.

Do not store reusable parent credentials in the shared-device session. Proposed device-session contract and Android integration issue: [`SHARED_DEVICE.md`](SHARED_DEVICE.md) (#157, ADR-0006). Because the app loads the web experience from `server.url`, device mode needs no new APK; native work is limited to cookie flush on pause, back behaviour and lifecycle evidence.

### Shared-device native behaviour (#242)
- `MainActivity.onPause` calls `CookieManager.getInstance().flush()`. Device refresh tokens rotate on every refresh (SHARED_DEVICE.md §4), so the rotated cookie is persisted before the process can be killed in the background; otherwise a restart could replay a rotated token and, after the 60 s grace, revoke the tablet. A refresh still in flight at pause lands after that flush, so follow-up flushes run 2 s, 10 s and 30 s after pause (and on `onStop`), cancelled on resume. If device evidence shows a refresh can still land later than that, add a small Capacitor plugin so `device-client.ts` asks native code to flush right after each refresh.
- Back on a `/device/*` page (`SharedDeviceNavigation.isDevicePage`) moves the task to the background instead of finishing or navigating, so it never reaches `/login` or `/dashboard`. Elsewhere Back keeps the existing system behaviour.
- Revocation purge is web-side (`src/lib/device-client.ts`: storage, IndexedDB, Cache Storage, and HttpOnly cookies cleared by the server). Native `WebStorage.deleteAllData()` is only to be added if device evidence shows the web purge is insufficient.
- Backup and device transfer already exclude all app data (`data_extraction_rules.xml`, `ManifestSecurityTest`), so device cookies and storage are never copied off the tablet.
- **Old clients:** every installed build loads the live site, so device mode works on the released APK (versionCode 1) without an update. Builds without this change still work; they only lack the pause flush (a process kill right after a refresh may force a re-pair) and use system Back (which exits the app on `/device/*`). Supported window: versionCode 1 onward.
- **Device evidence still needed** (cannot be produced in CI): on a real tablet, pair, then cold launch, warm launch, rotation and `adb shell am kill com.ashbi.familyplanner` (including right after a refresh) all return to the board without re-pairing; after revoke the next launch shows the removed screen; parent mode does not survive backgrounding or process death. Record Samsung-class and stock Android results in #242.

## Lifecycle requirements
Relevant releases should test:
- cold/warm launch;
- background/foreground;
- process death/WebView restart;
- rotation/configuration/window resize;
- network transitions;
- permission denial/revocation;
- old-version update to new version;
- stale/revoked session recovery.

## Navigation
Android system back must have deterministic behaviour. Do not implement iOS-like navigation that traps Android back or exits unexpectedly. Deep links should resolve safely from cold/warm/open states.

## Packaging
Public release work must support an Android App Bundle (AAB), stable application ID, versionCode/versionName policy, production signing ownership/recovery, adaptive/monochrome icons and exact artifact provenance. Internal APKs remain useful for development/testing.

Launcher icons: adaptive (navy background colour, house foreground) plus a monochrome layer for Android 13 themed icons, and legacy/round PNGs for Android 7.x. How they are made and what they look like is in `docs/product/BRAND.md` (Android app icon).

## Versioning policy (#160, ADR-0004)

Decision context: [ADR-0004](adr/0004-api-compatibility.md) (installed Android clients must keep working; versionCode/versionName are operational inputs). The only distributed build so far is `versionCode 1`, `versionName "1.0"`; `applicationId "com.ashbi.familyplanner"`.

**Where the values come from.** `android/app/build.gradle` reads `versionCode` from the Gradle property `fpVersionCode` (or env `FP_VERSION_CODE`) and `versionName` from `fpVersionName` (or `FP_VERSION_NAME`). It fails the build on a code outside 1..2100000000 or a name that is not 1-32 of `[0-9A-Za-z.+-]` starting with a digit. Without them a local build gets the defaults written in `build.gradle` (`1` and `1.0` today) and must never be distributed. `apk.yml` sets both in its `Resolve Android version` step:
- `versionCode` = the `apk.yml` workflow run number (`github.run_number`). It only goes up, a re-run of the same run keeps it, and it is already above the `1` shipped before. Renaming or recreating `apk.yml` resets GitHub's run counter: before doing that, add a fixed offset above the last shipped code.
- `versionName` = the tag without the `v` on a tag build (the tag must be `v<MAJOR.MINOR.PATCH>` or the build fails), otherwise the `build.gradle` default plus `-ci.<run>` (for example `1.0-ci.57`), so a non-tag artifact cannot pass for a release.

Local check: `./gradlew -PfpVersionCode=57 -PfpVersionName=1.2.3 assembleDebug`.

**Application ID.** `com.ashbi.familyplanner` never changes. Play, backups and installed tablets key on it.

**versionCode**
- Assigned by CI (run number, above). A positive integer that increases by at least 1 for every build distributed beyond a developer machine: a GitHub Release APK, any Play track upload (internal, closed, open or production), or a sideloaded tablet build. Play rejects an upload whose `versionCode` is not higher than every code already uploaded.
- Never reused or lowered, including after a rollback. Rolling back means shipping the old code under a new, higher `versionCode`.
- Local builds get the `build.gradle` default; they are never distributed. Distribute only CI-built artifacts.

**versionName**
- `MAJOR.MINOR.PATCH` from the next bump. The existing `"1.0"` is read as `1.0.0`.
- PATCH: native fixes with no behaviour change. MINOR: a new native capability (plugin, permission, manifest or lifecycle change). MAJOR: a change that ends support for older server or client behaviour; it needs an owner decision under ADR-0004.
- Not yet reported to the server. Pairing (`src/components/device/PairScreen.tsx`) sends the literal `'web'` as the app version on every platform, and nothing refreshes `HouseholdDevice.last_seen_app_version` after an APK upgrade, so that field cannot identify installed Android builds or support an old-client window today. Wiring the native `versionName` into pairing and refresh is a follow-up; until then, compatibility decisions rely on the release record, not on that field. When it is wired, `versionName` must stay at most 32 characters and contain no household data.

**When to bump.** The installed app loads the live site from `server.url`, so web and API changes reach every installed build without a new APK. Bump only when the native shell changes: `android/**`, `capacitor.config.ts`, Capacitor plugins or the Capacitor major version. A web-only release does not bump either value.

**How to bump**
1. A PR that changes only the default `versionName` in `android/app/build.gradle` (the `fpVersionName` fallback, plus release notes), after the native changes it ships have merged. `versionCode` is not edited by hand any more; CI assigns it.
2. After merge, the release tag is `v<versionName>` on that exact commit. `apk.yml` builds tagged releases, takes `versionName` from the tag, names the APK from it (`family-planner-<tag without v>.apk`) and refuses to publish an unsigned one. It does not compare the tag with the `build.gradle` default; check that by hand.
3. Record the commit SHA, `versionCode` and `versionName` (printed by the `Resolve Android version` step) and the APK/AAB SHA-256 with the release evidence (`docs/runbooks/RELEASE_AND_ROLLBACK.md`).

Pushing a tag, signing, `apk.yml` (currently disabled in GitHub, `CURRENT_STATE.md`) and any Play upload remain owner actions (AGENTS.md).

**Old-client window (ADR-0004).** The server supports every `versionCode` from 1 up, the window recorded for device mode above. Raising the minimum supported `versionCode` is an owner decision. It needs a compatibility note in the release PR, and the previous supported build has to be smoke-tested against the new server candidate first.

## Android tests and build baseline (#160)
Prerequisites: JDK 21, an Android SDK with `platforms;android-36` (set `ANDROID_HOME`), and `npx cap sync android` run from the repo root first. The sync generates `android/capacitor-cordova-android-plugins/` and `android/app/src/main/assets/capacitor.config.json`; both are gitignored and must not be committed.

```bash
npx cap sync android
cd android
./gradlew testDebugUnitTest                   # JVM tests, no device needed
./gradlew compileDebugAndroidTestJavaWithJavac # compile-check instrumented tests
./gradlew connectedDebugAndroidTest           # instrumented tests; needs a device/emulator
./gradlew assembleRelease bundleRelease       # APK + AAB; unsigned unless the ANDROID_KEYSTORE_* / ANDROID_KEY_* env vars are set
```

JVM unit tests (`android/app/src/test/java/com/ashbi/familyplanner/`, plain JUnit 4 + JDK XML parsing) cover:
- `ManifestSecurityTest`: source manifest and every merged manifest Gradle has produced (debug always; release after a release build) keep `allowBackup=false`, `fullBackupContent=false`, `usesCleartextTraffic=false`, a `dataExtractionRules` reference, no `networkSecurityConfig` (add one only with a test that it denies cleartext), a non-exported FileProvider, and no `debuggable` outside debug variants; `data_extraction_rules.xml` excludes `root`, `file`, `database`, `sharedpref` and `external` (path `.`) from both `cloud-backup` and `device-transfer` with no `<include>`; `file_paths.xml` only exposes `external-files-path` `Pictures/` plus app-private `cache-path` (any `external-path`, `root-path`, `files-path` etc. fails); exactly one launcher activity, `.MainActivity` with `singleTask`.
- `CapacitorConfigSecurityTest`: both `capacitor.config.ts` and the generated `capacitor.config.json` have the expected `appId`, an `https` non-local `server.url`, no `cleartext: true`, no `allowMixedContent: true`, and no wildcard `allowNavigation`.

Instrumented test (`android/app/src/androidTest/java/com/ashbi/familyplanner/AppIdentityInstrumentedTest`) checks the installed package is `com.ashbi.familyplanner`, the launcher intent resolves to `MainActivity`, `FLAG_ALLOW_BACKUP` is off and cleartext traffic is not permitted at runtime.

CI (`.github/workflows/apk.yml`) runs `testDebugUnitTest` after `cap sync` and before any assemble step. Release runs (tag `v*` or manual `release`) build the APK and an AAB (`bundleRelease`). With signing secrets both are signature-verified and uploaded as workflow artifacts. Without them the unsigned outputs are never published, and the AAB is not uploaded at all. Only the signed APK is attached to GitHub Releases; the AAB is kept for a manual Play Console upload that needs separate approval.

Still open for #160, needing a device or emulator:
- run `connectedDebugAndroidTest` and record the result;
- lifecycle evidence: cold/warm launch, background/foreground, rotation/resize with `configChanges`, and process death (`adb shell am kill com.ashbi.familyplanner` while backgrounded, or "Don't keep activities") restoring into a usable signed-in or re-auth state rather than a blank WebView;
- install the signed AAB via `bundletool build-apks --connected-device` / `install-apks` to prove the bundle path;
- confirm `adb shell bmgr backupnow com.ashbi.familyplanner` and device-transfer produce no app data.

## Server compatibility
The backend must support a documented window of installed Android clients. Breaking APIs/schema changes need staged compatibility. Feature flags can hide unsupported capabilities from older builds.

## Permissions
Ask camera/microphone/notification permissions only at point of value. Denial must leave a functional manual fallback. Shared-device lock-screen notifications must not expose sensitive text.

## Performance/battery
No unbounded polling or wake-lock dependence. Warm dashboard targets and route budgets are tracked in #137. Large graphics must be optimized for tablet displays.

## Play Store
See `docs/product/PLAY_STORE_READINESS.md` and #138. Planning/testing does not authorize publication.