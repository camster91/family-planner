/**
 * Shared-device refusal for person-authenticated surfaces (#510).
 *
 * This module deliberately has no dependency on `api-auth`: the common
 * person-auth helper imports it, and route-level compatibility exports it
 * from `device-route`. Keeping the device-cookie check below both layers
 * prevents a lingering session cookie from turning a paired tablet into a
 * person request while preserving the existing kill-switch, revocation and
 * expiry rules in `isPairedDeviceRequest`.
 */
import type { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  deviceClock,
  deviceError,
  isSharedDeviceEnabled,
} from "@/lib/device-http";
import { isPairedDeviceRequest } from "@/lib/device-session";

export type DeviceCookieSource = {
  cookies: { get: (name: string) => { value: string } | undefined };
};

/** Whether the current request carries a live paired-device credential. */
export async function hasLivePairedDevice(
  request: DeviceCookieSource,
): Promise<boolean> {
  return isPairedDeviceRequest(
    prisma!,
    request,
    deviceClock.now(),
    isSharedDeviceEnabled(),
  );
}

/**
 * Refuse a person route before it reads or verifies `session_token`.
 * Returns null for a normal request and the stable device policy response for
 * a live paired device. Invalid, revoked or expired device cookies remain
 * harmless and continue through ordinary person authentication.
 */
export async function refusePairedDevice(
  request: DeviceCookieSource,
): Promise<NextResponse | null> {
  if (!(await hasLivePairedDevice(request))) return null;
  return deviceError(403, "DEVICE_WRITE_NOT_ALLOWED");
}
