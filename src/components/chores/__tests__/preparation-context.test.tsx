/** Authored/unrun. Personal lifecycle cases; not browser/device acceptance. */
import { act, renderHook, waitFor } from "@testing-library/react";
import { requestOwnedJson } from "@/lib/owned-request-http";
import { useChorePreparationContext } from "../useChorePreparationContext";
jest.mock("@/lib/owned-request-http", () => ({ requestOwnedJson: jest.fn() }));
const identity = { userId: "parent-a", familyId: "family-a" };
const response = (generation = 1, backlinks = { "task-a": "event-a" }) => ({
  kind: "reply" as const,
  response: { ok: true, status: 200 } as Response,
  body: {
    owner: { ...identity, generation },
    state: "available",
    backlinks,
    origins: {},
  },
});
beforeEach(() => {
  jest.resetAllMocks();
  window.history.replaceState(null, "", "/dashboard/chores");
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    value: "visible",
  });
});
it("withholds private context on fridge, device and inactive surfaces", () => {
  for (const path of ["/device/chores", "/dashboard/chores?mode=fridge"]) {
    window.history.replaceState(null, "", path);
    const view = renderHook(() =>
      useChorePreparationContext(identity, ["task-a"]),
    );
    expect(view.result.current).toEqual({
      backlinks: {},
      origins: {},
      ownContext: {},
    });
    view.unmount();
  }
  window.history.replaceState(null, "", "/dashboard/chores");
  const view = renderHook(() =>
    useChorePreparationContext(identity, ["task-a"], false),
  );
  expect(view.result.current).toEqual({
    backlinks: {},
    origins: {},
    ownContext: {},
  });
  expect(requestOwnedJson).not.toHaveBeenCalled();
});
it("clears on blur and refuses a late reply even when transport ignores abort", async () => {
  let release!: (value: ReturnType<typeof response>) => void;
  jest.mocked(requestOwnedJson).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        release = resolve;
      }),
  );
  const view = renderHook(() =>
    useChorePreparationContext(identity, ["task-a"]),
  );
  await waitFor(() => expect(requestOwnedJson).toHaveBeenCalledTimes(1));
  act(() => window.dispatchEvent(new Event("blur")));
  await act(async () => release(response()));
  expect(view.result.current).toEqual({
    backlinks: {},
    origins: {},
    ownContext: {},
  });
  expect(jest.mocked(requestOwnedJson).mock.calls[0][1].signal?.aborted).toBe(
    true,
  );
});
it("loads newly paged history separately and latches retirement after session generation changes", async () => {
  jest.mocked(requestOwnedJson).mockResolvedValueOnce(response());
  const view = renderHook(
    ({ ids }) => useChorePreparationContext(identity, ids),
    { initialProps: { ids: ["task-a"] } },
  );
  await waitFor(() =>
    expect(view.result.current.backlinks).toEqual({ "task-a": "event-a" }),
  );
  jest.mocked(requestOwnedJson).mockResolvedValueOnce(response(2));
  view.rerender({ ids: ["task-a", "older-task"] });
  await waitFor(() => expect(requestOwnedJson).toHaveBeenCalledTimes(2));
  expect(view.result.current).toEqual({
    backlinks: {},
    origins: {},
    ownContext: {},
  });
  act(() => window.dispatchEvent(new Event("focus")));
  expect(requestOwnedJson).toHaveBeenCalledTimes(2);
});

it("keeps own-task titles separate and ignores references outside the requested task window", async () => {
  const reply = response();
  jest.mocked(requestOwnedJson).mockResolvedValueOnce({
    ...reply,
    body: {
      ...reply.body,
      backlinks: {},
      ownContext: {
        "task-a": { eventTitle: "Shared event" },
        "other-task": { eventTitle: "Not requested" },
      },
    },
  });
  const view = renderHook(() =>
    useChorePreparationContext(identity, ["task-a"]),
  );
  await waitFor(() =>
    expect(view.result.current.ownContext).toEqual({
      "task-a": { eventTitle: "Shared event" },
    }),
  );
  expect(view.result.current.backlinks).toEqual({});
  expect(view.result.current.origins).toEqual({});
});
