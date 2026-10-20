"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  normalizeFoodBarcode,
  type FoodBarcode,
  type FoodBarcodeFormat,
} from "@/lib/food-barcode";
type Detector = {
  detect(
    video: HTMLVideoElement,
  ): Promise<Array<{ rawValue: string; format: string }>>;
};
type DetectorClass = {
  new (options: { formats: string[] }): Detector;
  getSupportedFormats(): Promise<string[]>;
};
/** Foreground, tap-started only. Frames remain on device; late streams are always stopped. */
export function useFoodBarcodeCamera(onCode: (code: FoodBarcode) => void) {
  const video = useRef<HTMLVideoElement>(null);
  const stream = useRef<MediaStream | null>(null);
  const generation = useRef(0);
  const timers = useRef<Array<ReturnType<typeof setTimeout>>>([]);
  const callback = useRef(onCode);
  callback.current = onCode;
  const [active, setActive] = useState(false);
  const [error, setError] = useState<
    "unavailable" | "denied" | "stopped" | null
  >(null);
  const stop = useCallback((notify = true) => {
    generation.current++;
    for (const timer of timers.current) clearTimeout(timer);
    timers.current = [];
    stream.current?.getTracks().forEach((track) => track.stop());
    stream.current = null;
    if (video.current) video.current.srcObject = null;
    if (notify) setActive(false);
  }, []);
  useEffect(() => {
    const hidden = () => {
      if (document.visibilityState !== "visible") {
        stop();
        setError("stopped");
      }
    };
    document.addEventListener("visibilitychange", hidden);
    return () => {
      document.removeEventListener("visibilitychange", hidden);
      stop(false);
    };
  }, [stop]);
  async function start() {
    stop();
    setError(null);
    setActive(true);
    const own = generation.current;
    const current = () => own === generation.current;
    timers.current.push(
      setTimeout(() => {
        stop();
        setError("stopped");
      }, 30000),
    );
    try {
      const Constructor = (
        window as typeof window & { BarcodeDetector?: DetectorClass }
      ).BarcodeDetector;
      if (
        !window.isSecureContext ||
        !Constructor ||
        !navigator.mediaDevices?.getUserMedia
      ) {
        stop();
        setError("unavailable");
        return;
      }
      const supported = await Constructor.getSupportedFormats();
      if (!current()) return;
      const formats = ["ean_8", "ean_13", "upc_a", "upc_e", "itf"].filter(
        (format) => supported.includes(format),
      );
      if (!formats.length) {
        stop();
        setError("unavailable");
        return;
      }
      const detector = new Constructor({ formats });
      const media = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          facingMode: { ideal: "environment" },
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
      });
      if (!current()) {
        media.getTracks().forEach((track) => track.stop());
        return;
      }
      stream.current = media;
      for (const track of media.getTracks())
        track.addEventListener("ended", () => {
          if (current()) {
            stop();
            setError("stopped");
          }
        });
      if (!video.current) {
        stop();
        return;
      }
      video.current.srcObject = media;
      await video.current.play();
      async function scan() {
        if (!current() || !video.current) return;
        try {
          const found = await detector.detect(video.current);
          if (!current()) return;
          for (const result of found.slice(0, 20)) {
            const hint =
              result.format === "itf"
                ? "gtin_14"
                : (result.format as FoodBarcodeFormat);
            if (
              !["ean_8", "ean_13", "upc_a", "upc_e", "gtin_14"].includes(hint)
            )
              continue;
            const code = normalizeFoodBarcode(result.rawValue, hint);
            if (code) {
              stop();
              callback.current(code);
              return;
            }
          }
          timers.current.push(setTimeout(() => void scan(), 300));
        } catch {
          if (current()) {
            stop();
            setError("unavailable");
          }
        }
      }
      void scan();
    } catch {
      if (current()) {
        stop();
        setError("denied");
      }
    }
  }
  return { video, active, error, start, stop };
}
