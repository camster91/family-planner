"use client";
import * as React from "react";
import { Mic, MicOff } from "lucide-react";
import { useTranslation } from "@/i18n";
import { useDisplayLocale } from "@/components/ui/use-display-locale";
import { useVoiceDraft } from "@/components/assistant/use-voice-draft";
import { LocalVoiceDraft } from "@/components/assistant/LocalVoiceDraft";
const messages = {
  en: {
    privacy:
      "Browser voice may use its speech service. The app keeps only this editable transcript in the open form, not an audio recording. Listening stops after 20 seconds. Nothing is saved automatically.",
    voice: "Dictate description",
    stop: "Stop listening",
    apply: "Use in form",
    denied:
      "Microphone access was denied. Type the description or use the fields below.",
    unavailable:
      "Voice is unavailable here. Type the description or use the fields below.",
    noInput: "No speech was recognized. Try again or type.",
    changed:
      "Your description changed while listening, so it was kept. Dictate again when ready.",
  },
  es: {
    privacy:
      "La voz del navegador puede usar su servicio de reconocimiento. La app solo conserva esta transcripción editable en el formulario abierto, no una grabación. La escucha se detiene a los 20 segundos. Nada se guarda automáticamente.",
    voice: "Dictar descripción",
    stop: "Dejar de escuchar",
    apply: "Usar en formulario",
    denied:
      "Se denegó el micrófono. Escribe la descripción o usa los campos de abajo.",
    unavailable:
      "La voz no está disponible aquí. Escribe la descripción o usa los campos de abajo.",
    noInput: "No se reconoció voz. Inténtalo otra vez o escribe.",
    changed:
      "Tu descripción cambió mientras escuchaba y se conservó. Vuelve a dictar cuando esté lista.",
  },
};
type Suggestion<T> =
  { kind: "review"; draft: T } | { kind: "manual"; reason?: string };
/** A foreground suggestion editor. No routes, persistence, target lookup or automatic Apply. */
export function ReviewedDescriptionDraft<T>({
  enabled,
  contextKey,
  title,
  label,
  placeholder,
  hint,
  manual,
  review,
  testId,
  parse,
  renderFields,
  onApply,
}: {
  enabled: boolean;
  contextKey: string;
  title: string;
  label: string;
  placeholder: string;
  hint: string;
  manual: string;
  review: string;
  testId: string;
  parse: (value: string) => Suggestion<T>;
  renderFields: (draft: T) => React.ReactNode;
  onApply: (draft: T) => void;
}) {
  const { locale } = useTranslation(),
    c = messages[locale === "es" ? "es" : "en"];
  const language = useDisplayLocale();
  const [expanded, setExpanded] = React.useState(false);
  const [text, setText] = React.useState("");
  const [notice, setNotice] = React.useState<
    "denied" | "unavailable" | "noInput" | "changed" | null
  >(null);
  const current = React.useRef({ text, enabled, contextKey });
  current.current = { text, enabled, contextKey };
  const started = React.useRef({ text, contextKey });
  const voice = useVoiceDraft(
    enabled && expanded,
    (transcript) => {
      if (
        !current.current.enabled ||
        current.current.contextKey !== started.current.contextKey
      )
        return;
      if (current.current.text !== started.current.text) {
        setNotice("changed");
        return;
      }
      current.current.text = transcript;
      setText(transcript);
      setNotice(null);
    },
    (code) =>
      setNotice(
        code === "voiceDenied"
          ? "denied"
          : code === "voiceNoInput"
            ? "noInput"
            : "unavailable",
      ),
    language,
    20000,
  );
  React.useEffect(() => voice.stop(), [contextKey, locale, voice.stop]);
  const suggestion = parse(text),
    inputId = React.useId();
  return (
    <details
      className="rounded-xl border border-[var(--surface-separator)] p-3"
      data-testid={testId}
      onToggle={(event) => {
        setExpanded(event.currentTarget.open);
        if (!event.currentTarget.open) voice.stop();
      }}
    >
      <summary className="min-h-[44px] cursor-pointer py-2 text-subhead font-semibold">
        {title}
      </summary>
      <div className="space-y-3">
        <p className="text-footnote text-label-secondary">{hint}</p>
        <label htmlFor={inputId} className="block text-subhead">
          {label}
        </label>
        <textarea
          id={inputId}
          value={text}
          maxLength={2000}
          rows={2}
          placeholder={placeholder}
          disabled={!enabled}
          className="input-apple w-full"
          onChange={(event) => {
            current.current.text = event.target.value;
            setText(event.target.value);
            setNotice(null);
          }}
        />
        <p className="text-footnote text-label-secondary">{c.privacy}</p>
        <button
          type="button"
          className="btn-tinted min-h-[44px]"
          disabled={!enabled || !voice.supported}
          aria-pressed={voice.listening}
          onClick={() => {
            if (voice.listening) voice.stop();
            else {
              started.current = {
                text: current.current.text,
                contextKey: current.current.contextKey,
              };
              setNotice(null);
              window.dispatchEvent(new Event("herewoven:voice-input-start"));
              voice.start();
            }
          }}
        >
          {voice.listening ? (
            <MicOff aria-hidden="true" className="h-4 w-4" />
          ) : (
            <Mic aria-hidden="true" className="h-4 w-4" />
          )}
          {voice.listening ? c.stop : c.voice}
        </button>
        {!voice.supported && <p className="text-footnote">{c.unavailable}</p>}
        <LocalVoiceDraft
          enabled={enabled && expanded}
          contextKey={contextKey}
          value={text}
          onDraft={(transcript) => {
            current.current.text = transcript;
            setText(transcript);
            setNotice(null);
          }}
          beforeListen={voice.stop}
        />
        {notice && <p role="status">{c[notice]}</p>}
        {text.trim() &&
          (suggestion.kind === "manual" ? (
            <p role="status">{manual}</p>
          ) : (
            <div className="space-y-2">
              <p className="text-footnote">{review}</p>
              {renderFields(suggestion.draft)}
              <button
                type="button"
                className="btn-tinted min-h-[44px]"
                disabled={!enabled || voice.listening}
                onClick={() => {
                  if (current.current.enabled) {
                    voice.stop();
                    onApply(suggestion.draft);
                  }
                }}
              >
                {c.apply}
              </button>
            </div>
          ))}
      </div>
    </details>
  );
}
