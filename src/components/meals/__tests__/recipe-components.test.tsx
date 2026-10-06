/**
 * @jest-environment jsdom
 */
import * as React from "react";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { RecipePicker, type RecipeOption } from "../RecipePicker";
import { RecipeDetail, type RecipeDetailData } from "../RecipeDetail";

const SOUP: RecipeOption = {
  id: "r_soup",
  title: "Tomato soup",
  prep_time: 10,
  cook_time: 30,
  servings: 4,
};

function mockFetch(
  handler: (
    url: string,
    init?: RequestInit,
  ) => { status: number; body: unknown },
) {
  const calls: Array<{ url: string; method: string; body: unknown }> = [];
  global.fetch = jest.fn(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      calls.push({
        url,
        method: (init?.method ?? "GET").toUpperCase(),
        body: init?.body ? JSON.parse(String(init.body)) : undefined,
      });
      const { status, body } = handler(url, init);
      return {
        ok: status >= 200 && status < 300,
        status,
        json: async () => body,
      } as Response;
    },
  ) as unknown as typeof fetch;
  return calls;
}

function Harness({
  canCreate,
  onSubmit,
}: {
  canCreate?: boolean;
  onSubmit?: () => void;
}) {
  const [value, setValue] = React.useState<RecipeOption | null>(null);
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit?.();
      }}
    >
      <RecipePicker
        value={value?.id ?? null}
        onChange={setValue}
        canCreate={canCreate}
      />
      <output data-testid="selected">{value?.title ?? "none"}</output>
    </form>
  );
}

