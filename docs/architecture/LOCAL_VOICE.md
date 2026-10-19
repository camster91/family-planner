# Local voice and platform action source — #563

Status: gated source candidate, **not compiled, tested, enabled or released**.
Implementation-first work defers all QA to the consolidated candidate. Parent
contracts remain #128, #120, #125, #144, #464 and the existing assistant pipeline.

## Implemented bounded slice

`LocalVoicePlugin.java` is a first-party Capacitor plugin, registered before
the Android bridge is created. The manifest declares RECORD_AUDIO and the
speech-service query; permission is requested only after a deliberate Listen
tap. Availability probing requests no permission. Only the trusted production
HTTPS origin can use recognition; localhost/offline recovery and foreign pages
do not receive a local voice capability. Preview builds need a separately
reviewed origin change rather than weakening that boundary.

It uses `createOnDeviceSpeechRecognizer`, never the general recognizer or a
network fallback. API 31+, a working on-device service and the selected language
model are required; absent/unsupported/error states keep typing available. No
model download, foreground service, background microphone, retained audio,
audio upload, transcript telemetry, speaker identification or automatic restart
loop is added. The recognizer receives EN/ES locale and one-result intent; it
ignores audio buffers and partial results and is destroyed at every terminal
outcome. A native 20-second deadline, lifecycle cancellation and a bounded UI
deadline prevent indefinite listening. Silence may end it sooner.

The permission callback remains saved until Android returns it, even if the
user cancels or the app hides while permission is open. That cancellation must
not start recognition later. Another tap may be needed after a permission
dialog interrupts the activity. Each cancel names its exact request; an old
component cannot cancel another component's newer session.

`LocalVoiceDraft` is an EN/ES disclosure and explicit tap input, guarded by
`NEXT_PUBLIC_LOCAL_VOICE_PREVIEW=1` **and** actual plugin/readiness checks.
Default is 0. It is wired to:

- the existing parent/teen personal assistant text box, with its existing
  manual Send and proposal review/authorization still required;
- the shared-tablet grocery text box, only with a selected real account actor,
  retaining its explicit Add, attribution, canonical preparation and queue rules.

It never calls assistant/model, queue or domain mutation APIs. Results are
strictly parsed and bounded. Changes to the text, selected actor/list, role,
route, locale or enabled state prevent stale transcript replacement. Closing,
hiding and page lifecycle events cancel listening. Native and browser speech
inputs stop each other before listening; browser speech retains its separate
browser-service disclosure and is not relabeled as local.

The optional **Try wake phrase** button is a foreground utterance experiment:
“Hey herewoven” or “Hola herewoven” followed by a draft. It extracts text only
from a leading exact phrase. It is not an always-listening wake engine or
screen-off/background assistant, does not wake the app, and grants no identity
or write authority. Rollout remains a feasibility decision after hardware QA.

## Platform actions and remaining code plan

Android system actions and Apple App Intents/Shortcuts are separate adapters,
not implicit benefits of the above recognizer. Initial actions should open the
existing app to a reviewed draft/navigation destination with an opaque,
short-lived pending intent. Do not put private transcript/household payloads in
exported URLs, shortcuts, launcher metadata or system logs. Resolve current
personal versus paired context on foreground entry, require explicit actor
selection on shared surfaces and current server authorization at execution.
Never route an intent directly into an arbitrary write endpoint or infer parent
authority from a speaker, unlocked device or OS account.

Before adding exported native entry points, select the original allowed actions
and expiry/cancellation contract in #563/#141, align with verified-link source
and prior-client recovery, and prepare Android/iOS-specific permission and
privacy declarations. iOS needs a native local-speech availability/permission
adapter or system dictation; this Android plugin is not an iOS speech bridge.
No iOS microphone/speech permission, Siri entitlement, App Intent extension or
Android exported action service is claimed implemented by this slice.

## Deferred consolidated acceptance

Focused test source covers phrase boundaries, malformed native responses,
no listening before tap, changed drafts, actor replacement and hidden-app late
results. It has not run. The integrated QA must additionally cover:

- Native sync/compile, plugin registration, current/previous installed binaries,
  Android API below/above 31 and absent service/model/language behavior.
- First permission, denial/permanent denial, cancel while permission is open,
  cancel/result race, second session, timeout, multi-window/rotation, Back,
  screen lock, pause/resume, process death and device revocation/re-pairing.
- Named physical fridge/phone/tablet hardware, EN/ES, noise/distance/night,
  false phrase matches, silence, accessibility and battery/thermal impact.
- No audio or transcript retained/uploaded/logged by app paths; verify the
  target OS recognizer and installed service policy separately.
- No mutation or model request before manual review/Send/Add, rejected or
  changed actor/role/household boundaries, and old binary graceful fallback.

Rollback: keep the flag off, remove draft input wiring, then revert the plugin,
registration and manifest permission in a rebuilt binary. Web rollback alone
does not remove a permission declared by an already installed binary. No schema,
provider or household data migration is introduced. Production activation,
physical acceptance, signing and store privacy declarations remain separate.

API basis: [Android SpeechRecognizer](https://developer.android.com/reference/android/speech/SpeechRecognizer)
and [Capacitor Android plugin/permission API](https://capacitorjs.com/docs/plugins/android).
