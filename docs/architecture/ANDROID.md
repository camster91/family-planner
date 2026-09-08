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

## Server compatibility
The backend must support a documented window of installed Android clients. Breaking APIs/schema changes need staged compatibility. Feature flags can hide unsupported capabilities from older builds.

## Permissions
Ask camera/microphone/notification permissions only at point of value. Denial must leave a functional manual fallback. Shared-device lock-screen notifications must not expose sensitive text.

## Performance/battery
No unbounded polling or wake-lock dependence. Warm dashboard targets and route budgets are tracked in #137. Large graphics must be optimized for tablet displays.

## Play Store
See `docs/product/PLAY_STORE_READINESS.md` and #138. Planning/testing does not authorize publication.