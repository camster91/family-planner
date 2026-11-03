"use client";
import * as React from "react";
import type { VoiceErrorCode } from "@/i18n/assistant";
type Recognition = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onresult:
    | ((e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void)
    | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
};
type VoiceWindow = Window & {
  SpeechRecognition?: new () => Recognition;
  webkitSpeechRecognition?: new () => Recognition;
};
export function useVoiceDraft(
  enabled: boolean,
  onText: (text: string) => void,
  onError: (code: VoiceErrorCode) => void,
  language?: string,
  maxListenMs?: number,
) {
  const [supported, setSupported] = React.useState(false),
    [listening, setListening] = React.useState(false);
  const recognition = React.useRef<Recognition | null>(null);
  const deadline = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const textRef = React.useRef(onText),
    errorRef = React.useRef(onError);
  textRef.current = onText;
  errorRef.current = onError;
  React.useEffect(() => {
    const w = window as VoiceWindow;
    setSupported(Boolean(w.SpeechRecognition || w.webkitSpeechRecognition));
  }, []);
  const stop = React.useCallback(() => {
    if (deadline.current !== null) clearTimeout(deadline.current);
    deadline.current = null;
    const active = recognition.current;
    recognition.current = null;
    setListening(false);
    if (active) {
      active.onresult = null;
      active.onerror = null;
      active.onend = null;
      // Some browsers throw if recognition has already ended. Retire local
      // callbacks first so cleanup cannot keep a stale listening session alive.
      try {
        active.abort();
      } catch {
        /* Already stopped or unavailable. */
      }
    }
  }, []);
  React.useEffect(() => {
    if (!enabled) stop();
    return stop;
  }, [enabled, stop]);
  React.useEffect(() => {
    const hide = () => {
      if (document.visibilityState !== "visible") stop();
    };
    document.addEventListener("visibilitychange", hide);
    window.addEventListener("pagehide", stop);
    window.addEventListener("herewoven:voice-input-start", stop);
    return () => {
      document.removeEventListener("visibilitychange", hide);
      window.removeEventListener("pagehide", stop);
      window.removeEventListener("herewoven:voice-input-start", stop);
    };
  }, [stop]);
  const start = () => {
    if (!enabled || document.visibilityState !== "visible") return;
    if (recognition.current) {
      stop();
      return;
    }
    const w = window as VoiceWindow,
      Constructor = w.SpeechRecognition || w.webkitSpeechRecognition;
    if (!Constructor) {
      errorRef.current("voiceUnavailableError");
      return;
    }
    let r: Recognition;
    try {
      r = new Constructor();
    } catch {
      errorRef.current("voiceStartFailed");
      return;
    }
    recognition.current = r;
    r.lang = language || navigator.language || "en-US";
    r.continuous = false;
    r.interimResults = false;
    r.onresult = (e) => {
      if (recognition.current !== r || document.visibilityState !== "visible")
        return;
      const text = Array.from(e.results)
        .map((row) => row[0]?.transcript ?? "")
        .join(" ")
        .trim();
      stop();
      if (text) textRef.current(text.slice(0, 2000));
      else errorRef.current("voiceNoInput");
    };
    r.onerror = (e) => {
      if (recognition.current !== r) return;
      stop();
      errorRef.current(
        ["not-allowed", "service-not-allowed"].includes(e.error)
          ? "voiceDenied"
          : "voiceNoInput",
      );
    };
    r.onend = () => {
      if (recognition.current !== r) return;
      if (deadline.current !== null) clearTimeout(deadline.current);
      deadline.current = null;
      recognition.current = null;
      setListening(false);
    };
    try {
      r.start();
      // A browser may synchronously end or fail during start().
      if (recognition.current !== r) return;
      setListening(true);
      deadline.current = setTimeout(
        () => {
          if (recognition.current !== r) return;
          stop();
          errorRef.current("voiceNoInput");
        },
        Math.max(
          1000,
          Math.min(
            30000,
            typeof maxListenMs === "number" && Number.isFinite(maxListenMs)
              ? maxListenMs
              : 20000,
          ),
        ),
      );
    } catch {
      stop();
      errorRef.current("voiceStartFailed");
    }
  };
  return { supported, listening, start, stop };
}