describe("RecipePicker", () => {
  it("lists household recipes and selects one", async () => {
    const user = userEvent.setup();
    mockFetch(() => ({
      status: 200,
      body: { recipes: [SOUP], nextOffset: null },
    }));
    render(<Harness />);
    expect(screen.getByText("Loading recipes…").getAttribute("role")).toBe(
      "status",
    );
    await screen.findByRole("option", { name: "Tomato soup" });
    await user.selectOptions(
      screen.getByLabelText("Recipe (optional)"),
      "r_soup",
    );
    expect(screen.getByTestId("selected").textContent).toBe("Tomato soup");
  });

  it("follows nextOffset so recipes beyond the first page are pickable", async () => {
    const calls = mockFetch((url) =>
      url.includes("offset=0")
        ? { status: 200, body: { recipes: [SOUP], nextOffset: 200 } }
        : {
            status: 200,
            body: {
              recipes: [{ ...SOUP, id: "r_late", title: "Zucchini bake" }],
              nextOffset: null,
            },
          },
    );
    render(<Harness />);
    await screen.findByRole("option", { name: "Zucchini bake" });
    expect(screen.getByRole("option", { name: "Tomato soup" })).toBeTruthy();
    expect(calls.map((c) => c.url)).toEqual([
      "/api/recipes?limit=200&offset=0",
      "/api/recipes?limit=200&offset=200",
    ]);
  });

  it('shows an empty state and hides "New recipe" when the role cannot create (child, O-7)', async () => {
    mockFetch(() => ({ status: 200, body: { recipes: [], nextOffset: null } }));
    render(<Harness canCreate={false} />);
    expect(await screen.findByText("No recipes yet.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "New recipe" })).toBeNull();
  });

  it("shows a load error with a retry that keeps free text usable", async () => {
    const user = userEvent.setup();
    let fail = true;
    mockFetch(() =>
      fail
        ? { status: 500, body: {} }
        : { status: 200, body: { recipes: [SOUP], nextOffset: null } },
    );
    render(<Harness />);
    expect(await screen.findByText(/Couldn’t load recipes/)).toBeTruthy();
    fail = false;
    await user.click(screen.getByRole("button", { name: "Try again" }));
    await screen.findByRole("option", { name: "Tomato soup" });
  });

  it("creates a recipe inline, selects it, and Enter never submits the meal form", async () => {
    const user = userEvent.setup();
    const onSubmit = jest.fn();
    const calls = mockFetch((url, init) => {
      if (init?.method === "POST") {
        return {
          status: 201,
          body: {
            recipe: {
              id: "r_new",
              title: "Chili",
              prep_time: 15,
              cook_time: 60,
              servings: 2,
              ingredients: [],
            },
          },
        };
      }
      return { status: 200, body: { recipes: [SOUP], nextOffset: null } };
    });
    render(<Harness onSubmit={onSubmit} />);
    await screen.findByRole("option", { name: "Tomato soup" });
    await user.click(screen.getByRole("button", { name: "New recipe" }));
    const panel = screen.getByTestId("recipe-quick-create");
    await user.type(within(panel).getByLabelText("Recipe name"), "Chili");
    await user.clear(within(panel).getByLabelText("Base servings"));
    await user.type(within(panel).getByLabelText("Base servings"), "8");
    await user.type(
      within(panel).getByLabelText("Description"),
      "A family favourite",
    );
    await user.type(within(panel).getByLabelText("Method"), "Simmer.\nServe.");
    await user.type(within(panel).getByLabelText("Prep (min)"), "15");
    await user.type(within(panel).getByLabelText("Cook (min)"), "60");
    await user.clear(within(panel).getByLabelText("Amount"));
    await user.type(within(panel).getByLabelText("Amount"), "2");
    await user.type(within(panel).getByLabelText("Unit"), "cans");
    await user.type(
      within(panel).getByLabelText("Ingredient"),
      "Kidney beans{Enter}",
    );

    await waitFor(() =>
      expect(screen.getByTestId("selected").textContent).toBe("Chili"),
    );
    expect(onSubmit).not.toHaveBeenCalled();
    expect(calls.find((c) => c.method === "POST")).toEqual({
      url: "/api/recipes",
      method: "POST",
      body: {
        title: "Chili",
        servings: 8,
        description: "A family favourite",
        instructions: "Simmer.\nServe.",
        prep_time: 15,
        cook_time: 60,
        ingredients: [{ name: "Kidney beans", amount: 2, unit: "cans" }],
      },
    });
    expect(screen.queryByTestId("recipe-quick-create")).toBeNull();
    expect(screen.getByRole("option", { name: "Chili" })).toBeTruthy();
  });

  it("validates the inline recipe before posting and shows the server message", async () => {
    const user = userEvent.setup();
    const calls = mockFetch((url, init) =>
      init?.method === "POST"
        ? {
            status: 403,
            body: { error: "Ask a parent or teen to add a recipe." },
          }
        : { status: 200, body: { recipes: [], nextOffset: null } },
    );
    render(<Harness />);
    await user.click(await screen.findByRole("button", { name: "New recipe" }));
    await user.click(screen.getByRole("button", { name: "Save recipe" }));
    expect(screen.getByRole("alert").textContent).toBe(
      "Give the recipe a name.",
    );
    expect(calls.some((c) => c.method === "POST")).toBe(false);

    await user.type(screen.getByLabelText("Recipe name"), "Pancakes");
    await user.click(screen.getByRole("button", { name: "Save recipe" }));
    expect((await screen.findByRole("alert")).textContent).toBe(
      "Ask a parent or teen to add a recipe.",
    );
  });
});

describe("RecipeDetail", () => {
  const recipe: RecipeDetailData = {
    id: "r1",
    title:
      "Veggie lasagna with a deliberately long title that must wrap rather than be cut off",
    description: "Family favourite",
    instructions: "Layer.\nBake.",
    prep_time: 25,
    cook_time: 45,
    servings: 6,
    ingredients: [
      {
        id: "l1",
        amount: 1,
        unit: "box",
        note: null,
        ingredient: { id: "i1", name: "Lasagna sheets", unit: "box" },
      },
      {
        id: "l2",
        amount: 6,
        unit: null,
        note: "ripe",
        ingredient: { id: "i2", name: "Tomatoes", unit: "pcs" },
      },
    ],
  };

  it("shows times, servings, ingredients with amounts, and the method", () => {
    render(<RecipeDetail recipe={recipe} />);
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(
      recipe.title,
    );
    const facts = screen
      .getAllByRole("term")
      .map((t) => `${t.textContent} ${t.nextElementSibling?.textContent}`);
    expect(facts).toEqual(["Prep 25 min", "Cook 45 min", "Serves 6"]);
    const items = within(screen.getByTestId("recipe-ingredients"))
      .getAllByRole("listitem")
      .map((li) => li.textContent);
    expect(items).toEqual(["Lasagna sheets1 box", "Tomatoes, ripe6"]);
    expect(screen.getByRole("heading", { name: "Method" })).toBeTruthy();
  });

  it("has an explicit empty ingredients state and omits unknown times", () => {
    render(
      <RecipeDetail
        recipe={{
          ...recipe,
          ingredients: [],
          prep_time: null,
          cook_time: null,
          instructions: null,
        }}
      />,
    );
    expect(
      screen.getByText("No ingredients listed for this recipe."),
    ).toBeTruthy();
    expect(screen.getAllByRole("term").map((t) => t.textContent)).toEqual([
      "Serves",
    ]);
    expect(screen.queryByRole("heading", { name: "Method" })).toBeNull();
  });
});
