/** Source cases only; execution deferred with the consolidated QA pass. */
import { readNotificationPage, NOTIFICATION_READ_BYTES } from "../notification-read-client";
const row = { id: "notice-a", type: "chore", title: "Fixture", read: false,
  created_at: "2026-10-24T12:00:00.000Z" };
const response = (body: unknown) => ({ ok: true, json: async () => body }) as Response;
const signal = () => new AbortController().signal;
afterEach(() => jest.useRealTimers());
it("preserves legacy and paged replies without inventing a history cursor", async () => {
  for (const paged of [false, true]) {
    const body = { notifications: [row], ...(paged ? { nextCursor: "cursor-a" } : {}) };
    const fetchImpl = jest.fn(async () => response(body));
    await expect(readNotificationPage("/api/notifications", "Invalid", signal(), { fetchImpl }))
      .resolves.toEqual({ notifications: [row], nextCursor: paged ? "cursor-a" : null, pagingSupported: paged });
  }
});
it.each(["headers", "body"])("settles ignored-abort %s stalls at the foreground deadline", async stage => {
  jest.useFakeTimers();
  const fetchImpl = jest.fn(async () => stage === "headers" ? new Promise<Response>(() => undefined)
    : { ok: true, json: () => new Promise(() => undefined) } as Response);
  const pending = readNotificationPage("/api/notifications", "Invalid", signal(), { fetchImpl, timeoutMs: 100 });
  const rejection = expect(pending).rejects.toThrow("Notification read unavailable");
  await jest.advanceTimersByTimeAsync(100);
  await rejection;
  expect(fetchImpl).toHaveBeenCalledTimes(1);
});
it("aborts superseded work even when the transport ignores cancellation", async () => {
  const controller = new AbortController();
  const fetchImpl = jest.fn(async () => new Promise<Response>(() => undefined));
  const pending = readNotificationPage("/api/notifications", "Invalid", controller.signal, { fetchImpl });
  const rejection = expect(pending).rejects.toThrow("Notification read unavailable");
  await Promise.resolve();
  controller.abort();
  await rejection;
  expect((fetchImpl.mock.calls as unknown as Array<[string, RequestInit]>)[0][1].signal?.aborted).toBe(true);
});
it("does not start already cancelled work", async () => {
  const controller = new AbortController(); controller.abort();
  const fetchImpl = jest.fn();
  await expect(readNotificationPage("/api/notifications", "Invalid", controller.signal, { fetchImpl }))
    .rejects.toThrow("Notification read unavailable");
  expect(fetchImpl).not.toHaveBeenCalled();
});
it("rejects oversized declared replies before decoding", async () => {
  const json = jest.fn();
  const fetchImpl = jest.fn(async () => ({ ok: true, json,
    headers: new Headers({ "content-length": String(NOTIFICATION_READ_BYTES + 1) }),
  }) as unknown as Response);
  await expect(readNotificationPage("/api/notifications", "Invalid", signal(), { fetchImpl }))
    .rejects.toThrow("Notification read unavailable");
  expect(json).not.toHaveBeenCalled();
});
it("bounds JSON-only bridges after decoding and never exposes proxy error bodies", async () => {
  const oversized = jest.fn(async () => response({ notifications: [{ ...row, title: "x".repeat(NOTIFICATION_READ_BYTES) }] }));
  await expect(readNotificationPage("/api/notifications", "Invalid", signal(), { fetchImpl: oversized }))
    .rejects.toThrow("Notification read unavailable");
  const json = jest.fn();
  const failed = jest.fn(async () => ({ ok: false, json }) as unknown as Response);
  await expect(readNotificationPage("/api/notifications", "Invalid", signal(), { fetchImpl: failed }))
    .rejects.toThrow("Notification read unavailable");
  expect(json).not.toHaveBeenCalled();
});
it.each([
  { notifications: [row, row], nextCursor: null },
  { notifications: [], nextCursor: "cursor-a" },
  { notifications: [row], nextCursor: "https://invalid.test" },
])("rejects malformed pagination without returning partial rows", async body => {
  const fetchImpl = jest.fn(async () => response(body));
  await expect(readNotificationPage("/api/notifications", "Localized invalid reply", signal(), { fetchImpl }))
    .rejects.toThrow("Localized invalid reply");
});

it("cancels oversized streamed bytes even without a content-length header", async () => {
  const cancel = jest.fn(async () => undefined);
  const releaseLock = jest.fn();
  const reader = { read: jest.fn(async () => ({ done: false, value: new Uint8Array(NOTIFICATION_READ_BYTES + 1) })), cancel, releaseLock };
  const fetchImpl = jest.fn(async () => ({ ok: true, headers: new Headers(),
    body: { getReader: () => reader },
  }) as unknown as Response);
  await expect(readNotificationPage("/api/notifications", "Invalid", signal(), { fetchImpl }))
    .rejects.toThrow("Notification read unavailable");
  expect(cancel).toHaveBeenCalledTimes(1);
  expect(releaseLock).toHaveBeenCalledTimes(1);
});
