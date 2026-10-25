/** Personal inbox reads share existing owned deadlines and stream bounds. */
import { runOwnedForeground } from "./owned-request-http";
import { readBoundedJsonResponse } from "./bounded-json-response";

export const NOTIFICATION_READ_BYTES = 512 * 1024;
export interface NotificationItem {
  id: string;
  type: string;
  title: string;
  message?: string | null;
  read: boolean;
  snoozed_until?: string | null;
  created_at: string;
}

function isNotification(value: unknown): value is NotificationItem {
  if (!value || typeof value !== "object") return false;
  const row = value as Record<string, unknown>;
  return (
    typeof row.id === "string" &&
    row.id.length > 0 &&
    typeof row.type === "string" &&
    typeof row.title === "string" &&
    typeof row.read === "boolean" &&
    typeof row.created_at === "string" &&
    Number.isFinite(Date.parse(row.created_at)) &&
    (row.message == null || typeof row.message === "string") &&
    (row.snoozed_until == null ||
      (typeof row.snoozed_until === "string" &&
        Number.isFinite(Date.parse(row.snoozed_until))))
  );
}

export type NotificationPage = {
  notifications: NotificationItem[];
  nextCursor: string | null;
  pagingSupported: boolean;
};
export class NotificationPageError extends Error {}

export async function readNotificationPage(
  url: string,
  invalidMessage: string,
  signal: AbortSignal,
  options: { fetchImpl?: typeof fetch; timeoutMs?: number } = {},
): Promise<NotificationPage> {
  const result = await runOwnedForeground(async ownedSignal => {
    const response = await (options.fetchImpl ?? fetch)(url, {
      cache: "no-store", signal: ownedSignal,
    });
    // Read failures use the existing localized retry state; do not decode an
    // unbounded proxy error body or display server-provided household content.
    if (!response.ok || ownedSignal.aborted) throw new Error("Notification read unavailable");
    const body = await readBoundedJsonResponse(response, ownedSignal, NOTIFICATION_READ_BYTES);
    return { kind: "reply" as const, body };
  }, { signal, timeoutMs: options.timeoutMs ?? 15_000 });
  if (result.kind !== "reply") throw new Error("Notification read unavailable");
  const body = result.body;
  if (!body || typeof body !== "object" || !("notifications" in body) ||
    !Array.isArray(body.notifications) || body.notifications.length > 50 ||
    !body.notifications.every(isNotification) ||
    new Set(body.notifications.map(row => row.id)).size !== body.notifications.length)
    throw new NotificationPageError(invalidMessage);
  const supported = "nextCursor" in body;
  const cursor = "nextCursor" in body ? body.nextCursor : null;
  if (cursor !== null && (typeof cursor !== "string" || !/^[A-Za-z0-9_-]{1,1024}$/.test(cursor) || !body.notifications.length))
    throw new NotificationPageError(invalidMessage);
  return { notifications: body.notifications, nextCursor: cursor as string | null, pagingSupported: supported };
}
