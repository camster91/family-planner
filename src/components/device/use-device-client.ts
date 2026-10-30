"use client";

import * as React from "react";
import {
  DeviceApiError,
  getDeviceClient,
  type DeviceClient,
} from "@/lib/device-client";
import { PRODUCT_BRAND } from "@/lib/brand";
import { englishDeviceText, type DeviceText, type DeviceFeedback } from "@/i18n/device-management";

/** The tab's device client, or null during server rendering (never used there). */
export function useDeviceClient(): DeviceClient | null {
  return React.useMemo(
    () => (typeof window === "undefined" ? null : getDeviceClient()),
    [],
  );
}

export interface DeviceMe {
  device: { id: string; label: string };
  household: { name: string };
  features: {
    calendar: boolean;
    chores: boolean;
    meals: boolean;
    lists: boolean;
    calling?: boolean;
  };
  parents: Array<{ id: string; name: string; hasPin: boolean }>;
  /** Tablet writes (#274): the household's opt-in. Optional for older servers. */
  deviceWrites?: boolean;
  elevation: {
    active: boolean;
    memberId: string | null;
    expiresAt: string | null;
  };
}

/** "about 3 minutes" from a Retry-After in seconds. */
export function waitText(
  seconds: number | null | undefined,
  text: DeviceText = englishDeviceText,
): string {
  if (!seconds || seconds <= 60) return text("waitMinute");
  const minutes = Math.ceil(seconds / 60);
  if (minutes < 90) return text("waitMinutes", { count: minutes });
  return text("waitHours", { count: Math.round(minutes / 60) });
}

/** Plain-language message for an error the tablet cannot act on itself. */
export function genericDeviceFeedback(error: unknown): DeviceFeedback {
  if (error instanceof DeviceApiError) {
    if (error.code === "NETWORK_ERROR") return { key: "tabletNetwork", params: { brand: PRODUCT_BRAND.name } };
    if (error.status === 429) return { key: "tabletRate", retryAfter: error.retryAfterSeconds };
    if (error.code === "SERVICE_UNAVAILABLE") return { key: "tabletBusy", params: { brand: PRODUCT_BRAND.name } };
  }
  return { key: "tabletError" };
}
export function renderDeviceFeedback(feedback: DeviceFeedback, text: DeviceText = englishDeviceText): string {
  return text(feedback.key, {
    ...feedback.params,
    ...('retryAfter' in feedback ? { wait: waitText(feedback.retryAfter, text) } : {}),
  });
}
export function genericErrorText(error: unknown): string {
  return renderDeviceFeedback(genericDeviceFeedback(error));
}

/** m:ss for a countdown. */
export function formatCountdown(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}
