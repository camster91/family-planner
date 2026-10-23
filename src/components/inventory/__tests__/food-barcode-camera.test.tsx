/** @jest-environment jsdom */
import { act, renderHook } from "@testing-library/react";
import { useFoodBarcodeCamera } from "../use-food-barcode-camera";
const originalSecure = Object.getOwnPropertyDescriptor(
  window,
  "isSecureContext",
);
const originalMedia = Object.getOwnPropertyDescriptor(
  navigator,
  "mediaDevices",
);
const originalDetector = Object.getOwnPropertyDescriptor(
  window,
  "BarcodeDetector",
);
afterEach(() => {
  for (const [target, key, original] of [
    [window, "isSecureContext", originalSecure],
    [navigator, "mediaDevices", originalMedia],
    [window, "BarcodeDetector", originalDetector],
  ] as const) {
    if (original) Object.defineProperty(target, key, original);
    else Reflect.deleteProperty(target, key);
  }
});
it("leaves permission untouched when local decoding is unsupported", async () => {
  const getUserMedia = jest.fn();
  Object.defineProperty(window, "isSecureContext", {
    configurable: true,
    value: true,
  });
  Object.defineProperty(window, "BarcodeDetector", {
    configurable: true,
    value: undefined,
  });
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: { getUserMedia },
  });
  const { result, unmount } = renderHook(() => useFoodBarcodeCamera(jest.fn()));
  await act(async () => result.current.start());
  expect(result.current.error).toBe("unavailable");
  expect(getUserMedia).not.toHaveBeenCalled();
  unmount();
});
it("stops a permission result arriving after the capture sheet was closed", async () => {
  let resolve!: (value: MediaStream) => void;
  const permission = new Promise<MediaStream>((done) => {
    resolve = done;
  });
  const stop = jest.fn();
  class Detector {
    static async getSupportedFormats() {
      return ["ean_13"];
    }
  }
  Object.defineProperty(window, "isSecureContext", {
    configurable: true,
    value: true,
  });
  Object.defineProperty(window, "BarcodeDetector", {
    configurable: true,
    value: Detector,
  });
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: { getUserMedia: jest.fn(() => permission) },
  });
  const onCode = jest.fn();
  const { result, unmount } = renderHook(() => useFoodBarcodeCamera(onCode));
  let pending!: Promise<void>;
  await act(async () => {
    pending = result.current.start();
    await Promise.resolve();
  });
  unmount();
  await act(async () => {
    resolve({ getTracks: () => [{ stop }] } as unknown as MediaStream);
    await pending;
  });
  expect(stop).toHaveBeenCalledTimes(1);
  expect(onCode).not.toHaveBeenCalled();
});
