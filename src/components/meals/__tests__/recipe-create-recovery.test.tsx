/** @jest-environment jsdom */
jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), back: jest.fn() }),
}));
jest.mock("@/lib/idempotency-request-json", () => ({
  ...jest.requireActual("@/lib/idempotency-request-json"),
  hashBrowserIdempotentRequest: jest.fn(async () => "a".repeat(64)),
}));
jest.mock("@/lib/review-document-browser", () =>
  require("@/__tests__/helpers/legacy-recipe-review").legacyRecipeReviewMock(),
);
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { RecipeEditor } from "../RecipeEditor";
test("uncertain creation retries exactly its original tagged body and key, with fields locked", async () => {
  const created = jest.fn();
  global.fetch = jest
    .fn()
    .mockRejectedValueOnce(new Error("Fixture lost acknowledgement"))
    .mockResolvedValueOnce({
      ok: true,
      status: 201,
      json: async () => ({
        recipe: {
          id: "fx_recipe",
          title: "Fixture soup",
          servings: 2,
          prep_time: null,
          cook_time: null,
        },
      }),
    });
  render(<RecipeEditor onCreated={created} onCancel={() => {}} />);
  fireEvent.change(await screen.findByLabelText("Recipe name"), {
    target: { value: "Fixture soup" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Save recipe" }));
  await screen.findByRole("button", { name: "Check original save" });
  expect(screen.getByLabelText("Recipe name")).toBeDisabled();
  fireEvent.click(screen.getByText("More recovery options"));
  fireEvent.click(screen.getByRole("button", { name: "Retry original save" }));
  await waitFor(() => expect(created).toHaveBeenCalledTimes(1));
  const first = (global.fetch as jest.Mock).mock.calls[0][1];
  const retry = (global.fetch as jest.Mock).mock.calls[1][1];
  expect(first.body).toBe(retry.body);
  expect(first.headers["Idempotency-Key"]).toBe(
    retry.headers["Idempotency-Key"],
  );
  expect(JSON.parse(first.body).creation_protocol).toBe(
    "herewoven.recipe-create.v1",
  );
});

// Authored UNRUN: a receipt check uses GET only and never selects an unverified DTO.
it.each(['present', 'absent'] as const)('inspects %s without resending an uncertain recipe create', async state => {
  const created = jest.fn();
  global.fetch = jest.fn(async (url, init) => {
    if (init?.method === 'POST') throw new Error('Fixture lost acknowledgement');
    if (String(url) === '/api/recipes/receipt') return { ok: true, status: 200, json: async () =>
      state === 'present' ? { state: 'committed', current: 'present' } : { state: 'absent' } };
    throw new Error('Unexpected fixture request');
  }) as unknown as typeof fetch;
  render(<RecipeEditor onCreated={created} onCancel={jest.fn()} />);
  fireEvent.change(await screen.findByLabelText('Recipe name'), { target: { value: 'Original soup' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save recipe' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Check original save' }));
  await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(state === 'present'
    ? 'Your original save is confirmed.' : 'No matching receipt was found.'));
  const calls = (global.fetch as jest.Mock).mock.calls;
  expect(calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(1);
  const check = calls.find(([url]) => url === '/api/recipes/receipt')[1];
  expect(new Headers(check.headers).get('Idempotency-Key')).toBe(calls[0][1].headers['Idempotency-Key']);
  expect(new Headers(check.headers).get('X-Recipe-Request-Hash')).toBe('a'.repeat(64));
  expect(check.body).toBeUndefined();
  expect(screen.getByLabelText('Recipe name')).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Save recipe' })).toBeDisabled();
  expect(created).not.toHaveBeenCalled();
});
