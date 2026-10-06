/** @jest-environment jsdom */
// Rendered component behavior with mocked HTTP, not API/database runtime evidence.
import "@testing-library/jest-dom";
import * as React from "react";
import userEvent from "@testing-library/user-event";
import { Dialog } from "@/components/ui/dialog";
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { AddToGroceriesButton } from "../AddToGroceriesButton";

const review = {
  recipeId: "recipe-a",
  title: "Tomato soup",
  baseServings: 4,
  targetServings: 8,
  ingredients: [
    { ingredientId: "tomato", name: "Tomato", amount: 400, unit: "g" },
    { ingredientId: "salt", name: "Salt", amount: 1, unit: "tsp" },
  ],
  lists: [{ id: "list-a", name: "Weekly groceries", type: "grocery" }],
  defaultListId: "list-a",
  inventory: { state: "unavailable" },
};
const result = {
  listId: "list-a",
  listName: "Weekly groceries",
  requestId: "request-a",
  createdCount: 1,
  alreadyOnListCount: 0,
  possibleDuplicates: [],
  possibleDuplicatesTruncated: false,
};
let mockFetch: jest.Mock;
beforeEach(() => {
  mockFetch = jest.fn(async (_url: string, init?: RequestInit) => ({
    ok: true,
    status: init?.method === "POST" ? 201 : 200,
    headers: new Headers(),
    json: async () => (init?.method === "POST" ? result : review),
  }));
  global.fetch = mockFetch;
});
const writes = () =>
  mockFetch.mock.calls.filter(([, init]) => init?.method === "POST");

function NestedMeal() {
  const [open, setOpen] = React.useState(false);
  return (
    <>
      <button onClick={() => setOpen(true)}>Open meal</button>
      <Dialog open={open} onClose={() => setOpen(false)} title="Meal details">
        <button>Save meal</button>
        <AddToGroceriesButton recipeId="recipe-a" />
      </Dialog>
    </>
  );
}

it.each(["forward Tab", "backward Tab", "Escape"])(
  "isolates nested review %s and restores both focus layers in StrictMode",
  async (key) => {
    // jsdom has no layout: expose visible elements to the production trap's
    // offsetParent filter, while exercising real Dialog listeners and user keys.
    const visible = jest
      .spyOn(HTMLElement.prototype, "offsetParent", "get")
      .mockImplementation(function (this: HTMLElement) {
        return this.parentElement;
      });
    try {
      const user = userEvent.setup();
      render(
        <React.StrictMode>
          <NestedMeal />
        </React.StrictMode>,
      );
      const opener = screen.getByRole("button", { name: "Open meal" });
      await user.click(opener);
      const outer = screen.getByRole("dialog", { name: "Meal details" });
      const trigger = within(outer).getByRole("button", {
        name: "Add ingredients to groceries",
      });
      await user.click(trigger);
      const inner = await screen.findByRole("dialog", {
        name: "Review grocery ingredients",
      });
      await within(inner).findByRole("button", {
        name: "Add selected ingredients",
      });
      const first = within(inner).getByRole("button", { name: "Close" });
      const last = within(inner).getByRole("button", { name: "Cancel" });
      if (key === "forward Tab") {
        last.focus();
        await user.tab();
        expect(first).toHaveFocus();
      } else if (key === "backward Tab") {
        first.focus();
        await user.tab({ shift: true });
        expect(last).toHaveFocus();
      }
      await user.keyboard("{Escape}");
      expect(
        screen.queryByRole("dialog", { name: "Review grocery ingredients" }),
      ).not.toBeInTheDocument();
      expect(outer).toBeInTheDocument();
      expect(trigger).toHaveFocus();
      // Reopen to check stack cleanup, then prove the outer trap resumes.
      await user.click(trigger);
      await screen.findByRole("dialog", { name: "Review grocery ingredients" });
      await user.keyboard("{Escape}");
      trigger.focus();
      await user.tab();
      expect(
        within(outer).getByRole("button", { name: "Close" }),
      ).toHaveFocus();
      await user.keyboard("{Escape}");
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
      expect(opener).toHaveFocus();
      expect(writes()).toHaveLength(0);
    } finally {
      visible.mockRestore();
    }
  },
);

