/** @jest-environment jsdom */
import { act, renderHook, waitFor } from "@testing-library/react";
import { useMealCreation } from "../use-meal-creation";
jest.mock("@/components/layout/pending-form-navigation", () => ({
  usePendingFormNavigationController: () => ({
    releaseBeforeNavigation: async () => true,
  }),
}));
const response = (status: number, body: unknown) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
});
const originalFetch = global.fetch;
afterEach(() => {
  global.fetch = originalFetch;
});
it("retains exact key/body after uncertainty and a later household refusal", async () => {
  let writes = 0;
  global.fetch = jest.fn(async (_url, init) => {
    if (!init?.method)
      return response(200, {
        userId: "fixture_parent",
        familyId: "fixture_family",
      });
    if (++writes === 1) throw new Error("Fixture lost response");
    return writes === 2
      ? response(403, { error: { code: "AUTH_CONTEXT_CHANGED" } })
      : response(201, { mealId: "fixture_meal" });
  }) as typeof fetch;
  const saved = jest.fn();
  const { result } = renderHook(() => useMealCreation(true, saved));
  await waitFor(() => expect(result.current.ready).toBe(true));
  const draft = {
    date: "2026-10-19",
    meal_type: "dinner" as const,
    recipe_name: "Original",
    servings: 4,
  };
  await act(async () => {
    await result.current.save(draft);
  });
  expect(result.current.unknown).toBe(true);
  draft.recipe_name = "Changed after lost response";
  await act(async () => {
    await result.current.retry();
  });
  expect(result.current.locked).toBe(true);
  await act(async () => {
    await result.current.retry();
  });
  expect(saved).toHaveBeenCalledTimes(1);
  expect(result.current.locked).toBe(false);
  const requests = (global.fetch as jest.Mock).mock.calls
    .filter(([, init]) => init?.method === "POST")
    .map(([, init]) => ({
      body: init.body,
      key: init.headers["Idempotency-Key"],
    }));
  expect(requests[1]).toEqual(requests[0]);
  expect(requests[2]).toEqual(requests[0]);
  expect(JSON.parse(requests[0].body)).toMatchObject({
    recipe_name: "Original",
    expected_user_id: "fixture_parent",
    expected_family_id: "fixture_family",
  });
});
it("cannot create before an authoritative context is loaded", async () => {
  global.fetch = jest.fn(async () =>
    response(403, { error: { code: "FORBIDDEN" } }),
  ) as typeof fetch;
  const { result } = renderHook(() => useMealCreation(true, jest.fn()));
  await waitFor(() => expect(result.current.contextError).toBe(true));
  await act(async () => {
    await result.current.save({ date: "2026-10-19", meal_type: "dinner" });
  });
  expect(
    (global.fetch as jest.Mock).mock.calls.filter(
      ([, init]) => init?.method === "POST",
    ),
  ).toHaveLength(0);
});
