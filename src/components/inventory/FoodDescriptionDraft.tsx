"use client";
import * as React from "react";
import { Mic, MicOff } from "lucide-react";
import { useTranslation } from "@/i18n";
import { useDisplayLocale } from "@/components/ui/use-display-locale";
import { useVoiceDraft } from "@/components/assistant/use-voice-draft";
import { LocalVoiceDraft } from "@/components/assistant/LocalVoiceDraft";
import {
  describeFood,
  type FoodDescriptionDraft as Draft,
} from "@/lib/food-description";
const en = {
  title: "Describe food",
  label: "Food description",
  example: "e.g. Add 2 cans of beans to the pantry",
  hint: "One food at a time. Use an explicit date label and YYYY-MM-DD if including a date. Amounts and units are not converted.",
  privacy:
    "Browser voice may use its speech service. The app keeps only this editable transcript in the open form, not an audio recording. Listening stops after 20 seconds. Nothing is saved automatically.",
  voice: "Dictate description",
  stop: "Stop listening",
  apply: "Use in form",
  manual:
    "This description needs manual review. Try one food with a clear quantity, or use the fields below. Relative or ambiguous dates are not guessed.",
  review:
    "Suggested fields — check them before applying. Only shown fields change; check existing amounts, storage and dates before saving.",
  name: "Name",
  amount: "Amount",
  location: "Storage",
  best_before: "Best before",
  use_by: "Use by",
  fridge: "Fridge",
  freezer: "Freezer",
  pantry: "Pantry",
  denied:
    "Microphone access was denied. Type the description or use the fields below.",
  unavailable:
    "Voice is unavailable here. Type the description or use the fields below.",
  noInput: "No speech was recognized. Try again or type.",
  changed:
    "Your description changed while listening, so it was kept. Dictate again when ready.",
};
const es: typeof en = {
  title: "Describir alimento",
  label: "Descripción del alimento",
  example: "p. ej. Añade 2 latas de frijoles a la despensa",
  hint: "Un alimento cada vez. Indica el tipo de fecha y AAAA-MM-DD si incluyes una fecha. No se convierten cantidades ni unidades.",
  privacy:
    "La voz del navegador puede usar su servicio de reconocimiento. La app solo conserva esta transcripción editable en el formulario abierto, no una grabación. La escucha se detiene a los 20 segundos. Nada se guarda automáticamente.",
  voice: "Dictar descripción",
  stop: "Dejar de escuchar",
  apply: "Usar en formulario",
  manual:
    "Esta descripción necesita revisión manual. Prueba un alimento con una cantidad clara o usa los campos de abajo. No se adivinan fechas relativas ni ambiguas.",
  review:
    "Campos sugeridos: revísalos antes de aplicar. Solo cambian los campos mostrados; comprueba las cantidades, el almacenamiento y las fechas existentes antes de guardar.",
  name: "Nombre",
  amount: "Cantidad",
  location: "Almacenamiento",
  best_before: "Consumo preferente",
  use_by: "Caducidad",
  fridge: "Nevera",
  freezer: "Congelador",
  pantry: "Despensa",
  denied:
    "Se denegó el micrófono. Escribe la descripción o usa los campos de abajo.",
  unavailable:
    "La voz no está disponible aquí. Escribe la descripción o usa los campos de abajo.",
  noInput: "No se reconoció voz. Inténtalo otra vez o escribe.",
  changed:
    "Tu descripción cambió mientras escuchaba y se conservó. Vuelve a dictar cuando esté lista.",
};
export function FoodDescriptionDraft({
  enabled,
  contextKey,
  onApply,
}: {
  enabled: boolean;
  contextKey: string;
  onApply: (draft: Draft) => void;
}) {
  const { locale } = useTranslation(),
    c = locale === "es" ? es : en;
  const language = useDisplayLocale();
  const [expanded, setExpanded] = React.useState(false);
  const [text, setText] = React.useState(""),
    [notice, setNotice] = React.useState<
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
  const suggestion = describeFood(text, locale === "es" ? "es" : "en");
  const inputId = React.useId();
  return (
    <details
      className="rounded-xl border border-[var(--surface-separator)] p-3"
      data-testid="food-description-draft"
      onToggle={(event) => {
        setExpanded(event.currentTarget.open);
        if (!event.currentTarget.open) voice.stop();
      }}
    >
      <summary className="min-h-[44px] cursor-pointer py-2 text-subhead font-semibold">
        {c.title}
      </summary>
      <div className="space-y-3">
        <p className="text-footnote text-label-secondary">{c.hint}</p>
        <label htmlFor={inputId} className="block text-subhead">
          {c.label}
        </label>
        <textarea
          id={inputId}
          value={text}
          maxLength={2000}
          rows={2}
          placeholder={c.example}
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
            setText(transcript);
            setNotice(null);
          }}
          beforeListen={voice.stop}
        />
        {notice && <p role="status">{c[notice]}</p>}
        {text.trim() &&
          (suggestion.kind === "manual" ? (
            <p role="status">{c.manual}</p>
          ) : (
            <div className="space-y-2">
              <p className="text-footnote">{c.review}</p>
              <dl className="grid grid-cols-1 gap-2 text-subhead sm:grid-cols-2">
                <div>
                  <dt className="text-label-secondary">{c.name}</dt>
                  <dd className="break-words">{suggestion.draft.name}</dd>
                </div>
                {suggestion.draft.amount !== undefined && (
                  <div>
                    <dt className="text-label-secondary">{c.amount}</dt>
                    <dd>
                      {new Intl.NumberFormat(language).format(
                        suggestion.draft.amount,
                      )}{" "}
                      {suggestion.draft.unit ?? ""}
                    </dd>
                  </div>
                )}
                {suggestion.draft.location && (
                  <div>
                    <dt className="text-label-secondary">{c.location}</dt>
                    <dd>{c[suggestion.draft.location]}</dd>
                  </div>
                )}
                {suggestion.draft.expires_on && (
                  <div>
                    <dt className="text-label-secondary">
                      {c[suggestion.draft.date_kind!]}
                    </dt>
                    <dd>{suggestion.draft.expires_on}</dd>
                  </div>
                )}
              </dl>
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