it.each([
  ["missing inventory", { ...review, inventory: undefined }],
  ["non-renderable title", { ...review, title: { text: "Bad title" } }],
  [
    "non-renderable ingredient name",
    { ...review, ingredients: [{ ...review.ingredients[0], name: {} }] },
  ],
  ["invalid base servings", { ...review, baseServings: 0 }],
  [
    "invalid inventory ids",
    {
      ...review,
      inventory: {
        state: "available",
        haveIngredientIds: ["foreign"],
        truncated: false,
      },
    },
  ],
  ["invalid default destination", { ...review, defaultListId: "foreign" }],
  [
    "invalid amount",
    { ...review, ingredients: [{ ...review.ingredients[0], amount: -1 }] },
  ],
  [
    "oversized ingredients",
    {
      ...review,
      ingredients: Array.from({ length: 101 }, (_, i) => ({
        ...review.ingredients[0],
        ingredientId: `i-${i}`,
      })),
    },
  ],
  [
    "oversized lists",
    {
      ...review,
      lists: Array.from({ length: 101 }, (_, i) => ({
        ...review.lists[0],
        id: `l-${i}`,
      })),
    },
  ],
  ["invalid saved servings", { ...review, targetServings: 101 }],
  ["wrong recipe", { ...review, recipeId: "foreign" }],
])(
  "rejects malformed review: %s without rendering or writing",
  async (_name, data) => {
    mockFetch.mockImplementation(async () => ({
      ok: true,
      json: async () => data,
    }));
    render(<AddToGroceriesButton recipeId="recipe-a" />);
    fireEvent.click(
      screen.getByRole("button", { name: "Add ingredients to groceries" }),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Could not load ingredients",
    );
    expect(
      screen.queryByRole("button", { name: "Add selected ingredients" }),
    ).not.toBeInTheDocument();
    expect(writes()).toHaveLength(0);
  },
);

it.each([0, 1.5, 51, 100, NaN, Infinity])(
  "rejects explicit servings %s before commit without clamping",
  async (servings) => {
    render(<AddToGroceriesButton recipeId="recipe-a" servings={servings} />);
    fireEvent.click(
      screen.getByRole("button", { name: "Add ingredients to groceries" }),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Servings must be a whole number from 1 to 50.",
    );
    expect(
      screen.queryByRole("button", { name: "Add selected ingredients" }),
    ).not.toBeInTheDocument();
    expect(writes()).toHaveLength(0);
  },
);

it("honors the meal disabled prop for review and an already-open commit while preserving Undo", async () => {
  const { rerender } = render(
    <AddToGroceriesButton recipeId="recipe-a" disabled />,
  );
  const trigger = screen.getByRole("button", {
    name: "Add ingredients to groceries",
  });
  expect(trigger).toBeDisabled();
  fireEvent.click(trigger);
  expect(mockFetch).not.toHaveBeenCalled();
  rerender(<AddToGroceriesButton recipeId="recipe-a" />);
  fireEvent.click(trigger);
  const commit = await screen.findByRole("button", {
    name: "Add selected ingredients",
  });
  rerender(<AddToGroceriesButton recipeId="recipe-a" disabled />);
  expect(commit).toBeDisabled();
  fireEvent.click(commit);
  expect(writes()).toHaveLength(0);
  rerender(<AddToGroceriesButton recipeId="recipe-a" />);
  fireEvent.click(commit);
  await screen.findByRole("button", { name: "Undo" });
  rerender(<AddToGroceriesButton recipeId="recipe-a" disabled />);
  expect(trigger).toBeDisabled();
  expect(screen.getByRole("button", { name: "Undo" })).toBeEnabled();
});

it.each([1, 50])(
  "commits valid explicit servings boundary %s unchanged",
  async (servings) => {
    render(<AddToGroceriesButton recipeId="recipe-a" servings={servings} />);
    fireEvent.click(
      screen.getByRole("button", { name: "Add ingredients to groceries" }),
    );
    expect(
      await screen.findByText(`For ${servings} servings`),
    ).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: "Add selected ingredients" }),
    );
    await screen.findByRole("button", { name: "Undo" });
    expect(JSON.parse(writes()[0][1].body).servings).toBe(servings);
  },
);

