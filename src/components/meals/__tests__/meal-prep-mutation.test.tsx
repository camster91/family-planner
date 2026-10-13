/** @jest-environment jsdom */
import { act, renderHook } from "@testing-library/react";
import { useMealPrepMutation } from "../use-meal-prep-mutation";
jest.mock("@/i18n/bulk-cooking", () => ({
  useBulkCookingText: () => (key: string) => key,
}));
jest.mock("@/components/layout/pending-form-navigation", () => ({
  usePendingFormNavigationController: () => ({
    releaseBeforeNavigation: async () => undefined,
  }),
}));
const fetchMock = jest.fn();
const reply = (status: number, body: unknown) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
});
describe("prep receipt recovery", () => {
  beforeEach(() => {
    fetchMock.mockReset();
    global.fetch = fetchMock;
  });
  it("freezes the original body and key after a lost response and confirms a replay once", async () => {
    fetchMock
      .mockRejectedValueOnce(new Error("lost response"))
      .mockResolvedValueOnce(reply(201, { consumptionId: "eaten-1" }));
    const saved = jest.fn();
    const { result } = renderHook(() => useMealPrepMutation(saved));
    const body = { action: "eaten", servings: 2 };
    await act(async () => {
      await result.current.save(body);
    });
    expect(result.current.locked).toBe(true);
    body.servings = 4;
    await act(async () => {
      await result.current.retry();
    });
    expect(fetchMock.mock.calls[1]).toEqual(fetchMock.mock.calls[0]);
    expect(JSON.parse(fetchMock.mock.calls[1][1].body).servings).toBe(2);
    expect(saved).toHaveBeenCalledTimes(1);
    expect(result.current.locked).toBe(false);
  });
  it("keeps the uncertain original key even if a later retry is forbidden", async () => {
    fetchMock
      .mockRejectedValueOnce(new Error("lost"))
      .mockResolvedValueOnce(
        reply(403, { error: { code: "PLANNER_FORBIDDEN" } }),
      )
      .mockResolvedValueOnce(reply(200, { sessionId: "prep-1" }));
    const { result } = renderHook(() => useMealPrepMutation(jest.fn()));
    await act(async () => {
      await result.current.save({ action: "prepared" });
    });
    await act(async () => {
      await result.current.retry();
    });
    expect(result.current.locked).toBe(true);
    await act(async () => {
      await result.current.retry();
    });
    expect(fetchMock.mock.calls[2]).toEqual(fetchMock.mock.calls[0]);
  });
  it("allows correction after a definitive first refusal, but treats malformed success as uncertain", async () => {
    fetchMock
      .mockResolvedValueOnce(reply(409, { error: { code: "BATCH_FULL" } }))
      .mockResolvedValueOnce(reply(200, { unexpected: true }));
    const { result } = renderHook(() => useMealPrepMutation(jest.fn()));
    await act(async () => {
      await result.current.save({ servings: 4 });
    });
    expect(result.current.locked).toBe(false);
    await act(async () => {
      await result.current.save({ servings: 2 });
    });
    expect(fetchMock.mock.calls[0][1].headers["Idempotency-Key"]).not.toEqual(
      fetchMock.mock.calls[1][1].headers["Idempotency-Key"],
    );
    expect(result.current.locked).toBe(true);
  });
});
