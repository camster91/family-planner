/** Authored journey cases. Execution/rendered/browser/native QA remains deferred. */
import * as React from "react";
import {
  render,
  screen,
  fireEvent,
  waitFor,
  act,
} from "@testing-library/react";
import WeeklyResetReview from "../WeeklyResetReview";
import { weeklyResetMessages } from "@/i18n/weekly-reset";
import {
  readWeeklyResetContext,
  readWeeklyResetView,
  readWeeklyResetStep,
  inspectWeeklyReset,
  sendWeeklyReset,
} from "@/lib/weekly-reset-client";
import { browserWeeklyResetRecovery } from "@/lib/weekly-reset-browser";
import { WEEKLY_RESET_PROTOCOL } from "@/lib/weekly-reset";
import type { WeeklyResetRecoveryEntry } from "@/lib/weekly-reset-recovery";
jest.mock("@/components/ui/use-display-locale", () => ({
  useDisplayLocale: () => "en-CA",
}));
jest.mock("@/i18n/weekly-reset", () => {
  const actual = jest.requireActual("@/i18n/weekly-reset");
  return { ...actual, useWeeklyResetText: () => actual.weeklyResetMessages.en };
});
jest.mock("@/lib/weekly-reset-client", () => ({
  readWeeklyResetContext: jest.fn(),
  readWeeklyResetView: jest.fn(),
  readWeeklyResetStep: jest.fn(),
  inspectWeeklyReset: jest.fn(),
  sendWeeklyReset: jest.fn(),
}));
jest.mock("@/lib/weekly-reset-browser", () => ({
  browserWeeklyResetRecovery: jest.fn(),
}));
const scope = { weekStart: "2026-10-19", timeZone: "America/Toronto" };
const props = {
  userId: "user-a",
  familyId: "family-a",
  initialScope: scope,
  onClose: jest.fn(),
};
const snapshot = {
  protocol: WEEKLY_RESET_PROTOCOL,
  owner: { userId: props.userId, familyId: props.familyId },
  scope,
  revision: 0,
  started: false,
  steps: [
    {
      id: "schedule" as const,
      href: "/dashboard/calendar" as const,
      state: "pending" as const,
    },
  ],
  finishedAt: null,
  complete: false,
};
const context = {
  contract: "herewoven.weekly-reset-recovery.v1",
  enabled: true,
  owner: {
    kind: "person",
    ownerId: props.userId,
    scope: "a".repeat(64),
    generation: 0,
    householdScope: "b".repeat(64),
  },
  userId: props.userId,
  familyId: props.familyId,
} as const;
const copy = weeklyResetMessages.en;
function setup(rows: WeeklyResetRecoveryEntry[] = []) {
  let saved = rows;
  const store = {
    initialize: jest.fn(async () => saved),
    stage: jest.fn(async (entry: WeeklyResetRecoveryEntry) => {
      saved = [entry];
    }),
    send: jest.fn(
      async (_key: string, _review: boolean, send: typeof sendWeeklyReset) =>
        send(saved[0], context.owner.scope),
    ),
    inspect: jest.fn(async (_key: string, inspect: typeof inspectWeeklyReset) =>
      inspect(saved[0], context),
    ),
    dismiss: jest.fn(async () => {
      saved = [];
    }),
    recoverStorage: jest.fn(async () => saved),
    hasUncertainStorage: jest.fn(() => false),
    writesAvailable: jest.fn(() => true),
  };
  jest
    .mocked(browserWeeklyResetRecovery)
    .mockReturnValue(
      store as unknown as ReturnType<typeof browserWeeklyResetRecovery>,
    );
  jest.mocked(readWeeklyResetContext).mockResolvedValue(context);
  jest.mocked(readWeeklyResetView).mockResolvedValue(snapshot);
  jest.mocked(readWeeklyResetStep).mockResolvedValue({
    protocol: WEEKLY_RESET_PROTOCOL,
    owner: snapshot.owner,
    scope,
    generatedAt: "2026-10-20T16:00:00Z",
    step: "schedule",
    groups: [],
    notes: [],
  });
  jest.mocked(sendWeeklyReset).mockResolvedValue({ kind: "unknown" });
  return store;
}
beforeEach(() => jest.clearAllMocks());
it("does not start or resend anything merely by opening a review", async () => {
  const store = setup();
  render(<WeeklyResetReview {...props} />);
  await screen.findByText(copy.startHint);
  expect(store.stage).not.toHaveBeenCalled();
  expect(store.send).not.toHaveBeenCalled();
  expect(sendWeeklyReset).not.toHaveBeenCalled();
});
it("stages one exact owned request before sending and keeps an unknown outcome", async () => {
  const store = setup();
  render(<WeeklyResetReview {...props} />);
  const start = await screen.findByRole("button", { name: copy.start });
  fireEvent.click(start);
  fireEvent.click(start);
  await screen.findByRole("button", { name: copy.check });
  expect(store.stage).toHaveBeenCalledTimes(1);
  expect(store.send).toHaveBeenCalledTimes(1);
  expect(store.stage.mock.invocationCallOrder[0]).toBeLessThan(
    store.send.mock.invocationCallOrder[0],
  );
  const entry = store.stage.mock.calls[0][0];
  expect(JSON.parse(entry.body)).toMatchObject({
    userId: props.userId,
    familyId: props.familyId,
    ...scope,
    action: "start",
    expectedRevision: 0,
  });
  expect(store.dismiss).not.toHaveBeenCalled();
});
it("never sends when durable staging fails, and keeps the original request for storage recovery", async () => {
  const store = setup();
  store.stage.mockRejectedValueOnce(new Error("storage unavailable"));
  render(<WeeklyResetReview {...props} />);
  fireEvent.click(await screen.findByRole("button", { name: copy.start }));
  await screen.findByText(copy.storageError);
  expect(store.send).not.toHaveBeenCalled();
  expect(sendWeeklyReset).not.toHaveBeenCalled();
  expect(screen.getByRole("button", { name: copy.check })).toBeDisabled();
});
it("holds a restored request without replay and uses a committed receipt only to clear local recovery and reload progress", async () => {
  const entry: WeeklyResetRecoveryEntry = {
    kind: "weekly-reset",
    key: "weekly_reset_request_a",
    body: JSON.stringify({
      protocol: WEEKLY_RESET_PROTOCOL,
      userId: props.userId,
      familyId: props.familyId,
      ...scope,
      action: "start",
      issuedAt: "2026-10-20T16:00:00Z",
      expectedRevision: 0,
    }),
  };
  const store = setup([entry]);
  jest.mocked(inspectWeeklyReset).mockResolvedValue({
    contract: context.contract,
    ownerScope: context.owner.scope,
    entry,
    state: "committed",
    canRetry: false,
    currentRevision: 1,
    receipt: {
      receipt: {
        protocol: WEEKLY_RESET_PROTOCOL,
        userId: props.userId,
        familyId: props.familyId,
        ...scope,
        action: "start",
        revision: 1,
      },
    },
  });
  render(<WeeklyResetReview {...props} />);
  const check = await screen.findByRole("button", { name: copy.check });
  await waitFor(() => expect(check).not.toBeDisabled());
  expect(store.send).not.toHaveBeenCalled();
  fireEvent.click(check);
  await waitFor(() => expect(store.dismiss).toHaveBeenCalledWith(entry.key));
  expect(sendWeeklyReset).not.toHaveBeenCalled();
  expect(readWeeklyResetView).toHaveBeenCalledTimes(2);
});
it("does not send after closing while durable staging is still pending", async () => {
  const store = setup();
  let release!: () => void;
  store.stage.mockImplementationOnce(
    () =>
      new Promise<void>((resolve) => {
        release = resolve;
      }),
  );
  const mounted = render(<WeeklyResetReview {...props} />);
  fireEvent.click(await screen.findByRole("button", { name: copy.start }));
  await waitFor(() => expect(store.stage).toHaveBeenCalledTimes(1));
  mounted.unmount();
  await act(async () => release());
  expect(store.send).not.toHaveBeenCalled();
});
it("does not resurrect a confirmed request when recovery completes a partially failed local dismissal", async () => {
  const entry: WeeklyResetRecoveryEntry = {
    kind: "weekly-reset",
    key: "weekly_reset_request_a",
    body: JSON.stringify({
      protocol: WEEKLY_RESET_PROTOCOL,
      userId: props.userId,
      familyId: props.familyId,
      ...scope,
      action: "start",
      issuedAt: "2026-10-20T16:00:00Z",
      expectedRevision: 0,
    }),
  };
  const store = setup([entry]);
  jest
    .mocked(inspectWeeklyReset)
    .mockResolvedValue({
      contract: context.contract,
      ownerScope: context.owner.scope,
      entry,
      state: "committed",
      canRetry: false,
      currentRevision: 1,
      receipt: {
        receipt: {
          protocol: WEEKLY_RESET_PROTOCOL,
          userId: props.userId,
          familyId: props.familyId,
          ...scope,
          action: "start",
          revision: 1,
        },
      },
    });
  let uncertain = false;
  store.dismiss.mockImplementationOnce(async () => {
    uncertain = true;
    throw new Error("partial storage removal");
  });
  store.hasUncertainStorage.mockImplementation(() => uncertain);
  store.recoverStorage.mockImplementationOnce(async () => {
    uncertain = false;
    return [];
  });
  render(<WeeklyResetReview {...props} />);
  const check = await screen.findByRole("button", { name: copy.check });
  await waitFor(() => expect(check).not.toBeDisabled());
  fireEvent.click(check);
  const repair = await screen.findByRole("button", { name: copy.repair });
  await waitFor(() => expect(repair).not.toBeDisabled());
  fireEvent.click(repair);
  await waitFor(() =>
    expect(
      screen.queryByRole("button", { name: copy.check }),
    ).not.toBeInTheDocument(),
  );
  expect(store.stage).not.toHaveBeenCalled();
  expect(store.send).not.toHaveBeenCalled();
});
it("keeps a failed preview distinct from empty and still allows explicit skip", async () => {
  setup();
  jest
    .mocked(readWeeklyResetView)
    .mockResolvedValue({ ...snapshot, started: true });
  jest
    .mocked(readWeeklyResetStep)
    .mockRejectedValueOnce(new Error("unavailable"));
  render(<WeeklyResetReview {...props} />);
  await screen.findByText(copy.stepError);
  expect(screen.queryByText(copy.empty)).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: copy.mark })).toBeDisabled();
  expect(screen.getByRole("button", { name: copy.skip })).not.toBeDisabled();
});