it.each([1, 100])(
  "preserves saved recipe fallback %s with no explicit override",
  async (targetServings) => {
    mockFetch.mockImplementation(async (_url: string, init?: RequestInit) => ({
      ok: true,
      status: 200,
      headers: new Headers(),
      json: async () =>
        init?.method === "POST"
          ? result
          : { ...review, baseServings: targetServings, targetServings },
    }));
    render(<AddToGroceriesButton recipeId="recipe-a" />);
    fireEvent.click(
      screen.getByRole("button", { name: "Add ingredients to groceries" }),
    );
    expect(
      await screen.findByText(`For ${targetServings} servings`),
    ).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: "Add selected ingredients" }),
    );
    await screen.findByRole("button", { name: "Undo" });
    expect(JSON.parse(writes()[0][1].body)).not.toHaveProperty("servings");
  },
);

it("handles unreadable review JSON as a recoverable review error without writes", async () => {
  mockFetch.mockImplementation(async () => ({
    ok: true,
    json: async () => {
      throw new SyntaxError("Invalid JSON");
    },
  }));
  render(<AddToGroceriesButton recipeId="recipe-a" />);
  fireEvent.click(
    screen.getByRole("button", { name: "Add ingredients to groceries" }),
  );
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Could not load ingredients",
  );
  expect(writes()).toHaveLength(0);
});

it("tells the user when destination choices are capped", async () => {
  mockFetch.mockImplementation(async () => ({
    ok: true,
    json: async () => ({ ...review, listsTruncated: true }),
  }));
  render(<AddToGroceriesButton recipeId="recipe-a" />);
  fireEvent.click(
    screen.getByRole("button", { name: "Add ingredients to groceries" }),
  );
  expect(
    await screen.findByText("Showing the first 100 grocery lists."),
  ).toBeInTheDocument();
});

it("does not show another destination or allow commit when the supplied list is unavailable", async () => {
  render(<AddToGroceriesButton recipeId="recipe-a" listId="foreign-list" />);
  fireEvent.click(
    screen.getByRole("button", { name: "Add ingredients to groceries" }),
  );
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "The chosen grocery list is unavailable. Close and choose another list.",
  );
  expect(
    screen.queryByRole("button", { name: "Add selected ingredients" }),
  ).not.toBeInTheDocument();
  expect(writes()).toHaveLength(0);
});

it("shows a clear empty-recipe state with commit disabled and no empty ingredientIds write", async () => {
  mockFetch.mockImplementation(async () => ({
    ok: true,
    json: async () => ({ ...review, ingredients: [] }),
  }));
  render(<AddToGroceriesButton recipeId="recipe-a" />);
  fireEvent.click(
    screen.getByRole("button", { name: "Add ingredients to groceries" }),
  );
  expect(
    await screen.findByText("This recipe has no ingredients to add."),
  ).toBeInTheDocument();
  expect(
    screen.getByRole("button", { name: "Add selected ingredients" }),
  ).toBeDisabled();
  fireEvent.click(
    screen.getByRole("button", { name: "Add selected ingredients" }),
  );
  expect(writes()).toHaveLength(0);
});

it("commits the reviewed intent rather than live props that changed while the dialog was open", async () => {
  const { rerender } = render(
    <AddToGroceriesButton recipeId="recipe-a" mealId="meal-a" servings={8} />,
  );
  fireEvent.click(
    screen.getByRole("button", { name: "Add ingredients to groceries" }),
  );
  await screen.findByRole("checkbox", { name: "Tomato 800 g" });
  rerender(
    <AddToGroceriesButton recipeId="recipe-b" mealId="meal-b" servings={2} />,
  );
  expect(
    screen.getByRole("checkbox", { name: "Tomato 800 g" }),
  ).toBeInTheDocument();
  fireEvent.click(
    screen.getByRole("button", { name: "Add selected ingredients" }),
  );
  await screen.findByRole("button", { name: "Undo" });
  expect(JSON.parse(writes()[0][1].body)).toMatchObject({
    recipeId: "recipe-a",
    mealId: "meal-a",
    servings: 8,
  });
});

it("shows honest presence-only hints and allows selecting ingredients already present", async () => {
  mockFetch.mockImplementation(async () => ({
    ok: true,
    json: async () => ({
      ...review,
      inventory: {
        state: "available",
        haveIngredientIds: ["tomato"],
        truncated: true,
      },
    }),
  }));
  render(<AddToGroceriesButton recipeId="recipe-a" />);
  fireEvent.click(
    screen.getByRole("button", { name: "Add ingredients to groceries" }),
  );
  expect(await screen.findByText("Present in inventory")).toBeInTheDocument();
  expect(screen.getByText("No match in scanned inventory")).toBeInTheDocument();
  expect(
    screen.getByText(
      "Presence only, not enough-for-recipe amounts. Inventory scan is incomplete.",
    ),
  ).toBeInTheDocument();
  expect(screen.getByRole("checkbox", { name: /Tomato/ })).toBeChecked();
  fireEvent.click(screen.getByRole("checkbox", { name: /Tomato/ }));
  expect(screen.getByRole("checkbox", { name: /Tomato/ })).not.toBeChecked();
});

