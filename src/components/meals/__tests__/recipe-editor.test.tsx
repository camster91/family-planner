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
import { RecipeEditor } from "../RecipeEditor";
import type { RecipeDetailData } from "../RecipeDetail";

const RECIPE: RecipeDetailData = {
  id: "r1",
  title: "Soup",
  description: "  Keep this description  ",
  instructions: "Chop.\n\nSimmer.  ",
  prep_time: null,
  cook_time: null,
  servings: null,
  ingredients: [
    {
      id: "l1",
      amount: 1,
      unit: null,
      note: "  keep  ",
      ingredient: { id: "i1", name: "Red Onion", unit: "pcs" },
    },
  ],
};
function response(status = 201, recipe: unknown = RECIPE) {
  return {
    ok: status < 400,
    status,
    json: async () => ({ recipe }),
  } as Response;
}
function writes() {
  return (global.fetch as jest.Mock).mock.calls.map(([url, init]) => ({
    url,
    method: init.method,
    body: JSON.parse(init.body),
  }));
}
beforeEach(() => {
  global.fetch = jest.fn(async () => response()) as typeof fetch;
});

// Call committed handlers without allowing a disabled-state render between calls.
function handler<T>(element: HTMLElement, name: string): T {
  const key = Object.keys(element).find((key) =>
    key.startsWith("__reactProps$"),
  )!;
  return (element as unknown as Record<string, Record<string, T>>)[key][name];
}

it.each([
  "create Save/Save",
  "create Save/Enter",
  "create Enter/Save",
  "edit Save/Save",
])(
  "allows only one request for retained %s handlers in the same batch",
  async (ordering) => {
    const editing = ordering.startsWith("edit");
    const completed = jest.fn();
    const savingChanged = jest.fn();
    let resolve!: (res: Response) => void;
    global.fetch = jest.fn(
      () =>
        new Promise<Response>((done) => {
          resolve = done;
        }),
    ) as typeof fetch;
    render(
      <RecipeEditor
        initialRecipe={editing ? RECIPE : undefined}
        onCreated={completed}
        onSaved={completed}
        onCancel={jest.fn()}
        onSavingChange={savingChanged}
      />,
    );
    const title = screen.getByLabelText("Recipe name");
    fireEvent.change(title, { target: { value: "New soup" } });
    const save = handler<() => void>(
      screen.getByRole("button", { name: "Save recipe" }),
      "onClick",
    );
    const keyDown = handler<
      (event: { key: string; preventDefault: () => void }) => void
    >(title, "onKeyDown");
    const enter = () => keyDown({ key: "Enter", preventDefault: jest.fn() });
    await act(async () => {
      (ordering.includes("Enter/Save") ? enter : save)();
      (ordering.includes("Save/Enter") ? enter : save)();
    });
    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(writes()[0]).toMatchObject({
      method: editing ? "PATCH" : "POST",
      body: { title: "New soup" },
    });
    expect(completed).not.toHaveBeenCalled();
    await act(async () => {
      resolve(response(editing ? 200 : 201, { ...RECIPE, title: "New soup" }));
    });
    expect(completed).toHaveBeenCalledTimes(1);
    expect(savingChanged.mock.calls).toEqual([[true], [false]]);
  },
);

