// Source authored UNRUN. No flag or deadline is activated outside these mocks.
jest.mock("../notification-recipient-admission", () => ({ admitNotificationRecipientInTx: jest.fn() }));
jest.mock("../notification-event-admission", () => ({ admitNotificationEventInTx: jest.fn(), notificationEventAdmissionEnabled: jest.fn(() => true) }));
import { choreCreateNotificationDispatchWindow } from "../chore-create-notification-event";
import { notificationEventAdmissionEnabled } from "../notification-event-admission";
import { IDEMPOTENCY_TTL_MS } from "../idempotency-key";
const oldFlag = process.env.CHORE_CREATE_NOTIFICATION_EVENTS_ENABLED;
const oldWindow = process.env.CHORE_CREATE_NOTIFICATION_DISPATCH_MS;
afterEach(() => {
  if (oldFlag === undefined) delete process.env.CHORE_CREATE_NOTIFICATION_EVENTS_ENABLED; else process.env.CHORE_CREATE_NOTIFICATION_EVENTS_ENABLED = oldFlag;
  if (oldWindow === undefined) delete process.env.CHORE_CREATE_NOTIFICATION_DISPATCH_MS; else process.env.CHORE_CREATE_NOTIFICATION_DISPATCH_MS = oldWindow;
  jest.mocked(notificationEventAdmissionEnabled).mockReturnValue(true);
});
it("leaves legacy mode in place without explicit cohort adoption", () => {
  delete process.env.CHORE_CREATE_NOTIFICATION_EVENTS_ENABLED;
  process.env.CHORE_CREATE_NOTIFICATION_DISPATCH_MS = "60000";
  expect(choreCreateNotificationDispatchWindow()).toBeNull();
});
it.each([undefined, "", "0", "-1", "1.5", "060000", "1e4", String(IDEMPOTENCY_TTL_MS + 1)])("does not guess or normalize an opted-in invalid window (%s)", value => {
  process.env.CHORE_CREATE_NOTIFICATION_EVENTS_ENABLED = "1";
  if (value === undefined) delete process.env.CHORE_CREATE_NOTIFICATION_DISPATCH_MS; else process.env.CHORE_CREATE_NOTIFICATION_DISPATCH_MS = value;
  expect(() => choreCreateNotificationDispatchWindow()).toThrow("contract unavailable");
});
it("requires general event readiness and preserves the exact reviewed duration", () => {
  process.env.CHORE_CREATE_NOTIFICATION_EVENTS_ENABLED = "1";
  process.env.CHORE_CREATE_NOTIFICATION_DISPATCH_MS = "60000";
  jest.mocked(notificationEventAdmissionEnabled).mockReturnValue(false);
  expect(() => choreCreateNotificationDispatchWindow()).toThrow("contract unavailable");
  jest.mocked(notificationEventAdmissionEnabled).mockReturnValue(true);
  expect(choreCreateNotificationDispatchWindow()).toBe(60000);
});
