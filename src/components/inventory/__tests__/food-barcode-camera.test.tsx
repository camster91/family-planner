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

function cameraFixture(getUserMedia: jest.Mock) {
  class Detector {
    static async getSupportedFormats() {
      return ["ean_13"];
    }
    detect = jest.fn(async () => []);
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
    value: { getUserMedia },
  });
}

it("does not request a camera while the page is hidden", async () => {
  const original = Object.getOwnPropertyDescriptor(document, "visibilityState");
  const getUserMedia = jest.fn();
  cameraFixture(getUserMedia);
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    value: "hidden",
  });
  try {
    const { result, unmount } = renderHook(() =>
      useFoodBarcodeCamera(jest.fn()),
    );
    await act(async () => result.current.start());
    expect(getUserMedia).not.toHaveBeenCalled();
    expect(result.current.active).toBe(false);
    expect(result.current.error).toBe("stopped");
    unmount();
  } finally {
    if (original) Object.defineProperty(document, "visibilityState", original);
    else Reflect.deleteProperty(document, "visibilityState");
  }
});

it("retires an outstanding permission request on page leave without reopening on return", async () => {
  let resolve!: (stream: MediaStream) => void;
  const request = new Promise<MediaStream>((done) => {
    resolve = done;
  });
  const stop = jest.fn(),
    onCode = jest.fn(),
    getUserMedia = jest.fn(() => request);
  cameraFixture(getUserMedia);
  const { result } = renderHook(() => useFoodBarcodeCamera(onCode));
  let pending!: Promise<void>;
  await act(async () => {
    pending = result.current.start();
    await Promise.resolve();
  });
  act(() => window.dispatchEvent(new Event("pagehide")));
  expect(result.current.active).toBe(false);
  expect(result.current.error).toBe("stopped");
  await act(async () => {
    resolve({ getTracks: () => [{ stop }] } as unknown as MediaStream);
    await pending;
  });
  act(() => window.dispatchEvent(new Event("pageshow")));
  expect(stop).toHaveBeenCalledTimes(1);
  expect(getUserMedia).toHaveBeenCalledTimes(1);
  expect(onCode).not.toHaveBeenCalled();
});

it.each([
  ["NotAllowedError", "denied"],
  ["NotFoundError", "unavailable"],
  ["NotReadableError", "unavailable"],
])(
  "reports %s truthfully and allows a new explicit attempt",
  async (name, expected) => {
    const getUserMedia = jest
      .fn()
      .mockRejectedValue(new DOMException("Camera failed", name));
    cameraFixture(getUserMedia);
    const { result } = renderHook(() => useFoodBarcodeCamera(jest.fn()));
    await act(async () => result.current.start());
    expect(result.current.active).toBe(false);
    expect(result.current.error).toBe(expected);
    await act(async () => result.current.start());
    expect(getUserMedia).toHaveBeenCalledTimes(2);
  },
);

it("stops an active preview on page leave and rejects its delayed detection", async () => {
  let detected!: (rows: Array<{ rawValue: string; format: string }>) => void;
  const stop = jest.fn(), onCode = jest.fn();
  const detection = new Promise<Array<{ rawValue: string; format: string }>>(done => { detected = done; });
  cameraFixture(jest.fn(async () => ({ getTracks: () => [{ stop, addEventListener: jest.fn() }] })));
  Object.defineProperty(window, "BarcodeDetector", {
    configurable: true,
    value: class {
      static async getSupportedFormats() { return ["ean_13"]; }
      detect() { return detection; }
    },
  });
  const { result } = renderHook(() => useFoodBarcodeCamera(onCode));
  const preview = { srcObject: null, play: jest.fn(async () => {}) };
  Object.assign(result.current.video, { current: preview });
  await act(async () => result.current.start());
  expect(result.current.active).toBe(true);
  act(() => window.dispatchEvent(new Event("pagehide")));
  expect(stop).toHaveBeenCalledTimes(1);
  expect(preview.srcObject).toBeNull();
  expect(result.current.active).toBe(false);
  await act(async () => { detected([{ rawValue: "4006381333931", format: "ean_13" }]); });
  expect(onCode).not.toHaveBeenCalled();
});
