"use client";
import * as React from "react";
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
  onError: (message: string) => void,
) {
  const [supported, setSupported] = React.useState(false),
    [listening, setListening] = React.useState(false);
  const recognition = React.useRef<Recognition | null>(null);
  const textRef = React.useRef(onText),
    errorRef = React.useRef(onError);
  textRef.current = onText;
  errorRef.current = onError;
  React.useEffect(() => {
    const w = window as VoiceWindow;
    setSupported(Boolean(w.SpeechRecognition || w.webkitSpeechRecognition));
  }, []);
  const stop = React.useCallback(() => {
    if (recognition.current) {
      recognition.current.onresult = null;
      recognition.current.onerror = null;
      recognition.current.onend = null;
      recognition.current.abort();
    }
    recognition.current = null;
    setListening(false);
  }, []);
  React.useEffect(() => {
    if (!enabled) stop();
    return stop;
  }, [enabled, stop]);
  const start = () => {
    if (recognition.current) {
      stop();
      return;
    }
    const w = window as VoiceWindow,
      Constructor = w.SpeechRecognition || w.webkitSpeechRecognition;
    if (!Constructor) {
      errorRef.current(
        "Voice is unavailable in this browser. Type your message instead.",
      );
      return;
    }
    const r = new Constructor();
    recognition.current = r;
    r.lang = navigator.language || "en-US";
    r.continuous = false;
    r.interimResults = false;
    r.onresult = (e) => {
      const text = Array.from(e.results)
        .map((row) => row[0]?.transcript ?? "")
        .join(" ")
        .trim();
      if (text) textRef.current(text.slice(0, 2000));
    };
    r.onerror = (e) =>
      errorRef.current(
        e.error === "not-allowed"
          ? "Microphone access was denied. You can still type."
          : "Voice could not hear you. Try again or type.",
      );
    r.onend = () => {
      recognition.current = null;
      setListening(false);
    };
    try {
      r.start();
      setListening(true);
    } catch {
      stop();
      errorRef.current("Voice could not start. Type your message instead.");
    }
  };
  return { supported, listening, start, stop };
}
