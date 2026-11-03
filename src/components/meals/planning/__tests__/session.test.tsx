/** @jest-environment jsdom */
/** Controller races and launch behavior with isolated storage/network fixtures. */
jest.mock("@/lib/food-planning/browser", () => ({
  browserFoodRecovery: jest.fn(),
}));
jest.mock("@/lib/food-planning/client", () => ({
  ...jest.requireActual("@/lib/food-planning/client"),
  readFoodRecoveryContext: jest.fn(),
  readFoodPreview: jest.fn(),
  readFoodWriteReview: jest.fn(),
  sendFoodIntent: jest.fn(),
}));
import { act, renderHook } from "@testing-library/react";
import { useFoodPlanningSession } from "../useFoodPlanningSession";
import { browserFoodRecovery } from "@/lib/food-planning/browser";
import {
  readFoodRecoveryContext,
  readFoodPreview,
  readFoodWriteReview,
  sendFoodIntent,
} from "@/lib/food-planning/client";
import { foodDraftEntry, newFoodDraft } from "@/lib/food-planning/editor";
import {
  context,
  now,
  receipt,
  makeEntry,
} from "@/lib/food-planning/__tests__/recovery-fixture";
import {
  makePreview,
  makeReview,
} from "@/lib/food-planning/__tests__/view-fixture";
import type { FoodJournalEntry } from "@/lib/food-planning/recovery-contract";
function fixture(empty = false) {
  const draft = newFoodDraft("2026-10-22", "UTC");
  draft.slots[0].key = "dinner";
  draft.slots[0].recipeId = "recipe-a";
  let rows: FoodJournalEntry[] = [
    foodDraftEntry.parse({
      kind: "local-food-draft",
      key: "food_request_123456789",
      body: JSON.stringify({
        userId: context().userId,
        familyId: context().familyId,
        draft,
      }),
    }),
  ];
  if (empty) rows = [];
  const journal = {
    stage: jest.fn(async (entry: FoodJournalEntry) => {
      rows.push(entry);
    }),
    initialize: jest.fn(async () =>
      rows.map((row) => ({ ...row, reviewRequired: true })),
    ),
    snapshot: jest.fn(async () =>
      rows.map((row) => ({ ...row, reviewRequired: true })),
    ),
    hasUncertainStorage: jest.fn(() => false),
    replaceLocalDraft: jest.fn(async (entry: FoodJournalEntry) => {
      rows = [entry];
    }),
    promoteLocalDraft: jest.fn(async (entry: FoodJournalEntry) => {
      rows = [entry];
    }),
    send: jest.fn(
      async (
        _key: string,
        _review: boolean,
        send: (entry: FoodJournalEntry, scope: string) => Promise<unknown>,
      ) => send(rows[0], context().owner!.scope),
    ),
    inspect: jest.fn(async () => {
      throw new Error("inspection network unavailable");
    }),
  };
  jest.mocked(browserFoodRecovery).mockReturnValue(journal as never);
  jest.mocked(readFoodRecoveryContext).mockResolvedValue(context());
  jest.mocked(readFoodPreview).mockResolvedValue(makePreview() as never);
  jest
    .mocked(readFoodWriteReview)
    .mockImplementation(async (input) => ({ ...makeReview(), input }) as never);
  return { journal, draft };
}
beforeEach(() => {
  jest.useFakeTimers();
  jest.setSystemTime(now);
});
afterEach(() => {
  jest.useRealTimers();
  jest.clearAllMocks();
});
it("invalidates a reviewed command synchronously when an editable field changes", async () => {
  const { journal } = fixture(),
    { result } = renderHook(() => useFoodPlanningSession(jest.fn()));
  await act(async () => {
    await result.current.load();
    await result.current.previewDraft();
  });
  await act(async () => {
    await result.current.reviewDraft();
  });
  const oldConfirm = result.current.confirm;
  act(() =>
    result.current.change({
      ...result.current.draft!,
      slots: result.current.draft!.slots.map((slot) => ({
        ...slot,
        notes: "Changed after review",
      })),
    }),
  );
  await act(async () => {
    await oldConfirm();
  });
  expect(journal.promoteLocalDraft).not.toHaveBeenCalled();
});
it("keeps a matching successful save known without depending on a second receipt read", async () => {
  const { journal } = fixture(),
    saved = jest.fn(),
    { result } = renderHook(() => useFoodPlanningSession(saved));
  jest
    .mocked(sendFoodIntent)
    .mockResolvedValue({ kind: "confirmed", receipt: receipt() });
  await act(async () => {
    await result.current.load();
    await result.current.previewDraft();
  });
  await act(async () => {
    await result.current.reviewDraft();
  });
  await act(async () => {
    await result.current.confirm();
  });
  expect(journal.promoteLocalDraft).toHaveBeenCalledTimes(1);
  expect(result.current.confirmed["food_request_123456789"]).toEqual(receipt());
  expect(journal.inspect).not.toHaveBeenCalled();
  expect(saved).toHaveBeenCalledTimes(1);
});

it("opens a fresh planner at the requested day without an extra Start action", async () => {
  const { journal } = fixture(true);
  const { result } = renderHook(() => useFoodPlanningSession(jest.fn()));
  await act(async () => {
    await result.current.load({ day: "2026-10-24", mode: "prep" });
  });
  expect(result.current.draft?.mode).toBe("prep");
  expect(result.current.draft?.slots[0].date).toBe("2026-10-24");
  expect(journal.stage).toHaveBeenCalledTimes(1);
  expect(readFoodPreview).not.toHaveBeenCalled();
  expect(sendFoodIntent).not.toHaveBeenCalled();
});
it("keeps a saved draft instead of replacing it with the launch context", async () => {
  const { journal, draft } = fixture();
  const { result } = renderHook(() => useFoodPlanningSession(jest.fn()));
  await act(async () => {
    await result.current.load({ day: "2026-10-24", mode: "prep" });
  });
  expect(result.current.draft).toEqual(draft);
  expect(journal.stage).not.toHaveBeenCalled();
});
it("does not create a draft for a recovery-only or paused entry", async () => {
  const { journal } = fixture(true);
  const { result } = renderHook(() => useFoodPlanningSession(jest.fn()));
  await act(async () => {
    await result.current.load();
  });
  expect(journal.stage).not.toHaveBeenCalled();
  jest
    .mocked(readFoodRecoveryContext)
    .mockResolvedValue({ ...context(), enabled: false });
  await act(async () => {
    await result.current.load({ day: "2026-10-24", mode: "meals" });
  });
  expect(journal.stage).not.toHaveBeenCalled();
  expect(result.current.draft).toBeNull();
});

it("keeps an unresolved save visible instead of starting another plan", async () => {
  const { journal } = fixture(true);
  const pending = { ...makeEntry(), reviewRequired: true };
  journal.initialize.mockResolvedValue([pending]);
  journal.snapshot.mockResolvedValue([pending]);
  const { result } = renderHook(() => useFoodPlanningSession(jest.fn()));
  await act(async () => {
    await result.current.load({ day: "2026-10-24", mode: "prep" });
  });
  expect(result.current.draft).toBeNull();
  expect(journal.stage).not.toHaveBeenCalled();
  expect(sendFoodIntent).not.toHaveBeenCalled();
});
