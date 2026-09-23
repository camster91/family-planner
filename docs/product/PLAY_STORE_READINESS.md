# Google Play Readiness

Planning checklist for #138. Nothing here authorizes publication.

## Product/package
- stable app/package ID ownership;
- versionCode/versionName policy;
- production signing ownership/recovery;
- reproducible signed AAB from exact commit;
- internal/closed/staged/production track strategy;
- server compatibility with supported installed builds;
- adaptive icon, monochrome icon, splash and notification icon.

## Android quality
- phone + tablet + resizable windows;
- portrait/landscape;
- system back/deep links;
- process death/WebView restart;
- offline/reconnect;
- battery/network discipline;
- permission requests at point of value;
- crash/ANR/vitals review;
- cold/warm start and performance budgets.

## Store assets
All assets must be original and match the real product:
- title;
- short/full descriptions;
- app icon;
- feature graphic;
- representative phone screenshots;
- representative tablet screenshots;
- optional preview video;
- support/contact links;
- privacy policy.

## Policy/data
Before submission, reconcile actual app behaviour for:
- Data Safety;
- account deletion;
- content rating;
- target audience/children/teen implications;
- permissions;
- advertising/tracking SDKs if ever added;
- third-party processors;
- user-generated content where applicable;
- testing/reviewer access.

Never answer policy forms by guessing from roadmap intent. Use `DATA_INVENTORY.md`, dependency/runtime inspection and current production/release candidate behaviour.

## Release readiness
- exact candidate passes Definition of Done;
- internal update/install path verified;
- staged rollout/halt criteria documented;
- server-side kill switches/compatibility ready;
- support/incident runbook ready;
- privacy/support pages accessible;
- release notes accurate.

## Approval boundary
Play Console changes, signing-key changes, production publication, staged rollout changes and paid store services require explicit approval.