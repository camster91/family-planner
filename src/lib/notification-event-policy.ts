/** Server-only private producer readiness. No provider/scheduler activation. */
import { IDEMPOTENCY_TTL_MS } from "@/lib/idempotency-key";
import { notificationEventAdmissionEnabled } from "@/lib/notification-event-admission";
export function readPrivateNotificationDispatchWindow(flagName: string, windowName: string): number | null {
  if (process.env[flagName] !== "1") return null;
  const raw = process.env[windowName] ?? "";
  const value = Number(raw);
  if (!notificationEventAdmissionEnabled() || !/^[1-9][0-9]{0,8}$/.test(raw)
      || !Number.isSafeInteger(value) || value > IDEMPOTENCY_TTL_MS)
    throw new Error("Chore notification event contract unavailable");
  return value;
}
