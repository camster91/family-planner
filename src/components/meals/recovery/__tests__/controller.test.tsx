/** Authored/unrun. Injected owned stores; physical lifecycle acceptance is later. */
import { act, renderHook, waitFor } from "@testing-library/react";
import * as React from "react";
jest.mock("@/lib/meal-prep-recovery/browser", () => ({
  browserPrepRecovery: jest.fn(),
}));
jest.mock("@/lib/meal-prep-recovery/client", () => ({
  ...jest.requireActual("@/lib/meal-prep-recovery/client"),
  readPrepContext: jest.fn(),
  inspectPrepIntent: jest.fn(),
  sendPrepIntent: jest.fn(),
}));
import { browserPrepRecovery } from "@/lib/meal-prep-recovery/browser";
import {
  readPrepContext,
  inspectPrepIntent,
  sendPrepIntent,
} from "@/lib/meal-prep-recovery/client";
import { context, receipt } from "@/lib/meal-prep-recovery/__tests__/fixture";
import { PREP_RECOVERY, prepContext } from "@/lib/meal-prep-recovery/contract";
import {
  prepDraft,
  prepJournal,
  prepJournalEntry,
  prepJournalMatchesContext,
} from "@/lib/meal-prep-recovery/draft-contract";
import { prepDraftInput } from "@/lib/meal-prep-recovery/draft-input";
import { createOwnedRequestJournal } from "@/lib/owned-request-journal";
import type { QueueStore } from "@/lib/offline-queue";
import { useBulkRecovery } from "../useBulkRecovery";
const raw = () => {
  const value = prepDraft.parse({
    kind: "action",
    action: "allocate",
    sessionId: "prep-a",
    batchId: "batch-a",
    requirePrepared: true,
    mealId: "",
    servings: "1",
    meals: [{ date: "2026-10-23", meal_type: "dinner", servings: "2" }],
    nextDay: "",
    expectedNext: null,
  });
  if (value.kind !== "action") throw new Error("Expected action fixture");
  return value;
};
let mockContext = context(),
  text: string | null = null,
  failWrite = false;