it.each([
  ["create", "success"],
  ["edit", "success"],
  ["create", "refusal"],
  ["edit", "refusal"],
  ["create", "network"],
  ["edit", "network"],
] as const)(
  "blocks retained Cancel while %s is pending and releases after %s",
  async (mode, outcome) => {
    const cancelled = jest.fn();
    const completed = jest.fn();
    const savingChanged = jest.fn();
    let resolve!: (res: Response) => void;
    let reject!: (error: Error) => void;
    global.fetch = jest.fn(
      () =>
        new Promise<Response>((done, fail) => {
          resolve = done;
          reject = fail;
        }),
    ) as typeof fetch;
    function Owner() {
      const [open, setOpen] = React.useState(true);
      return open ? (
        <RecipeEditor
          initialRecipe={mode === "edit" ? RECIPE : undefined}
          onCreated={completed}
          onSaved={completed}
          onSavingChange={savingChanged}
          onCancel={() => {
            cancelled();
            setOpen(false);
          }}
        />
      ) : null;
    }
    render(<Owner />);
    fireEvent.change(screen.getByLabelText("Recipe name"), {
      target: { value: "New soup" },
    });
    const save = handler<() => void>(
      screen.getByRole("button", { name: "Save recipe" }),
      "onClick",
    );
    const cancel = handler<() => void>(
      screen.getByRole("button", { name: "Cancel" }),
      "onClick",
    );
    await act(async () => {
      save();
      cancel();
    });
    expect(cancelled).not.toHaveBeenCalled();
    expect(screen.queryByTestId("recipe-quick-create")).not.toBeNull();
    await act(async () => {
      if (outcome === "network") reject(new Error("offline"));
      else if (outcome === "refusal")
        resolve({
          ok: false,
          status: 403,
          json: async () => ({
            error: "Ask a parent or teen to add a recipe.",
          }),
        } as Response);
      else resolve(response(200, { ...RECIPE, title: "New soup" }));
    });
    expect(savingChanged.mock.calls).toEqual([[true], [false]]);
    if (outcome === "refusal")
      expect(screen.getByRole("alert").textContent).toBe(
        "Ask a parent or teen to add a recipe.",
      );
    if (outcome === "network") {
      expect(screen.getByRole("alert").textContent).toContain(
        "may have been saved",
      );
      await act(async () => {
        save();
      });
      expect(global.fetch).toHaveBeenCalledTimes(1);
    }
    await act(async () => {
      cancel();
    });
    expect(cancelled).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId("recipe-quick-create")).toBeNull();
  },
);

it("explains that saved display order is by name, not authored line order", () => {
  render(
    <RecipeEditor
      initialRecipe={RECIPE}
      onSaved={jest.fn()}
      onCancel={jest.fn()}
    />,
  );
  expect(
    screen.getByText(
      "Saved ingredients are displayed by name. Line entry order is not saved.",
    ),
  ).toBeTruthy();
});

it.each(["", "0", "101", "1.5"])(
  "rejects invalid base servings %j without a request",
  async (value) => {
    const user = userEvent.setup();
    render(<RecipeEditor onCreated={jest.fn()} onCancel={jest.fn()} />);
    await user.type(screen.getByLabelText("Recipe name"), "Soup");
    await user.clear(screen.getByLabelText("Base servings"));
    if (value) await user.type(screen.getByLabelText("Base servings"), value);
    await user.click(screen.getByRole("button", { name: "Save recipe" }));
    expect(global.fetch).not.toHaveBeenCalled();
    expect(screen.getByRole("alert").textContent).toBe(
      "Base servings must be a whole number from 1 to 100.",
    );
  },
);

it.each(["1", "100"])(
  "sends the exact base servings %s without a grocery-limit clamp",
  async (value) => {
    const user = userEvent.setup();
    render(<RecipeEditor onCreated={jest.fn()} onCancel={jest.fn()} />);
    await user.type(screen.getByLabelText("Recipe name"), "Soup");
    await user.clear(screen.getByLabelText("Base servings"));
    await user.type(screen.getByLabelText("Base servings"), value);
    await user.click(screen.getByRole("button", { name: "Save recipe" }));
    expect(writes()[0].body.servings).toBe(Number(value));
  },
);

it("rejects ingredient amounts above the canonical limit rather than sending them", async () => {
  const user = userEvent.setup();
  render(<RecipeEditor onCreated={jest.fn()} onCancel={jest.fn()} />);
  await user.type(screen.getByLabelText("Recipe name"), "Soup");
  await user.type(screen.getByLabelText("Ingredient"), "Salt");
  await user.clear(screen.getByLabelText("Amount"));
  await user.type(screen.getByLabelText("Amount"), "100001");
  await user.click(screen.getByRole("button", { name: "Save recipe" }));
  expect(global.fetch).not.toHaveBeenCalled();
  expect(screen.getByRole("alert").textContent).toContain("100000");
});

