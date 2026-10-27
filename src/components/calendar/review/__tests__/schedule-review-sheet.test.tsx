/** @jest-environment jsdom */
/** Authored journeys only; execution/rendered/native QA is deferred. */
import * as React from "react";
import {
  render,
  screen,
  fireEvent,
  waitFor,
  act,
} from "@testing-library/react";
import ScheduleReviewSheet from "../ScheduleReviewSheet";
import { scheduleReviewMessages } from "@/i18n/schedule-review";
import { browserScheduleRecovery } from "@/lib/calendar-planning/schedule-browser";
import {
  readScheduleContext,
  readScheduleSnapshot,
  readSchedulePreview,
  inspectSchedule,
  sendSchedule,
} from "@/lib/calendar-planning/schedule-client";
import {
  planScheduleReview,
  type ScheduleReviewQuery,
} from "@/lib/calendar-planning/conflict-review";
import { formatScheduleInstant } from "@/lib/calendar-planning/schedule-form";
import { notifyCalendarChanged } from "@/lib/calendar-planning/changes";
import {
  snapshot,
  context,
  entry,
  receipt,
  now,
  choice,
} from "@/lib/calendar-planning/__tests__/schedule-fixture";
import type { ScheduleRecoveryEntry } from "@/lib/calendar-planning/schedule-recovery";
const mockRouter = {
  push: jest.fn(),
  replace: jest.fn(),
  back: jest.fn(),
  forward: jest.fn(),
  refresh: jest.fn(),
};
jest.mock("next/navigation", () => ({
  useRouter: () => mockRouter,
}));
jest.mock("@/components/ui/use-display-locale", () => ({
  useDisplayLocale: () => "en-CA",
}));
jest.mock("@/i18n/schedule-review", () => {
  const actual = jest.requireActual("@/i18n/schedule-review");
  return {
    ...actual,
    useScheduleReviewText: () => actual.scheduleReviewMessages.en,
  };
});
jest.mock("@/lib/calendar-planning/schedule-client", () => ({
  ...jest.requireActual("@/lib/calendar-planning/schedule-client"),
  readScheduleContext: jest.fn(),
  readScheduleSnapshot: jest.fn(),
  readSchedulePreview: jest.fn(),
  inspectSchedule: jest.fn(),
  sendSchedule: jest.fn(),
}));
jest.mock("@/lib/calendar-planning/schedule-browser", () => ({
  browserScheduleRecovery: jest.fn(),
}));
jest.mock("@/lib/calendar-planning/changes", () => ({
  notifyCalendarChanged: jest.fn(),
}));
const copy = scheduleReviewMessages.en,
  scope = {
    targetId: snapshot.events[0].id,
    range: snapshot.range,
    timeZone: snapshot.timeZone,
  },
  props = { initialScope: scope, onClose: jest.fn(), onOpen: jest.fn() };
