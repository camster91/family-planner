/** @jest-environment jsdom */
jest.mock("@/lib/review-document-browser", () =>
  require("@/__tests__/helpers/legacy-recipe-review").legacyRecipeReviewMock(),
);
import * as React from "react";
import {
  render,
  screen,
  waitFor,
  fireEvent,
  within,
  act,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom";
import Explore from "@/app/dashboard/meals/explore/page";
jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), back: jest.fn() }),
  useSearchParams: () => new URLSearchParams(window.location.search),
}));
jest.mock("@/components/ui/feature-gate", () => ({
  FeatureGate: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
const preview = {
  title: "Fixture soup",
  description: "A fixture recipe.",
  instructions: "Stir then simmer.",
  ingredientLines: ["½ cup rice", "Salt to taste"],
  source: "https://example.org/soup",
  servings: 4,
  prep_time: 15,
  cook_time: 30,
};
const response = (body: unknown, ok = true, role = "parent") => ({
  headers: new Headers({ "X-Herewoven-Recipe-Owner": JSON.stringify({ protocol: "herewoven.recipe-owner.v1", actorId: role === "child" ? "child-a" : "parent-a", familyId: "family-a", role, generation: 0 }) }),
  ok,
  status: ok ? 200 : 422,
  json: async () => body,
});
function setup(role = "parent") {
  const calls: unknown[] = [];
  global.fetch = jest.fn(async (url, init) => {
    if (String(url) === "/api/auth/me") return response({ user: { role } });
    if (String(url).startsWith("/api/recipes?"))
      return response({
        recipes: [
          { id: "saved-fixture", title: "Fixture pasta", description: null },
        ],
        nextOffset: null,
      }, true, role);
    if (String(url) === "/api/recipes/discover")
      return response({
        results: [{ title: "Fixture online soup", url: preview.source }],
      });
    if (String(url) === "/api/recipes/preview")
      return response({ recipe: preview });
    if (String(url) === "/api/recipes" && init?.method === "POST") {
      const body = JSON.parse(String(init.body));
      calls.push(body);
      return response({ recipe: { id: "new-fixture", title: body.title } });
    }
    if (String(url) === "/api/recipes/collections")
      return response({ collections: [] });
    throw new Error("unexpected fixture request");
  }) as jest.Mock;
  return calls;
}
it("finds source searches, reads a recipe, embeds only sandboxed original, and saves through canonical editor", async () => {
  const calls = setup(),
    user = userEvent.setup();
  render(<Explore />);
  await screen.findByLabelText("Recipe link");
  await user.type(
    screen.getByLabelText("What would you like to cook?"),
    "chicken & rice",
  );
  expect(
    screen.getByRole("link", { name: "Search BBC Good Food ↗" }),
  ).toHaveAttribute(
    "href",
    "https://www.bbcgoodfood.com/search?q=chicken%20%26%20rice",
  );
  await user.type(screen.getByLabelText("Recipe link"), preview.source);
  await user.click(screen.getByRole("button", { name: "Read recipe" }));
  await screen.findByRole("dialog", { name: "Fixture soup" });
  expect(screen.getByText("½ cup rice")).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "View original here" }));
  expect(screen.getByTitle("Original recipe: Fixture soup")).toHaveAttribute(
    "sandbox",
    "allow-scripts",
  );
  expect(screen.getByRole("link", { name: "Open original ↗" })).toHaveAttribute(
    "href",
    preview.source,
  );
  await user.click(screen.getByRole("button", { name: "Recipe reader" }));
  await user.click(screen.getByRole("button", { name: "Review and save" }));
  expect(screen.getByLabelText("Description")).toHaveValue(
    "Source: https://example.org/soup\nA fixture recipe.",
  );
  expect(screen.getByLabelText("Method")).toHaveValue(
    "Ingredients\n½ cup rice\nSalt to taste\n\nStir then simmer.",
  );
  await user.click(screen.getByRole("button", { name: /Save recipe/i }));
  await waitFor(() => expect(calls).toHaveLength(1));
  expect(calls[0]).toMatchObject({
    title: "Fixture soup",
    description: "Source: https://example.org/soup\nA fixture recipe.",
    prep_time: 15,
    cook_time: 30,
  });
  expect((calls[0] as { ingredients?: unknown }).ingredients).toBeUndefined();
  expect(
    await screen.findByRole("link", { name: "Open saved recipe" }),
  ).toHaveAttribute("href", "/dashboard/meals/recipes/new-fixture");
});
it("child reads saved box and source links but cannot import", async () => {
  setup("child");
  render(<Explore />);
  await screen.findByRole("link", { name: "Fixture pasta" });
  expect(screen.queryByLabelText("Recipe link")).toBeNull();
  expect(
    screen.getByRole("link", { name: "Search Allrecipes ↗" }),
  ).toBeInTheDocument();
});
it("source errors keep the original link available and do not save", async () => {
  setup();
  const baseFetch = fetch;
  global.fetch = jest.fn((url, init) =>
    String(url) === "/api/recipes/preview"
      ? Promise.resolve(response({ error: "Fixture site unavailable" }, false))
      : baseFetch(url, init),
  ) as jest.Mock;
  render(<Explore />);
  await screen.findByLabelText("Recipe link");
  fireEvent.change(screen.getByLabelText("Recipe link"), {
    target: { value: preview.source },
  });
  fireEvent.submit(
    screen.getByRole("button", { name: "Read recipe" }).closest("form")!,
  );
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "We couldn’t read that recipe. Check the link and try again.",
  );
  expect(screen.getByRole("alert")).not.toHaveTextContent(
    "Fixture site unavailable",
  );
  expect(screen.getByRole("link", { name: "Open original ↗" })).toHaveAttribute(
    "href",
    preview.source,
  );
  expect(screen.queryByRole("dialog")).toBeNull();
});

