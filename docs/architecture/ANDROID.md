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

Do not store reusable parent credentials in the shared-device session.

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