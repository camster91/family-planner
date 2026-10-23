"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "@/i18n";
import {
  hasLocalVoice,
  LocalVoice,
  localVoiceResult,
  wakePhraseDraft,
} from "@/lib/local-voice";

type Notice =
  | "denied"
  | "timeout"
  | "unavailable"
  | "no-input"
  | "phrase"
  | "changed"
  | "ready"
  | null;
const messages = {
  en: {
    title: "Local voice preview",
    plain: "Dictate a draft",
    wake: "Try wake phrase",
    stop: "Stop listening",
    help: "Android preview. Tap to listen to one phrase, for up to 20 seconds. Speech stays on this device. Nothing is submitted. Review and edit your draft before continuing.",
    wakeHelp:
      "For the phrase experiment, say “Hey herewoven” followed by your draft. It works only while this screen is listening, and may stop earlier after silence.",
    listening: "Listening on this device…",
    denied: "Microphone access was denied. You can still type.",
    timeout: "Listening timed out. Tap to try again or type.",
    unavailable:
      "Local speech is not ready on this device or in this language. You can still type.",
    "no-input": "No speech was recognized. Tap to try again or type.",
    phrase: "Say “Hey herewoven” followed by your draft. No draft was changed.",
    changed:
      "Your draft changed while listening, so it was kept. Tap to dictate again when ready.",
    ready: "Draft added. Check the words before continuing.",
  },
  es: {
    title: "Vista previa de voz local",
    plain: "Dictar un borrador",
    wake: "Probar frase de activación",
    stop: "Dejar de escuchar",
    help: "Vista previa para Android. Toca para escuchar una frase, hasta 20 segundos. La voz se procesa en este dispositivo. No se envía nada. Revisa y edita el borrador antes de continuar.",
    wakeHelp:
      "Para probar la frase, di «Hola herewoven» seguido del borrador. Solo funciona mientras esta pantalla escucha y puede parar antes tras un silencio.",
    listening: "Escuchando en este dispositivo…",
    denied: "Se denegó el acceso al micrófono. Aún puedes escribir.",
    timeout: "Se agotó el tiempo. Toca para volver a intentarlo o escribe.",
    unavailable:
      "La voz local no está disponible en este dispositivo o idioma. Aún puedes escribir.",
    "no-input":
      "No se reconoció ninguna voz. Toca para volver a intentarlo o escribe.",
    phrase:
      "Di «Hola herewoven» seguido del borrador. No se cambió el borrador.",
    changed:
      "Tu borrador cambió mientras se escuchaba y se conservó. Vuelve a dictar cuando quieras.",
    ready: "Borrador añadido. Revisa las palabras antes de continuar.",
  },
};
/** An explicit draft input; never calls the assistant, queue or domain mutation APIs. */
export function LocalVoiceDraft({
  enabled,
  contextKey,
  value,
  maxLength = 2000,
  onDraft,
  beforeListen,
}: {
  enabled: boolean;
  contextKey: string;
  value: string;
  maxLength?: number;
  onDraft: (text: string) => void;
  beforeListen?: () => void;
}) {
  const { locale } = useTranslation();
  const text = messages[locale === "es" ? "es" : "en"];
  const [available, setAvailable] = useState(false);
  const [supported, setSupported] = useState(false);
  const [listening, setListening] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);
  const request = useRef<string | null>(null);
  const deadline = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latest = useRef({ value, onDraft, enabled, contextKey, locale });
  latest.current = { value, onDraft, enabled, contextKey, locale };
  const stop = useCallback(() => {
    const current = request.current;
    request.current = null;
    if (deadline.current !== null) clearTimeout(deadline.current);
    deadline.current = null;
    if (current)
      void LocalVoice.cancel({ requestId: current }).catch(() => undefined);
    setListening(false);
  }, []);
  useEffect(() => {
    let active = true;
    setAvailable(false);
    setNotice(null);
    const supported = enabled && hasLocalVoice();
    setSupported(supported);
    if (supported) {
      void LocalVoice.availability()
        .then((result) => {
          if (active) setAvailable(result.available === true);
        })
        .catch(() => undefined);
    }
    const hide = () => {
      if (document.visibilityState !== "visible") stop();
    };
    document.addEventListener("visibilitychange", hide);
    window.addEventListener("pagehide", stop);
    window.addEventListener("herewoven:voice-input-start", stop);
    return () => {
      active = false;
      stop();
      document.removeEventListener("visibilitychange", hide);
      window.removeEventListener("pagehide", stop);
      window.removeEventListener("herewoven:voice-input-start", stop);
    };
  }, [enabled, contextKey, locale, stop]);
  async function listen(wake: boolean) {
    if (
      request.current ||
      !enabled ||
      !available ||
      document.visibilityState !== "visible"
    )
      return;
    beforeListen?.();
    window.dispatchEvent(new Event("herewoven:voice-input-start"));
    const id = crypto.randomUUID();
    const original = { value, contextKey, locale };
    request.current = id;
    setListening(true);
    setNotice(null);
    deadline.current = setTimeout(() => {
      if (request.current === id) {
        stop();
        setNotice("timeout");
      }
    }, 21_000);
    try {
      const parsed = localVoiceResult.safeParse(
        await LocalVoice.listen({
          requestId: id,
          language: locale === "es" ? "es" : "en",
        }),
      );
      if (
        request.current !== id ||
        !latest.current.enabled ||
        latest.current.contextKey !== original.contextKey ||
        latest.current.locale !== original.locale ||
        document.visibilityState !== "visible"
      )
        return;
      if (!parsed.success) {
        setNotice("unavailable");
        return;
      }
      const result = parsed.data;
      if (result.status !== "transcript") {
        if (result.status !== "cancelled") setNotice(result.status);
        return;
      }
      if (latest.current.value !== original.value) {
        setNotice("changed");
        return;
      }
      const draft = wake ? wakePhraseDraft(result.text) : result.text.trim();
      if (!draft) {
        setNotice(wake ? "phrase" : "no-input");
        return;
      }
      latest.current.onDraft(draft.slice(0, maxLength));
      setNotice("ready");
    } catch {
      if (request.current === id) setNotice("unavailable");
    } finally {
      if (request.current === id) {
        if (deadline.current !== null) clearTimeout(deadline.current);
        deadline.current = null;
        request.current = null;
        setListening(false);
      }
    }
  }
  if (!supported || !enabled) return null;
  return (
    <details
      className="rounded-xl border border-[var(--surface-separator)] p-3"
      onToggle={(event) => {
        if (!event.currentTarget.open) stop();
      }}
    >
      <summary className="min-h-[44px] content-center cursor-pointer font-semibold">
        {text.title}
      </summary>
      <div className="space-y-3 pt-2">
        <p className="text-sm text-label-secondary">{text.help}</p>
        <p className="text-sm text-label-secondary">{text.wakeHelp}</p>
        <div className="flex flex-wrap gap-2">
          {listening ? (
            <button
              type="button"
              className="btn-secondary min-h-[44px]"
              onClick={stop}
            >
              {text.stop}
            </button>
          ) : (
            <>
              <button
                type="button"
                disabled={!available}
                className="btn-secondary min-h-[44px]"
                onClick={() => void listen(false)}
              >
                {text.plain}
              </button>
              <button
                type="button"
                disabled={!available}
                className="btn-secondary min-h-[44px]"
                onClick={() => void listen(true)}
              >
                {text.wake}
              </button>
            </>
          )}
        </div>
        {(listening || notice) && (
          <p role="status" aria-live="polite">
            {listening ? text.listening : notice ? text[notice] : null}
          </p>
        )}
        {!available && <p role="status">{text.unavailable}</p>}
      </div>
    </details>
  );
}