function setup(rows: ScheduleRecoveryEntry[] = []) {
  let saved = [...rows];
  const store = {
    initialize: jest.fn(async () => saved),
    stage: jest.fn(async (value: ScheduleRecoveryEntry) => {
      saved = [...saved, value];
    }),
    send: jest.fn(
      async (key: string, _review: boolean, send: typeof sendSchedule) =>
        send(
          saved.find((value) => value.key === key)!,
          context.owner!.scope,
        ),
    ),
    inspect: jest.fn(async (key: string, inspect: typeof inspectSchedule) =>
      inspect(
        saved.find((value) => value.key === key)!,
        context,
      ),
    ),
    dismiss: jest.fn(async (key: string) => {
      saved = saved.filter((value) => value.key !== key);
    }),
    hasUncertainStorage: jest.fn(() => false),
    recoverStorage: jest.fn(async () => saved),
    writesAvailable: jest.fn(() => true),
  };
  jest
    .mocked(browserScheduleRecovery)
    .mockReturnValue(
      store as unknown as ReturnType<typeof browserScheduleRecovery>,
    );
  jest.mocked(readScheduleContext).mockResolvedValue(context);
  jest
    .mocked(readScheduleSnapshot)
    .mockResolvedValue({ snapshot, evaluatedAt: now.toISOString() });
  jest
    .mocked(readSchedulePreview)
    .mockImplementation(async (query: ScheduleReviewQuery) => ({
      snapshot,
      evaluatedAt: now.toISOString(),
      plan: planScheduleReview(snapshot, query, now),
    }));
  jest.mocked(sendSchedule).mockResolvedValue({ kind: "unknown" });
  return store;
}
beforeEach(() => jest.resetAllMocks());
async function options() {
  await screen.findByText(snapshot.events[0].title);
  await waitFor(() =>
    expect(screen.getByRole("button", { name: copy.find })).not.toBeDisabled(),
  );
  fireEvent.click(screen.getByRole("button", { name: copy.find }));
  fireEvent.click(screen.getByRole("button", { name: copy.find }));
  const name = `${formatScheduleInstant(choice.start, "en-CA", scope.timeZone)} – ${formatScheduleInstant(choice.end, "en-CA", scope.timeZone)}`;
  return screen.findByRole("button", { name });
}
it("requires explicit search, selection and confirmation; stages a minimal exact envelope before send", async () => {
  const store = setup();
  render(<ScheduleReviewSheet {...props} />);
  const option = await options();
  expect(sendSchedule).not.toHaveBeenCalled();
  fireEvent.click(option);
  expect(screen.getByText(copy.preview)).toBeInTheDocument();
  expect(store.stage).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: copy.confirm }));
  await screen.findByText(copy.unknown);
  const saved = store.stage.mock.calls[0][0];
  expect(JSON.parse(saved.body)).toMatchObject({
    action: "reschedule",
    owner: snapshot.owner,
    start: choice.start,
    end: choice.end,
  });
  expect(sendSchedule).toHaveBeenCalledWith(saved, context.owner!.scope);
  expect(store.stage.mock.invocationCallOrder[0]).toBeLessThan(
    store.send.mock.invocationCallOrder[0],
  );
  expect(store.dismiss).not.toHaveBeenCalled();
});
it("closing during staging prevents a late send even before router unmount", async () => {
  const store = setup();
  let release!: () => void;
  store.stage.mockImplementation(
    () =>
      new Promise<void>((resolve) => {
        release = resolve;
      }),
  );
  render(<ScheduleReviewSheet {...props} />);
  fireEvent.click(await options());
  fireEvent.click(screen.getByRole("button", { name: copy.confirm }));
  await waitFor(() => expect(store.stage).toHaveBeenCalledTimes(1));
  fireEvent.click(screen.getByRole("button", { name: copy.close }));
  await act(async () => {
    release();
  });
  expect(props.onClose).toHaveBeenCalled();
  expect(store.send).not.toHaveBeenCalled();
});
it("can inspect an own past receipt with a missing target, then reloads rather than showing cached schedule success", async () => {
  const store = setup([entry]);
  jest
    .mocked(readScheduleSnapshot)
    .mockRejectedValue(new Error("Deleted target"));
  jest.mocked(inspectSchedule).mockResolvedValue({
    contract: context.contract,
    ownerScope: context.owner!.scope,
    entry,
    state: "committed",
    canRetry: false,
    currentSnapshotToken: null,
    receipt,
  });
  render(<ScheduleReviewSheet {...props} />);
  await screen.findByRole("button", { name: copy.check });
  await waitFor(() =>
    expect(screen.getByRole("button", { name: copy.check })).not.toBeDisabled(),
  );
  expect(store.send).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: copy.check }));
  await screen.findByText(copy.proof);
  await waitFor(() => expect(store.dismiss).toHaveBeenCalledWith(entry.key));
  expect(notifyCalendarChanged).toHaveBeenCalled();
  expect(screen.queryByText(snapshot.events[0].title)).not.toBeInTheDocument();
});
it("repairs an uncertain local dismissal without resurrecting the request from memory", async () => {
  const store = setup([entry]);
  store.dismiss.mockRejectedValueOnce(new Error("Interrupted delete"));
  store.hasUncertainStorage.mockReturnValue(true);
  store.recoverStorage.mockResolvedValue([]);
  render(<ScheduleReviewSheet {...props} />);
  await screen.findByText(snapshot.events[0].title);
  await waitFor(() =>
    expect(
      screen.getByRole("button", { name: copy.forget }),
    ).not.toBeDisabled(),
  );
  fireEvent.click(screen.getByRole("button", { name: copy.forget }));
  fireEvent.click(screen.getByRole("button", { name: copy.forgetConfirm }));
  await screen.findByText(copy.storage);
  fireEvent.click(screen.getByRole("button", { name: copy.repair }));
  await waitFor(() =>
    expect(
      screen.queryByRole("button", { name: copy.check }),
    ).not.toBeInTheDocument(),
  );
  expect(store.stage).not.toHaveBeenCalled();
  expect(store.send).not.toHaveBeenCalled();
});

it("retains unsubmitted buffer settings after a failed fresh read without sending a move", async () => {
  const store = setup();
  render(<ScheduleReviewSheet {...props} />);
  await screen.findByText(snapshot.events[0].title);
  await waitFor(() =>
    expect(screen.getByRole("button", { name: copy.find })).not.toBeDisabled(),
  );
  fireEvent.click(screen.getByRole("button", { name: copy.find }));
  const preparation = screen.getByLabelText(
    `${copy.preparation} · ${copy.minutes}`,
  );
  fireEvent.change(preparation, { target: { value: "25" } });
  jest.mocked(readScheduleSnapshot).mockRejectedValueOnce(new Error("Offline"));
  fireEvent.click(screen.getByRole("button", { name: copy.find }));
  await screen.findByText(copy.error);
  expect(preparation).toHaveValue(25);
  expect(store.stage).not.toHaveBeenCalled();
  expect(store.send).not.toHaveBeenCalled();
});
it("lets a child review alternatives while keeping the consequential confirmation disabled", async () => {
  const store = setup(),
    childSnapshot = {
      ...snapshot,
      role: "child" as const,
      events: snapshot.events.map((event) => ({ ...event, canMove: false })),
    };
  jest
    .mocked(readScheduleContext)
    .mockResolvedValue({ ...context, role: "child", enabled: false });
  jest.mocked(readScheduleSnapshot).mockResolvedValue({
    snapshot: childSnapshot,
    evaluatedAt: now.toISOString(),
  });
  jest
    .mocked(readSchedulePreview)
    .mockImplementation(async (query: ScheduleReviewQuery) => ({
      snapshot: childSnapshot,
      evaluatedAt: now.toISOString(),
      plan: planScheduleReview(childSnapshot, query, now),
    }));
  render(<ScheduleReviewSheet {...props} />);
  fireEvent.click(await options());
  expect(screen.getByRole("button", { name: copy.confirm })).toBeDisabled();
  expect(store.stage).not.toHaveBeenCalled();
});