it("searches within the app and opens a result directly in the recipe reader", async () => {
  setup();
  const user = userEvent.setup();
  render(<Explore />);
  await screen.findByLabelText("Recipe link");
  await user.type(
    screen.getByLabelText("What would you like to cook?"),
    "soup",
  );
  await user.click(screen.getByRole("button", { name: "Search recipes" }));
  const title = await screen.findByText("Fixture online soup");
  await user.click(
    within(title.closest("li")!).getByRole("button", { name: "Read recipe" }),
  );
  expect(
    await screen.findByRole("dialog", { name: "Fixture soup" }),
  ).toBeInTheDocument();
  expect(fetch).toHaveBeenCalledWith(
    "/api/recipes/discover",
    expect.objectContaining({
      body: JSON.stringify({ query: "soup", source: "BBC Good Food" }),
    }),
  );
});

// Authored UNRUN: ignored abort cannot leave public discovery/import busy forever.
it.each(['preview-body', 'search-headers'] as const)('settles %s stalls without saving household state', async stage => {
  jest.useFakeTimers();
  const calls = setup();
  const baseFetch = fetch;
  global.fetch = jest.fn((url, init) => {
    if (stage === 'preview-body' && String(url) === '/api/recipes/preview')
      return Promise.resolve({ ok: true, status: 200, json: () => new Promise(() => undefined) });
    if (stage === 'search-headers' && String(url) === '/api/recipes/discover')
      return new Promise(() => undefined);
    return baseFetch(url, init);
  }) as jest.Mock;
  const view = render(<Explore />);
  try {
    const link = await screen.findByLabelText('Recipe link');
    if (stage === 'preview-body') {
      fireEvent.change(link, { target: { value: preview.source } });
      fireEvent.submit(screen.getByRole('button', { name: 'Read recipe' }).closest('form')!);
    } else {
      fireEvent.change(screen.getByLabelText('What would you like to cook?'), { target: { value: 'soup' } });
      fireEvent.submit(screen.getByRole('button', { name: 'Search recipes' }).closest('form')!);
    }
    await act(async () => { await jest.advanceTimersByTimeAsync(15_000); });
    expect(screen.getByRole('alert')).toHaveTextContent(stage === 'preview-body'
      ? 'We couldn’t reach that recipe.' : 'We couldn’t reach the recipe search.');
    expect(screen.getByRole('button', { name: stage === 'preview-body' ? 'Read recipe' : 'Search recipes' })).toBeEnabled();
    expect(calls).toHaveLength(0);
    expect(screen.queryByRole('dialog')).toBeNull();
  } finally {
    view.unmount();
    jest.useRealTimers();
  }
});
