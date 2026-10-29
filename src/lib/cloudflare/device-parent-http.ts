import { deviceEmpty, deviceError, deviceJson } from "@/lib/device-http";
import { clearDeviceCookies } from "@/lib/device-session";
import type { DeviceCredentialResult } from "./device-credentials-entry";
export function deviceParentReply(result: DeviceCredentialResult) {
  if (result.status === 204) return deviceEmpty(204);
  if (result.body) return deviceJson(result.body, result.status);
  const response = deviceError(result.status, result.code ?? "INTERNAL_ERROR", {
    headers: result.retryAfterSeconds
      ? { "Retry-After": String(result.retryAfterSeconds) }
      : undefined,
  });
  if (
    result.code === "DEVICE_REVOKED" ||
    result.code === "DEVICE_SESSION_INVALID"
  )
    clearDeviceCookies(response);
  return response;
}
