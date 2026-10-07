/** @jest-environment jsdom */
import * as React from "react";
import {
  act,
  fireEvent,
  render,
  screen,
  within,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import RecipePage from "@/app/dashboard/meals/recipes/[id]/page";
import type { RecipeDetailData } from "../RecipeDetail";

let mockRouteId = "r1";
beforeEach(() => {
  mockRouteId = "r1";
});
jest.mock("next/navigation", () => ({
  useParams: () => ({ id: mockRouteId }),
}));
jest.mock("next/link", () => ({
  __esModule: true,
  default: ({
    children,
    ...props
  }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => (
    <a {...props}>{children}</a>
  ),
}));
jest.mock("@/components/ui/feature-gate", () => ({
  FeatureGate: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
jest.mock("../AddToGroceriesButton", () => ({
  AddToGroceriesButton: () => <button> Add to groceries </button>,
}));

const RECIPE: RecipeDetailData = {
  id: "r1",
  title: "Soup",
  description: "Old description",
  instructions: "Chop.\nSimmer.",
  prep_time: 5,
  cook_time: 20,
  servings: 75,
  ingredients: [
    {
      id: "line2",
      amount: 0.5,
      unit: "tsp",
      note: null,
      ingredient: { id: "i2", name: "Salt", unit: null },
    },
    {
      id: "line1",
      amount: 2,
      unit: null,
      note: "ripe",
      ingredient: { id: "i1", name: "Tomatoes", unit: "pcs" },
    },
  ],
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
const response = (recipe: RecipeDetailData) =>
  ({ ok: true, status: 200, json: async () => ({ recipe }) }) as Response;

it("ignores a delayed load from the previous route", async () => {
  const pending = deferred<Response>();
  const other = { ...RECIPE, id: "r2", title: "Other recipe" };
  global.fetch = jest.fn((url) =>
    String(url) === "/api/auth/me"
      ? Promise.resolve({
          ok: true,
          json: async () => ({ user: { role: "parent" } }),
        } as Response)
      : String(url).endsWith("r1")
        ? pending.promise
        : Promise.resolve(response(other)),
  ) as typeof fetch;
  const view = render(<RecipePage />);
  mockRouteId = "r2";
  view.rerender(<RecipePage />);
  await screen.findByRole("heading", { name: other.title, level: 1 });
  await act(async () => {
    pending.resolve(response(RECIPE));
  });
  expect(
    screen.getByRole("heading", { name: other.title, level: 1 }),
  ).toBeTruthy();
  expect(
    screen.queryByRole("heading", { name: RECIPE.title, level: 1 }),
  ).toBeNull();
});

it.each(["r2", "r1"])(
  "ignores a delayed save after navigation finishes at %s",
  async (destination) => {
    const user = userEvent.setup();
    const pending = deferred<Response>();
    const other = { ...RECIPE, id: "r2", title: "Other recipe" };
    let currentRecipe = RECIPE;
    global.fetch = jest.fn((url, init) =>
      init?.method
        ? pending.promise
        : String(url) === "/api/auth/me"
          ? Promise.resolve({
              ok: true,
              json: async () => ({ user: { role: "parent" } }),
            } as Response)
          : Promise.resolve(response(currentRecipe)),
    ) as typeof fetch;
    const view = render(<RecipePage />);
    await user.click(
      await screen.findByRole("button", { name: "Edit recipe" }),
    );
    await user.type(screen.getByLabelText("Recipe name"), " saved");
    await user.click(screen.getByRole("button", { name: "Save recipe" }));
    currentRecipe = other;
    mockRouteId = "r2";
    view.rerender(<RecipePage />);
    await screen.findByRole("heading", { name: other.title, level: 1 });
    if (destination === "r1") {
      currentRecipe = { ...RECIPE, title: "Fresh soup" };
      mockRouteId = "r1";
      view.rerender(<RecipePage />);
      await screen.findByRole("heading", {
        name: currentRecipe.title,
        level: 1,
      });
    }
    await user.click(screen.getByRole("button", { name: "Edit recipe" }));
    expect(
      (screen.getByLabelText("Recipe name") as HTMLInputElement).value,
    ).toBe(currentRecipe.title);
    await act(async () => {
      pending.resolve(response({ ...RECIPE, title: "Soup saved" }));
    });
    expect(
      screen.getByRole("heading", { name: currentRecipe.title, level: 1 }),
    ).toBeTruthy();
    expect(
      (screen.getByLabelText("Recipe name") as HTMLInputElement).value,
    ).toBe(currentRecipe.title);
  },
);

function setup(role = "parent") {
  const writes: Array<{
    url: string;
    method: string;
    body: Record<string, unknown>;
  }> = [];
  global.fetch = jest.fn(async (input, init) => {
    const url = String(input);
    if (init?.method) {
      const body = JSON.parse(String(init.body));
      writes.push({ url, method: init.method, body });
      return {
        ok: true,
        status: 200,
        json: async () => ({
          recipe: { ...RECIPE, ...body, ingredients: RECIPE.ingredients },
        }),
      } as Response;
    }
    return {
      ok: true,
      status: 200,
      json: async () =>
        url === "/api/auth/me" ? { user: { role } } : { recipe: RECIPE },
    } as Response;
  }) as typeof fetch;
  render(<RecipePage />);
  return writes;
}

// Retain real committed handlers so React cannot render the pending UI between actions.
function clickHandler(element: HTMLElement): () => void {
  const key = Object.keys(element).find((key) =>
    key.startsWith("__reactProps$"),
  )!;
  return (element as unknown as Record<string, { onClick: () => void }>)[key]
    .onClick;
}

it.each(["Close", "Escape"])(
  "blocks same-tick Save/%s dismissal before the pending render commits",
  async (action) => {
    const user = userEvent.setup();
    setup();
    const trigger = await screen.findByRole("button", { name: "Edit recipe" });
    await user.click(trigger);
    const pending = deferred<Response>();
    global.fetch = jest.fn(() => pending.promise) as typeof fetch;
    const dialog = screen.getByRole("dialog", { name: "Edit recipe" });
    fireEvent.change(within(dialog).getByLabelText("Recipe name"), {
      target: { value: "Soup saved" },
    });
    const save = clickHandler(
      within(dialog).getByRole("button", { name: "Save recipe" }),
    );
    const close = clickHandler(
      within(dialog).getByRole("button", { name: "Close" }),
    );
    await act(async () => {
      save();
      if (action === "Close") close();
      else
        document.dispatchEvent(
          new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
        );
    });
    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(global.fetch).toHaveBeenCalledWith(
      "/api/recipes/r1",
      expect.objectContaining({
        method: "PATCH",
        body: JSON.stringify({ title: "Soup saved" }),
      }),
    );
    expect(screen.getByRole("dialog", { name: "Edit recipe" })).toBe(dialog);
    expect(within(dialog).queryByRole("button", { name: "Close" })).toBeNull();
    expect(
      screen.queryByRole("heading", { name: "Soup saved", level: 1 }),
    ).toBeNull();
    await act(async () => {
      pending.resolve(response({ ...RECIPE, title: "Soup saved" }));
    });
    expect(
      screen.getByRole("heading", { name: "Soup saved", level: 1 }),
    ).toBeTruthy();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(trigger);
  },
);

it.each([
  ["Close", "refusal"],
  ["Escape", "refusal"],
  ["Close", "uncertain"],
  ["Escape", "uncertain"],
] as const)(
  "releases detail %s ownership after %s without losing retry safety",
  async (action, outcome) => {
    const user = userEvent.setup();
    setup();
    const trigger = await screen.findByRole("button", { name: "Edit recipe" });
    await user.click(trigger);
    const first = deferred<Response>();
    const retry = deferred<Response>();
    global.fetch = jest
      .fn()
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(retry.promise);
    const dialog = screen.getByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("Recipe name"), {
      target: { value: "Soup saved" },
    });
    const save = clickHandler(
      within(dialog).getByRole("button", { name: "Save recipe" }),
    );
    const close = clickHandler(
      within(dialog).getByRole("button", { name: "Close" }),
    );
    const dismiss = () =>
      action === "Close"
        ? close()
        : document.dispatchEvent(
            new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
          );
    await act(async () => {
      save();
      dismiss();
    });
    expect(screen.getByRole("dialog")).toBe(dialog);
    await act(async () => {
      first.resolve({
        ok: false,
        status: outcome === "refusal" ? 403 : 500,
        json: async () => ({ error: "Permission refused" }),
      } as Response);
    });
    expect(within(dialog).getByRole("button", { name: "Close" })).toBeTruthy();
    expect(screen.getByRole("alert").textContent).toContain(
      outcome === "refusal" ? "Permission refused" : "may have been saved",
    );
    await act(async () => {
      save();
      dismiss();
    });
    expect(global.fetch).toHaveBeenCalledTimes(outcome === "refusal" ? 2 : 1);
    if (outcome === "refusal") {
      expect(screen.getByRole("dialog")).toBe(dialog);
      await act(async () => {
        retry.resolve(response({ ...RECIPE, title: "Soup saved" }));
      });
      expect(
        screen.getByRole("heading", { name: "Soup saved", level: 1 }),
      ).toBeTruthy();
    }
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(trigger);
    await user.click(trigger);
    await user.click(
      within(screen.getByRole("dialog")).getByRole("button", { name: "Close" }),
    );
    expect(screen.queryByRole("dialog")).toBeNull();
  },
);

it("allows a corrected Save after validation without leaving detail dismissal locked", async () => {
  const user = userEvent.setup();
  const writes = setup();
  const trigger = await screen.findByRole("button", { name: "Edit recipe" });
  await user.click(trigger);
  fireEvent.change(screen.getByLabelText("Base servings"), {
    target: { value: "0" },
  });
  await user.click(screen.getByRole("button", { name: "Save recipe" }));
  expect(writes).toEqual([]);
  expect(screen.getByRole("alert").textContent).toContain("Base servings");
  expect(screen.getByRole("button", { name: "Close" })).toBeTruthy();
  fireEvent.change(screen.getByLabelText("Base servings"), {
    target: { value: "80" },
  });
  await user.click(screen.getByRole("button", { name: "Save recipe" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(writes).toEqual([
    { url: "/api/recipes/r1", method: "PATCH", body: { servings: 80 } },
  ]);
  expect(document.activeElement).toBe(trigger);
});

it("keeps the edit dialog open and disables cancellation while a Save is in flight", async () => {
  const user = userEvent.setup();
  setup();
  await user.click(await screen.findByRole("button", { name: "Edit recipe" }));
  let resolve!: (response: Response) => void;
  global.fetch = jest.fn(
    () =>
      new Promise<Response>((done) => {
        resolve = done;
      }),
  ) as typeof fetch;
  await user.type(
    within(screen.getByRole("dialog")).getByLabelText("Recipe name"),
    " new",
  );
  await user.click(
    within(screen.getByRole("dialog")).getByRole("button", {
      name: "Save recipe",
    }),
  );
  expect(
    within(screen.getByRole("dialog")).queryByRole("button", { name: "Close" }),
  ).toBeNull();
  expect(
    (
      within(screen.getByRole("dialog")).getByRole("button", {
        name: "Cancel",
      }) as HTMLButtonElement
    ).disabled,
  ).toBe(true);
  await user.keyboard("{Escape}");
  expect(screen.getByRole("dialog")).toBeTruthy();
  expect(global.fetch).toHaveBeenCalledTimes(1);
  resolve({
    ok: true,
    status: 200,
    json: async () => ({ recipe: { ...RECIPE, title: "Soup new" } }),
  } as Response);
  await screen.findByRole("heading", { name: "Soup new", level: 1 });
  expect(screen.queryByRole("dialog")).toBeNull();
});

it("replaces changed ingredients only on Save while retaining canonical IDs, optional units and notes in server display order", async () => {
  const user = userEvent.setup();
  const writes = setup();
  await user.click(await screen.findByRole("button", { name: "Edit recipe" }));
  const dialog = screen.getByRole("dialog");
  const first = within(dialog).getByRole("group", { name: "Ingredient 1" });
  expect(
    (within(first).getByLabelText("Ingredient") as HTMLInputElement).value,
  ).toBe("Salt");
  expect(
    (within(first).getByLabelText("Ingredient note") as HTMLInputElement).value,
  ).toBe("");
  expect((within(first).getByLabelText("Unit") as HTMLInputElement).value).toBe(
    "tsp",
  );
  await user.clear(within(first).getByLabelText("Amount"));
  await user.type(within(first).getByLabelText("Amount"), "3{Enter}");
  expect(writes).toEqual([]);
  await user.click(within(dialog).getByRole("button", { name: "Save recipe" }));
  await waitFor(() => expect(writes).toHaveLength(1));
  expect(writes[0]).toEqual({
    url: "/api/recipes/r1",
    method: "PATCH",
    body: {
      ingredients: [
        { ingredient_id: "i2", amount: 3, unit: "tsp", note: null },
        { ingredient_id: "i1", amount: 2, unit: null, note: "ripe" },
      ],
    },
  });
});

it.each(["Cancel", "Close", "Escape"])(
  "%s discards local edits with zero writes and restores focus",
  async (action) => {
    const user = userEvent.setup();
    const writes = setup();
    const trigger = await screen.findByRole("button", { name: "Edit recipe" });
    await user.click(trigger);
    await user.type(
      within(screen.getByRole("dialog")).getByLabelText("Method"),
      "\nNew instruction",
    );
    if (action === "Escape") await user.keyboard("{Escape}");
    else
      await user.click(
        within(screen.getByRole("dialog")).getByRole("button", {
          name: action,
        }),
      );
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(writes).toEqual([]);
    expect(document.activeElement).toBe(trigger);
    await user.click(trigger);
    expect(
      (
        within(screen.getByRole("dialog")).getByLabelText(
          "Method",
        ) as HTMLTextAreaElement
      ).value,
    ).toBe(RECIPE.instructions);
  },
);

it.each(["child", "unknown"])("does not offer editing for %s", async (role) => {
  const writes = setup(role);
  await screen.findByRole("heading", { name: "Soup", level: 1 });
  expect(screen.queryByRole("button", { name: "Edit recipe" })).toBeNull();
  expect(writes).toEqual([]);
});

it.each(["parent", "teen"])(
  "%s explicitly saves recipe metadata without replacing untouched ingredient rows",
  async (role) => {
    const user = userEvent.setup();
    const writes = setup(role);
    await user.click(
      await screen.findByRole("button", { name: "Edit recipe" }),
    );
    const dialog = screen.getByRole("dialog", { name: "Edit recipe" });
    expect(
      (within(dialog).getByLabelText("Base servings") as HTMLInputElement)
        .value,
    ).toBe("75");
    expect(
      (within(dialog).getByLabelText("Method") as HTMLTextAreaElement).value,
    ).toBe("Chop.\nSimmer.");
    await user.clear(within(dialog).getByLabelText("Recipe name"));
    await user.type(
      within(dialog).getByLabelText("Recipe name"),
      "Summer soup",
    );
    expect(writes).toEqual([]);
    await user.click(
      within(dialog).getByRole("button", { name: "Save recipe" }),
    );
    await screen.findByRole("heading", { name: "Summer soup", level: 1 });
    expect(writes).toEqual([
      {
        url: "/api/recipes/r1",
        method: "PATCH",
        body: { title: "Summer soup" },
      },
    ]);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByText("Chop. Simmer.", { exact: false })).toBeTruthy();
  },
);