it("retries the exact frozen submitted body and key after an ambiguous write despite new props", async () => {
  mockFetch.mockImplementation(async (_url: string, init?: RequestInit) => {
    if (init?.method === "POST")
      throw new TypeError("connection lost after commit");
    return { ok: true, json: async () => review };
  });
  const { rerender } = render(
    <AddToGroceriesButton recipeId="recipe-a" mealId="meal-a" servings={8} />,
  );
  fireEvent.click(
    screen.getByRole("button", { name: "Add ingredients to groceries" }),
  );
  fireEvent.click(
    await screen.findByRole("button", { name: "Add selected ingredients" }),
  );
  await screen.findByRole("button", { name: "Try again" });
  expect(
    screen.getByText(
      "This request may already be saved. Try again checks the same ingredients and destination; resolve it before starting another add.",
    ),
  ).toBeInTheDocument();
  const first = writes()[0][1];
  rerender(
    <AddToGroceriesButton
      recipeId="recipe-b"
      mealId="meal-b"
      servings={2}
      listId="list-b"
      ingredientIds={["salt"]}
    />,
  );
  mockFetch.mockImplementation(async () => ({
    ok: true,
    status: 201,
    headers: new Headers(),
    json: async () => result,
  }));
  fireEvent.click(screen.getByRole("button", { name: "Try again" }));
  await screen.findByRole("button", { name: "Undo" });
  expect(writes()).toHaveLength(2);
  expect(writes()[1][1].body).toBe(first.body);
  expect(writes()[1][1].headers["Idempotency-Key"]).toBe(
    first.headers["Idempotency-Key"],
  );
});

it.each(["not-a-date", { toString: null }])(
  "retains the frozen body and key after a successful response with malformed undo expiry %p",
  async (undoExpiresAt) => {
    const onAdded = jest.fn();
    mockFetch.mockImplementation(async (_url: string, init?: RequestInit) => ({
      ok: true,
      status: init?.method === "POST" ? 201 : 200,
      headers: new Headers(),
      json: async () =>
        init?.method === "POST" ? { ...result, undoExpiresAt } : review,
    }));
    const { rerender } = render(
      <AddToGroceriesButton
        recipeId="recipe-a"
        mealId="meal-a"
        servings={8}
        onAdded={onAdded}
      />,
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Add ingredients to groceries" }),
    );
    fireEvent.click(
      await screen.findByRole("button", { name: "Add selected ingredients" }),
    );
    await screen.findByRole("button", { name: "Try again" });
    expect(
      screen.queryByRole("button", { name: "Undo" }),
    ).not.toBeInTheDocument();
    expect(onAdded).not.toHaveBeenCalled();
    const first = writes()[0][1];
    rerender(
      <AddToGroceriesButton
        recipeId="recipe-b"
        mealId="meal-b"
        servings={2}
        listId="list-b"
        ingredientIds={["salt"]}
        onAdded={onAdded}
      />,
    );
    mockFetch.mockImplementation(async () => ({
      ok: true,
      status: 201,
      headers: new Headers({ "Idempotency-Replayed": "true" }),
      json: async () => result,
    }));
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await screen.findByRole("button", { name: "Undo" });
    expect(writes()).toHaveLength(2);
    expect(writes()[1][1].body).toBe(first.body);
    expect(writes()[1][1].headers["Idempotency-Key"]).toBe(
      first.headers["Idempotency-Key"],
    );
    expect(onAdded).toHaveBeenCalledTimes(1);
  },
);