let pauseWrite: Promise<void> | null = null;
function durableEntries() {
  return text ? JSON.parse(JSON.parse(text).queue).entries : [];
}
beforeEach(() => {
  jest.clearAllMocks();
  mockContext = context();
  text = null;
  failWrite = false;
  pauseWrite = null;
  const memory: QueueStore = {
    read: async () => text,
    write: async (value) => {
      text = value;
      const gate = pauseWrite;
      if (gate) await gate;
      if (failWrite) throw new Error("Synthetic post-write fault");
    },
    remove: async () => {
      text = null;
    },
  };
  jest.mocked(readPrepContext).mockImplementation(async () => mockContext);
  jest.mocked(inspectPrepIntent).mockImplementation(
    async (entry) =>
      ({
        state: "ready",
        receipt: null,
        retryEligible: true,
        entry,
      }) as never,
  );
  jest.mocked(sendPrepIntent).mockResolvedValue({ kind: "unknown" });
  jest.mocked(browserPrepRecovery).mockImplementation(() =>
    createOwnedRequestJournal({
      runtime: "bulk_controller_fixture_1234",
      context: prepContext,
      entry: prepJournalEntry,
      journal: prepJournal,
      contract: PREP_RECOVERY,
      maxBytes: 768 * 1024,
      localDraftKind: "local-prep-draft",
      matchesContext: prepJournalMatchesContext,
      candidates: () => [memory],
      resolveContext: readPrepContext,
      withLease: async (_owner, run) => run(),
      reviewBeforeEverySend: true,
      reviewRecovered: async (entry, current) =>
        entry.kind === "meal-prep" &&
        (await inspectPrepIntent(entry, current)).retryEligible,
    }),
  );
});
function useController(onChanged = jest.fn()) {
  return useBulkRecovery(
    { userId: mockContext.userId, familyId: mockContext.familyId },
    onChanged,
  );
}
it("retains the original promoted request across reload and never retries on mount", async () => {
  const first = renderHook(() => useController());
  await waitFor(() => expect(first.result.current.mode).toBe("owned"));
  await act(async () => {
    await first.result.current.attach(raw, "form-a");
  });
  expect(durableEntries()[0].kind).toBe("local-prep-draft");
  await act(async () => {
    await first.result.current.save(
      prepDraftInput(raw(), mockContext),
      "/api/meals/bulk/actions",
    );
  });
  const frozen = durableEntries()[0];
  expect(frozen.kind).toBe("meal-prep");
  expect(sendPrepIntent).toHaveBeenCalledTimes(1);
  first.unmount();
  const second = renderHook(() => useController());
  await waitFor(() => expect(second.result.current.rows).toHaveLength(1));
  expect(sendPrepIntent).toHaveBeenCalledTimes(1);
  await act(async () => {
    await second.result.current.retry(frozen.key);
  });
  expect(sendPrepIntent).toHaveBeenLastCalledWith(
    expect.objectContaining({ key: frozen.key, body: frozen.body }),
    expect.anything(),
  );
  expect(durableEntries()[0]).toEqual(frozen);
});
it("does not send after uncertain promotion, and exact repair never dispatches", async () => {
  const view = renderHook(() => useController());
  await waitFor(() => expect(view.result.current.mode).toBe("owned"));
  await act(async () => {
    await view.result.current.attach(raw, "form-a");
  });
  failWrite = true;
  await act(async () => {
    await view.result.current.save(
      prepDraftInput(raw(), mockContext),
      "/api/meals/bulk/actions",
    );
  });
  expect(view.result.current.issue).toBe("storage");
  expect(sendPrepIntent).not.toHaveBeenCalled();
  let canLeave = true;
  await act(async () => {
    canLeave = await view.result.current.prepareLeave();
  });
  expect(canLeave).toBe(false);
  failWrite = false;
  await act(async () => {
    await view.result.current.repair();
  });
  expect(view.result.current.rows[0].kind).toBe("meal-prep");
  expect(sendPrepIntent).not.toHaveBeenCalled();
});
it("preserves an empty adopted journal during pause instead of falling back to legacy saves", async () => {
  const view = renderHook(() => useController());
  await waitFor(() => expect(view.result.current.mode).toBe("owned"));
  await act(async () => {
    await view.result.current.attach(raw, "form-a");
  });
  const key = view.result.current.formKey!;
  await act(async () => {
    expect(await view.result.current.prepareLeave()).toBe(true);
    view.result.current.detach("form-a");
  });
  await act(async () => {
    await view.result.current.dismiss(key);
  });
  mockContext = { ...mockContext, enabled: false };
  await act(async () => {
    await view.result.current.load();
  });
  expect(view.result.current.mode).toBe("owned");
  expect(view.result.current.context?.enabled).toBe(false);
  expect(durableEntries()).toEqual([]);
  expect(sendPrepIntent).not.toHaveBeenCalled();
});
it("preserves matching success even when the canonical refresh callback fails", async () => {
  const changed = jest.fn(() => {
    throw new Error("Synthetic read failure");
  });
  const view = renderHook(() => useController(changed));
  await waitFor(() => expect(view.result.current.mode).toBe("owned"));
  await act(async () => {
    await view.result.current.attach(raw, "form-a");
  });
  const key = view.result.current.formKey!;
  jest
    .mocked(sendPrepIntent)
    .mockResolvedValueOnce({ kind: "confirmed", receipt: receipt() });
  await act(async () => {
    await view.result.current.save(
      prepDraftInput(raw(), mockContext),
      "/api/meals/bulk/actions",
    );
  });
  expect(view.result.current.confirmed[key]).toEqual(receipt());
  expect(durableEntries()[0].key).toBe(key);
  expect(changed).toHaveBeenCalledTimes(1);
});
it("initializes under Strict Mode without leaving the controller busy forever", async () => {
  const view = renderHook(() => useController(), {
    wrapper: ({ children }) => <React.StrictMode>{children}</React.StrictMode>,
  });
  await waitFor(() => expect(view.result.current.mode).toBe("owned"));
  expect(view.result.current.busy).toBe(false);
  expect(sendPrepIntent).not.toHaveBeenCalled();
});

