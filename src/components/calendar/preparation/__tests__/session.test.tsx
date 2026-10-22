/** @jest-environment jsdom */
jest.mock("@/lib/idempotency", () => ({
  hashIdempotentRequest: () => "f".repeat(64),
}));
/** Authored/unrun. Rendering fakes are not browser/native storage acceptance. */
import { renderHook, act, waitFor } from "@testing-library/react";
import { usePreparationSession } from "../usePreparationSession";
import { browserPreparationRecovery } from "@/lib/event-preparation/browser";
import {
  readPreparationContext,
  readPreparationSelection,
  makePreparationIntent,
  sendPreparation,
} from "@/lib/event-preparation/client";
import { preparationRecoveryFixture } from "@/lib/event-preparation/__tests__/recovery-fixture";
jest.mock("@/lib/event-preparation/browser", () => ({
  browserPreparationRecovery: jest.fn(),
}));
jest.mock("@/lib/event-preparation/client", () => ({
  readPreparationContext: jest.fn(),
  readPreparationSelection: jest.fn(),
  makePreparationIntent: jest.fn(),
  inspectPreparation: jest.fn(),
  sendPreparation: jest.fn(),
}));
function fixture() {
  const f = preparationRecoveryFixture();
  const journal = {
    initialize: jest.fn().mockResolvedValue([]),
    stage: jest.fn().mockResolvedValue(undefined),
    hasUncertainStorage: jest.fn(() => false),
    send: jest.fn(),
    inspect: jest.fn(),
    dismiss: jest.fn(),
    recoverStorage: jest.fn(),
  };
  jest.mocked(browserPreparationRecovery).mockReturnValue(journal as never);
  jest.mocked(readPreparationContext).mockResolvedValue(f.recovery);
  jest.mocked(readPreparationSelection).mockResolvedValue(f.preview);
  return { ...f, journal };
}
beforeEach(() => jest.clearAllMocks());
it("does not stage or send when closed while asynchronous intent hashing is still pending", async () => {
  const f = fixture();
  let resolve!: (entry: typeof f.entry) => void;
  jest.mocked(makePreparationIntent).mockReturnValue(
    new Promise((done) => {
      resolve = done;
    }),
  );
  const { result } = renderHook(() =>
    usePreparationSession({
      eventId: "event-a",
      timeZone: "UTC",
      memberProtocol: 2,
      choreIds: [],
      subjects: [],
      routine: null,
    }),
  );
  await waitFor(() => expect(result.current.busy).toBe(false));
  act(() => result.current.commit(f.preview, f.command));
  act(() => result.current.stop());
  await act(async () => {
    resolve(f.entry);
    await Promise.resolve();
  });
  expect(f.journal.stage).not.toHaveBeenCalled();
  expect(sendPreparation).not.toHaveBeenCalled();
});
it("keeps a durable staged request but does not send if closed during storage", async () => {
  const f = fixture();
  let release!: () => void;
  jest.mocked(makePreparationIntent).mockResolvedValue(f.entry);
  f.journal.stage.mockImplementation(
    () =>
      new Promise<void>((done) => {
        release = done;
      }),
  );
  const { result } = renderHook(() =>
    usePreparationSession({
      eventId: "event-a",
      timeZone: "UTC",
      memberProtocol: 2,
      choreIds: [],
      subjects: [],
      routine: null,
    }),
  );
  await waitFor(() => expect(result.current.busy).toBe(false));
  act(() => result.current.commit(f.preview, f.command));
  await waitFor(() => expect(f.journal.stage).toHaveBeenCalled());
  act(() => result.current.stop());
  await act(async () => {
    release();
    await Promise.resolve();
  });
  expect(f.journal.send).not.toHaveBeenCalled();
  expect(sendPreparation).not.toHaveBeenCalled();
});
