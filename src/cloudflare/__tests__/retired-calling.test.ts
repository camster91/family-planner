import {
  retiredCallingResponse,
  retireCallSocket,
  isRetiredCallingPath,
} from "../retired-calling";
import { FEATURES, normalizeFeatures } from "@/lib/features";
import { assistantActionSchema } from "@/lib/assistant-actions";

it("retires stale calling clients without exposing data or permitting new sessions", () => {
  const response = retiredCallingResponse();
  expect(response.status).toBe(410);
  expect(response.headers.get("cache-control")).toBe("no-store");
  const close = jest.fn();
  retireCallSocket({ close });
  expect(close).toHaveBeenCalledWith(4003, "Calling removed");
  expect(() =>
    retireCallSocket({
      close: () => {
        throw Error("already closed");
      },
    }),
  ).not.toThrow();
});

it("omits the removed feature even when old household settings enabled it", () => {
  expect(FEATURES.some((f) => String(f.key) === "calling")).toBe(false);
  expect(normalizeFeatures({ calling: true })).not.toHaveProperty("calling");
  expect(
    assistantActionSchema.safeParse({ kind: "open", destination: "calling" })
      .success,
  ).toBe(false);
});

it("retires every old call endpoint without affecting unrelated APIs", () => {
  for (const path of [
    "/api/calls",
    "/api/calls/socket",
    "/api/calls/session",
    "/api/calls/installations",
    "/api/device/calls/session",
  ]) {
    expect(isRetiredCallingPath(path)).toBe(true);
  }
  for (const path of ["/api/calendar", "/api/device/today", "/api/callsmith"])
    expect(isRetiredCallingPath(path)).toBe(false);
});
