/** @jest-environment jsdom */
/** Source for later consolidated QA, not microphone/device evidence. */
import { act, renderHook } from "@testing-library/react";
import { useVoiceDraft } from "../use-voice-draft";
const recognizers: FakeRecognition[] = [];
class FakeRecognition {
  lang = "";
  continuous = false;
  interimResults = false;
  onresult:
    | ((event: {
        results: ArrayLike<ArrayLike<{ transcript: string }>>;
      }) => void)
    | null = null;
  onerror: ((event: { error: string }) => void) | null = null;
  onend: (() => void) | null = null;
  start = jest.fn();
  stop = jest.fn();
  abort = jest.fn();
  constructor() {
    recognizers.push(this);
  }
}
const originalSpeech = Object.getOwnPropertyDescriptor(
  window,
  "SpeechRecognition",
);
const originalVisibility = Object.getOwnPropertyDescriptor(
  document,
  "visibilityState",
);
beforeEach(() => {
  jest.useFakeTimers();
  recognizers.length = 0;
  Object.defineProperty(window, "SpeechRecognition", {
    value: FakeRecognition,
    configurable: true,
  });
  Object.defineProperty(document, "visibilityState", {
    value: "visible",
    configurable: true,
  });
});
afterEach(() => {
  jest.useRealTimers();
  if (originalSpeech)
    Object.defineProperty(window, "SpeechRecognition", originalSpeech);
  else Reflect.deleteProperty(window, "SpeechRecognition");
  if (originalVisibility)
    Object.defineProperty(document, "visibilityState", originalVisibility);
  else Reflect.deleteProperty(document, "visibilityState");
});
it("starts only on an explicit action, uses the requested language and stops at its opted-in deadline", () => {
  const transcript = jest.fn(),
    error = jest.fn();
  const { result } = renderHook(() =>
    useVoiceDraft(true, transcript, error, "es-MX", 20000),
  );
  expect(recognizers).toHaveLength(0);
  act(() => result.current.start());
  expect(recognizers[0].lang).toBe("es-MX");
  expect(recognizers[0].start).toHaveBeenCalledTimes(1);
  act(() => jest.advanceTimersByTime(20001));
  expect(recognizers[0].abort).toHaveBeenCalledTimes(1);
  expect(error).toHaveBeenCalledWith("voiceNoInput");
  expect(transcript).not.toHaveBeenCalled();
});
it("does not let a late old end callback clear a new recognizer, and detaches callbacks when disabled", () => {
  const { result, rerender } = renderHook(
    ({ enabled }) =>
      useVoiceDraft(enabled, jest.fn(), jest.fn(), "en-CA", 20000),
    { initialProps: { enabled: true } },
  );
  act(() => result.current.start());
  const oldEnd = recognizers[0].onend;
  act(() => result.current.stop());
  act(() => result.current.start());
  act(() => oldEnd?.());
  expect(result.current.listening).toBe(true);
  rerender({ enabled: false });
  expect(recognizers[1].abort).toHaveBeenCalledTimes(1);
  expect(recognizers[1].onresult).toBeNull();
});