it.each(["network", "server", "missing recipe", "unreadable response"])(
  "does not resend a potentially completed create after %s failure",
  async (failure) => {
    const user = userEvent.setup();
    const created = jest.fn();
    const cancelled = jest.fn();
    global.fetch = jest.fn(async () => {
      if (failure === "network") throw new Error("offline");
      if (failure === "server") return response(500);
      if (failure === "missing recipe") return response(201, null);
      return {
        ok: true,
        status: 201,
        json: async () => {
          throw new Error("truncated");
        },
      } as unknown as Response;
    }) as typeof fetch;
    render(<RecipeEditor onCreated={created} onCancel={cancelled} />);
    await user.type(screen.getByLabelText("Recipe name"), "Soup");
    await user.click(screen.getByRole("button", { name: "Save recipe" }));
    await screen.findByRole("alert");
    expect(screen.getByRole("alert").textContent).toContain(
      "may have been saved",
    );
    expect(screen.getByRole("alert").textContent).not.toContain("try again");
    expect(
      (screen.getByRole("button", { name: "Save recipe" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    await user.type(screen.getByLabelText("Recipe name"), "{Enter}");
    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(created).not.toHaveBeenCalled();
    expect(
      (screen.getByLabelText("Recipe name") as HTMLInputElement).value,
    ).toBe("Soup");
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(cancelled).toHaveBeenCalledTimes(1);
  },
);

it("keeps a rejected create draft editable with the server refusal", async () => {
  const user = userEvent.setup();
  global.fetch = jest.fn(
    async () =>
      ({
        ok: false,
        status: 403,
        json: async () => ({ error: "Ask a parent or teen to add a recipe." }),
      }) as Response,
  ) as typeof fetch;
  render(<RecipeEditor onCreated={jest.fn()} onCancel={jest.fn()} />);
  await user.type(screen.getByLabelText("Recipe name"), "Soup");
  await user.click(screen.getByRole("button", { name: "Save recipe" }));
  expect(screen.getByRole("alert").textContent).toBe(
    "Ask a parent or teen to add a recipe.",
  );
  expect(
    (screen.getByRole("button", { name: "Save recipe" }) as HTMLButtonElement)
      .disabled,
  ).toBe(false);
});

it("does not silently remove an existing ingredient by blanking its name", async () => {
  const user = userEvent.setup();
  render(
    <RecipeEditor
      initialRecipe={RECIPE}
      onSaved={jest.fn()}
      onCancel={jest.fn()}
    />,
  );
  await user.clear(screen.getByLabelText("Ingredient"));
  await user.click(screen.getByRole("button", { name: "Save recipe" }));
  expect(global.fetch).not.toHaveBeenCalled();
  expect(screen.getByRole("alert").textContent).toContain("name");
});

it("clears description, method and times explicitly while preserving unchanged notes", async () => {
  const user = userEvent.setup();
  render(
    <RecipeEditor
      initialRecipe={{ ...RECIPE, prep_time: 5, cook_time: 20, servings: 75 }}
      onSaved={jest.fn()}
      onCancel={jest.fn()}
    />,
  );
  for (const label of ["Description", "Method", "Prep (min)", "Cook (min)"])
    await user.clear(screen.getByLabelText(label));
  await user.click(screen.getByRole("button", { name: "Save recipe" }));
  expect(writes()[0].body).toEqual({
    description: null,
    instructions: null,
    prep_time: null,
    cook_time: null,
  });
});

it("keeps an edit draft open when the successful response omits canonical recipe detail", async () => {
  const user = userEvent.setup();
  const onSaved = jest.fn();
  global.fetch = jest.fn(async () =>
    response(200, { id: "r1", title: "New soup" }),
  ) as typeof fetch;
  render(
    <RecipeEditor
      initialRecipe={RECIPE}
      onSaved={onSaved}
      onCancel={jest.fn()}
    />,
  );
  await user.type(screen.getByLabelText("Recipe name"), " new");
  await user.click(screen.getByRole("button", { name: "Save recipe" }));
  expect(onSaved).not.toHaveBeenCalled();
  expect(screen.getByRole("alert").textContent).toContain(
    "may have been saved",
  );
  expect((screen.getByLabelText("Method") as HTMLTextAreaElement).value).toBe(
    RECIPE.instructions,
  );
});

it("does not write when Save is pressed without changes", async () => {
  const onSaved = jest.fn();
  const user = userEvent.setup();
  render(
    <RecipeEditor
      initialRecipe={RECIPE}
      onSaved={onSaved}
      onCancel={jest.fn()}
    />,
  );
  await user.click(screen.getByRole("button", { name: "Save recipe" }));
  expect(global.fetch).not.toHaveBeenCalled();
  expect(onSaved).toHaveBeenCalledWith(RECIPE);
});

it("rejects an emptied amount rather than inventing a replacement quantity", async () => {
  const user = userEvent.setup();
  render(
    <RecipeEditor
      initialRecipe={RECIPE}
      onSaved={jest.fn()}
      onCancel={jest.fn()}
    />,
  );
  await user.clear(screen.getByLabelText("Amount"));
  await user.click(screen.getByRole("button", { name: "Save recipe" }));
  expect(global.fetch).not.toHaveBeenCalled();
  expect(screen.getByRole("alert").textContent).toContain("Amount");
});

it("rejects ingredient sets above the existing 100-line limit", async () => {
  const user = userEvent.setup();
  render(
    <RecipeEditor
      initialRecipe={{
        ...RECIPE,
        ingredients: Array.from({ length: 101 }, (_, index) => ({
          ...RECIPE.ingredients[0],
          id: `l${index}`,
          ingredient: {
            ...RECIPE.ingredients[0].ingredient,
            id: `i${index}`,
            name: `ingredient${index}`,
          },
        })),
      }}
      onSaved={jest.fn()}
      onCancel={jest.fn()}
    />,
  );
  await user.click(screen.getByRole("button", { name: "Save recipe" }));
  expect(global.fetch).not.toHaveBeenCalled();
  expect(screen.getByRole("alert").textContent).toContain("100 ingredients");
});

it("does not alter untouched legacy text, optional base servings or ingredient notes on a title edit", async () => {
  const user = userEvent.setup();
  render(
    <RecipeEditor
      initialRecipe={RECIPE}
      onSaved={jest.fn()}
      onCancel={jest.fn()}
    />,
  );
  await user.type(screen.getByLabelText("Recipe name"), " new");
  await user.click(screen.getByRole("button", { name: "Save recipe" }));
  expect(writes()[0].body).toEqual({ title: "Soup new" });
});

it("keeps an existing ingredient ID for a normalized equivalent name", async () => {
  const user = userEvent.setup();
  render(
    <RecipeEditor
      initialRecipe={{
        ...RECIPE,
        description: null,
        instructions: null,
        servings: 2,
        ingredients: [{ ...RECIPE.ingredients[0], note: null }],
      }}
      onSaved={jest.fn()}
      onCancel={jest.fn()}
    />,
  );
  await user.clear(screen.getByLabelText("Ingredient"));
  await user.type(screen.getByLabelText("Ingredient"), " red   ONION ");
  await user.clear(screen.getByLabelText("Amount"));
  await user.type(screen.getByLabelText("Amount"), "2");
  await user.click(screen.getByRole("button", { name: "Save recipe" }));
  expect(writes()[0].body.ingredients).toEqual([
    { ingredient_id: "i1", amount: 2, unit: null, note: null },
  ]);
});