it("hides original work after an owner switch without deleting its storage", async () => {
  const view = renderHook(() => useController());
  await waitFor(() => expect(view.result.current.mode).toBe("owned"));
  await act(async () => {
    await view.result.current.attach(raw, "form-a");
  });
  const original = text;
  mockContext = {
    ...mockContext,
    role: "teen",
    owner: { ...mockContext.owner!, generation: 3, scope: "d".repeat(64) },
  };
  await act(async () => {
    expect(await view.result.current.prepareLeave()).toBe(false);
  });
  expect(view.result.current.privacyHold).toBe(true);
  expect(view.result.current.rows).toEqual([]);
  expect(view.result.current.context).toBeNull();
  expect(text).toBe(original);
});
it("does not overwrite a saved draft when a different form attempts to attach", async () => {
  const view = renderHook(() => useController());
  await waitFor(() => expect(view.result.current.mode).toBe("owned"));
  await act(async () => {
    await view.result.current.attach(raw, "form-a");
  });
  const original = text;
  await act(async () => {
    view.result.current.detach("form-a");
  });
  const changed = { ...raw(), servings: "4" };
  await act(async () => {
    await view.result.current.attach(() => changed, "different-form");
  });
  await act(async () => {
    expect(await view.result.current.prepareLeave()).toBe(true);
  });
  expect(text).toBe(original);
  expect(sendPrepIntent).not.toHaveBeenCalled();
});

it("keeps newer edits dirty and refuses navigation when fields change during storage", async () => {
  const view = renderHook(() => useController());
  await waitFor(() => expect(view.result.current.mode).toBe("owned"));
  let wanted = raw();
  await act(async () => {
    await view.result.current.attach(() => wanted, "form-a");
  });
  let release!: () => void;
  pauseWrite = new Promise<void>((resolve) => {
    release = resolve;
  });
  wanted = { ...wanted, servings: "3" };
  let leaving!: Promise<boolean>;
  act(() => {
    view.result.current.changed("form-a");
    leaving = view.result.current.prepareLeave();
  });
  await waitFor(() =>
    expect(JSON.parse(durableEntries()[0].body).draft.servings).toBe("3"),
  );
  let canLeave = true;
  await act(async () => {
    wanted = { ...wanted, servings: "4" };
    view.result.current.changed("form-a");
    pauseWrite = null;
    release();
    canLeave = await leaving;
  });
  expect(canLeave).toBe(false);
  expect(view.result.current.dirty).toBe(true);
  await act(async () => {
    expect(await view.result.current.prepareLeave()).toBe(true);
  });
  expect(JSON.parse(durableEntries()[0].body).draft.servings).toBe("4");
});

it("opens explicit recovery with no current list context and never submits on discovery", async () => {
  const { entry } = jest.requireActual(
    "@/lib/meal-prep-recovery/__tests__/fixture",
  );
  mockContext = { ...mockContext, enabled: false };
  text = JSON.stringify({
    v: 2,
    envelope: "herewoven.queue-store.v2",
    state: "active",
    owner: mockContext.owner,
    runtime: "explicit_bulk_recovery_fixture",
    queue: JSON.stringify({ contract: PREP_RECOVERY, entries: [entry()] }),
  });
  const view = renderHook(() => useBulkRecovery(null, jest.fn(), true));
  await waitFor(() => expect(view.result.current.rows).toHaveLength(1));
  expect(view.result.current.mode).toBe("owned");
  expect(view.result.current.context?.enabled).toBe(false);
  expect(sendPrepIntent).not.toHaveBeenCalled();
});