it("starts a fresh reviewed payload and key after a definite response and honors an edited destination", async () => {
  const multi = {
    ...review,
    lists: [
      ...review.lists,
      { id: "list-b", name: "Weekend groceries", type: "shopping" },
    ],
  };
  mockFetch.mockImplementation(async (_url: string, init?: RequestInit) => ({
    ok: true,
    status: 200,
    headers: new Headers(),
    json: async () => (init?.method === "POST" ? result : multi),
  }));
  render(<AddToGroceriesButton recipeId="recipe-a" />);
  for (const destination of ["list-a", "list-b"]) {
    fireEvent.click(
      screen.getByRole("button", { name: "Add ingredients to groceries" }),
    );
    fireEvent.change(await screen.findByLabelText("Destination list"), {
      target: { value: destination },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Add selected ingredients" }),
    );
    await screen.findByRole("button", { name: "Undo" });
  }
  expect(writes()).toHaveLength(2);
  expect(JSON.parse(writes()[1][1].body).listId).toBe("list-b");
  expect(writes()[1][1].headers["Idempotency-Key"]).not.toBe(
    writes()[0][1].headers["Idempotency-Key"],
  );
});

it("preserves saved 100-serving fallback without sending an invalid explicit override", async () => {
  mockFetch.mockImplementation(async (_url: string, init?: RequestInit) => ({
    ok: true,
    status: 200,
    headers: new Headers(),
    json: async () =>
      init?.method === "POST" ? result : { ...review, targetServings: 100 },
  }));
  render(<AddToGroceriesButton recipeId="recipe-a" mealId="meal-a" />);
  fireEvent.click(
    screen.getByRole("button", { name: "Add ingredients to groceries" }),
  );
  expect(await screen.findByText("For 100 servings")).toBeInTheDocument();
  fireEvent.click(
    screen.getByRole("button", { name: "Add selected ingredients" }),
  );
  await screen.findByRole("button", { name: "Undo" });
  expect(JSON.parse(writes()[0][1].body)).not.toHaveProperty("servings");
});

it("keeps Undo result reporting for checked items", async () => {
  mockFetch.mockImplementation(async (url: string, init?: RequestInit) => ({
    ok: true,
    status: 200,
    headers: new Headers(),
    json: async () =>
      url.endsWith("undo-add")
        ? { requestId: "request-a", removedCount: 1, keptCheckedCount: 1 }
        : init?.method === "POST"
          ? result
          : review,
  }));
  render(<AddToGroceriesButton recipeId="recipe-a" />);
  fireEvent.click(
    screen.getByRole("button", { name: "Add ingredients to groceries" }),
  );
  fireEvent.click(
    await screen.findByRole("button", { name: "Add selected ingredients" }),
  );
  fireEvent.click(await screen.findByRole("button", { name: "Undo" }));
  expect(
    await screen.findByText("Removed 1 item (1 item already ticked, kept)."),
  ).toBeInTheDocument();
  expect(JSON.parse(writes()[1][1].body)).toEqual({ requestId: "request-a" });
});

it("opens an ingredient/amount/unit/destination review; cancel makes zero writes", async () => {
  render(<AddToGroceriesButton recipeId="recipe-a" mealId="meal-a" />);
  fireEvent.click(
    screen.getByRole("button", { name: "Add ingredients to groceries" }),
  );
  expect(
    await screen.findByRole("dialog", { name: "Review grocery ingredients" }),
  ).toBeInTheDocument();
  expect(await screen.findByText("Tomato soup")).toBeInTheDocument();
  expect(screen.getByText("800 g")).toBeInTheDocument();
  expect(screen.getByLabelText("Destination list")).toHaveValue("list-a");
  expect(
    screen.getByText("Inventory comparison unavailable. Choose what you need."),
  ).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(writes()).toHaveLength(0);
});

it("allows editing selection, disables empty selection, and submits only selected ingredient ids", async () => {
  render(<AddToGroceriesButton recipeId="recipe-a" mealId="meal-a" />);
  fireEvent.click(
    screen.getByRole("button", { name: "Add ingredients to groceries" }),
  );
  const tomato = await screen.findByRole("checkbox", { name: "Tomato 800 g" });
  const salt = screen.getByRole("checkbox", { name: "Salt 2 tsp" });
  fireEvent.click(tomato);
  fireEvent.click(salt);
  expect(
    screen.getByRole("button", { name: "Add selected ingredients" }),
  ).toBeDisabled();
  expect(writes()).toHaveLength(0);
  fireEvent.click(salt);
  fireEvent.click(
    screen.getByRole("button", { name: "Add selected ingredients" }),
  );
  await waitFor(() => expect(writes()).toHaveLength(1));
  expect(JSON.parse(writes()[0][1].body)).toEqual({
    recipeId: "recipe-a",
    mealId: "meal-a",
    listId: "list-a",
    ingredientIds: ["salt"],
  });
  expect(
    await screen.findByRole("button", { name: "Undo" }),
  ).toBeInTheDocument();
});
