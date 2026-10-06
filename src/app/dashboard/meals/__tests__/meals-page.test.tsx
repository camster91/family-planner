/**
 * @jest-environment jsdom
 */
import * as React from "react";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { I18nProvider } from "@/i18n";
import { toDateOnlyLocal } from "@/lib/dates";
import MealsPage from "../page";
import { ToastProvider } from "@/components/ui/toast";

jest.mock("@/components/providers/features-provider", () => ({
  useFeatureEnabled: () => true,
}));

jest.mock("next/navigation", () => ({
  usePathname: () => "/dashboard/meals",
  useSearchParams: () => {
    const [search, setSearch] = React.useState(window.location.search);
    React.useEffect(() => {
      const update = () => setSearch(window.location.search);
      window.addEventListener("popstate", update);
      return () => window.removeEventListener("popstate", update);
    }, []);
    return new URLSearchParams(search);
  },
  useRouter: () => ({
    push: (url: string) => {
      window.history.pushState({}, "", url);
      window.dispatchEvent(new PopStateEvent("popstate"));
    },
  }),
}));

beforeEach(() => window.history.replaceState({}, "", "/dashboard/meals"));

const today = toDateOnlyLocal(new Date());
const todayIso = `${today}T00:00:00.000Z`;

const LASAGNA = {
  id: "r_lasagna",
  title: "Veggie lasagna",
  prep_time: 25,
  cook_time: 45,
  servings: 6,
};

type Call = { url: string; method: string; body: unknown };

function setup({
  meals,
  mealsStatus = 200,
  membersStatus = 200,
  saveError,
}: {
  meals: unknown[];
  mealsStatus?: number;
  membersStatus?: number;
  /** Answer meal POST/PATCH with this status and server error. */
  saveError?: { status: number; error: string };
}) {
  const calls: Call[] = [];
  const fetchMock = jest.fn(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = (init?.method ?? "GET").toUpperCase();
      const body = init?.body ? JSON.parse(String(init.body)) : undefined;
      calls.push({ url, method, body });
      const json = (status: number, data: unknown) =>
        ({
          ok: status >= 200 && status < 300,
          status,
          json: async () => data,
        }) as Response;
      if (url.startsWith("/api/meals?"))
        return json(
          mealsStatus,
          mealsStatus === 200 ? { meals } : { error: "boom" },
        );
      if (url === "/api/family/members")
        return json(membersStatus, {
          members: [
            { id: "cook_a", name: "Alex", role: "parent" },
            { id: "cook_b", name: "Sam", role: "teen" },
          ],
        });
      if (url.startsWith("/api/recipes"))
        return json(200, { recipes: [LASAGNA], nextOffset: null });
      if (
        saveError &&
        (method === "POST" || method === "PATCH") &&
        url.startsWith("/api/meals")
      )
        return json(saveError.status, { error: saveError.error });
      if (url === "/api/meals" && method === "POST")
        return json(201, { meal: { id: "new" } });
      if (url.startsWith("/api/meals/") && method === "PATCH")
        return json(200, { meal: { id: "x" } });
      if (url.startsWith("/api/meals/") && method === "DELETE")
        return json(200, { success: true });
      return json(404, {});
    },
  );
  global.fetch = fetchMock as unknown as typeof fetch;
  window.confirm = jest.fn(() => false);
  window.alert = jest.fn();
  render(
    <I18nProvider>
      <ToastProvider>
        <MealsPage />
      </ToastProvider>
    </I18nProvider>,
  );
  return { calls, fetchMock };
}

const dinnerA = {
  id: "meal_a",
  meal_type: "dinner",
  recipe_name: "Tacos",
  notes: null,
  date: todayIso,
  recipe: null,
};
const dinnerB = {
  id: "meal_b",
  meal_type: "dinner",
  recipe_name: "Green salad",
  notes: null,
  date: todayIso,
  recipe: null,
};

async function todayCard() {
  const cards = await screen.findAllByTestId("meal-day");
  return cards.find((c) => c.getAttribute("data-day") === today)!;
}

describe("/dashboard/meals", () => {
  it.each(["save", "delete", "undo"])(
    "refreshes the selected week after deferred %s completes across navigation",
    async (action) => {
      window.history.replaceState({}, "", "/dashboard/meals?start=2026-12-01");
      const user = userEvent.setup();
      const { calls, fetchMock } = setup({
        meals: [{ ...dinnerA, date: "2026-12-01T00:00:00.000Z" }],
      });
      await user.click(await screen.findByTestId("meal-row"));
      const dialog = await screen.findByRole("dialog");
      if (action === "undo") {
        await user.click(
          within(dialog).getByRole("button", { name: "Delete" }),
        );
        await screen.findByTestId("undo-toast");
      }
      const original = fetchMock.getMockImplementation()!;
      let resolveMutation!: (response: Response) => void;
      let resolveWindow!: (response: Response) => void;
      const selectedMeal = { ...dinnerB, date: "2026-12-08T00:00:00.000Z" };
      let selectedReads = 0;
      fetchMock.mockImplementation(async (input, init) => {
        const url = String(input);
        if (
          init?.method ===
          (action === "save"
            ? "PATCH"
            : action === "delete"
              ? "DELETE"
              : "POST")
        ) {
          return new Promise<Response>((resolve) => {
            resolveMutation = resolve;
          });
        }
        if (url === "/api/meals?start=2026-12-08&end=2026-12-15") {
          calls.push({ url, method: "GET", body: undefined });
          if (++selectedReads === 1)
            return new Promise<Response>((resolve) => {
              resolveWindow = resolve;
            });
          return {
            ok: true,
            json: async () => ({ meals: [selectedMeal] }),
          } as Response;
        }
        return original(input, init);
      });
      const selectNextWeek = async () => {
        await act(async () => {
          window.history.pushState({}, "", "/dashboard/meals?start=2026-12-08");
          window.dispatchEvent(new PopStateEvent("popstate"));
        });
        await waitFor(() => expect(selectedReads).toBe(1));
      };
      // Undo is retained from week A, but is clicked only after week B is selected.
      if (action === "undo") await selectNextWeek();
      await user.click(
        action === "undo"
          ? within(screen.getByTestId("undo-toast")).getByRole("button", {
              name: "Undo",
            })
          : within(dialog).getByRole("button", {
              name: action === "save" ? "Save" : "Delete",
            }),
      );
      if (action !== "undo") await selectNextWeek();
      const readsBefore = calls.filter((c) =>
        c.url.startsWith("/api/meals?"),
      ).length;
      await act(async () => {
        resolveMutation({ ok: true, json: async () => ({}) } as Response);
      });
      await waitFor(() =>
        expect(
          calls.filter((c) => c.url.startsWith("/api/meals?")).length,
        ).toBeGreaterThan(readsBefore),
      );
      expect(
        calls.filter((c) => c.url.startsWith("/api/meals?")).at(-1)?.url,
      ).toBe("/api/meals?start=2026-12-08&end=2026-12-15");
      expect((await screen.findByTestId("meal-row")).textContent).toContain(
        "Green salad",
      );
      await act(async () => {
        resolveWindow({
          ok: true,
          json: async () => ({ meals: [] }),
        } as Response);
      });
      expect(screen.getByTestId("meal-row").textContent).toContain(
        "Green salad",
      );
      expect(
        screen.getAllByTestId("meal-day")[0].getAttribute("data-day"),
      ).toBe("2026-12-08");
    },
  );

  it("keeps the cook untouched if household members cannot load", async () => {
    const user = userEvent.setup();
    const { calls } = setup({
      meals: [{ ...dinnerA, cook_id: "cook_a" }],
      membersStatus: 500,
    });
    await user.click(within(await todayCard()).getByTestId("meal-row"));
    const dialog = await screen.findByRole("dialog");
    await within(dialog).findByText(
      "Could not load cooks. The current assignment will be kept.",
    );
    expect(within(dialog).getByLabelText("Cook (optional)")).toHaveProperty(
      "disabled",
      true,
    );
    await user.click(within(dialog).getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(calls.find((c) => c.method === "PATCH")?.body).toEqual({
        id: "meal_a",
        date: today,
        meal_type: "dinner",
        recipe_name: "Tacos",
        notes: null,
      }),
    );
  });

  it("adds the minimum servings without requiring a recipe or cook", async () => {
    const user = userEvent.setup();
    const { calls } = setup({ meals: [] });
    await user.click(
      within(await todayCard()).getByRole("button", { name: /^Add lunch,/ }),
    );
    const dialog = await screen.findByRole("dialog");
    await user.type(within(dialog).getByLabelText("Servings (optional)"), "1");
    await user.click(within(dialog).getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(calls.find((c) => c.method === "POST")?.body).toEqual({
        date: today,
        meal_type: "lunch",
        recipe_name: "",
        servings: 1,
      }),
    );
  });
  it("does not let a slower previous window replace the selected week", async () => {
    window.history.replaceState({}, "", "/dashboard/meals?start=2026-12-01");
    const user = userEvent.setup();
    const { fetchMock } = setup({
      meals: [{ ...dinnerA, date: "2026-12-15T00:00:00.000Z" }],
    });
    await screen.findAllByTestId("meal-day");
    let resolve!: (response: Response) => void;
    fetchMock.mockImplementationOnce(
      () =>
        new Promise<Response>((done) => {
          resolve = done;
        }),
    );
    await user.click(screen.getByRole("button", { name: "Next week" }));
    await user.click(screen.getByRole("button", { name: "Next week" }));
    expect(await screen.findByTestId("meal-row")).toBeTruthy();
    await act(async () => {
      resolve({ ok: true, json: async () => ({ meals: [] }) } as Response);
    });
    expect(screen.getByTestId("meal-row").textContent).toContain("Tacos");
  });
  it("clears cook and servings explicitly while unlinking preserves the snapshot and clears notes", async () => {
    const user = userEvent.setup();
    const { calls } = setup({
      meals: [
        {
          ...dinnerA,
          cook_id: "cook_a",
          servings: 4,
          notes: "Old note",
          recipe_id: LASAGNA.id,
          recipe: LASAGNA,
        },
      ],
    });
    await user.click(within(await todayCard()).getByTestId("meal-row"));
    const dialog = await screen.findByRole("dialog");
    await within(dialog).findByRole("option", { name: "Alex" });
    await user.selectOptions(
      within(dialog).getByLabelText("Cook (optional)"),
      "",
    );
    await user.clear(within(dialog).getByLabelText("Servings (optional)"));
    await user.clear(within(dialog).getByLabelText("Notes (optional)"));
    await user.selectOptions(
      within(dialog).getByLabelText("Recipe (optional)"),
      "",
    );
    await user.click(within(dialog).getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(calls.find((c) => c.method === "PATCH")?.body).toEqual({
        id: "meal_a",
        date: today,
        meal_type: "dinner",
        recipe_name: "Tacos",
        notes: null,
        recipe_id: null,
        cook_id: null,
        servings: null,
      }),
    );
  });

  it.each(["0", "101", "1.5"])(
    "rejects invalid servings %s before sending a mutation",
    async (value) => {
      const user = userEvent.setup();
      const { calls } = setup({ meals: [dinnerA] });
      await user.click(within(await todayCard()).getByTestId("meal-row"));
      const dialog = await screen.findByRole("dialog");
      await user.type(
        within(dialog).getByLabelText("Servings (optional)"),
        value,
      );
      await user.click(within(dialog).getByRole("button", { name: "Save" }));
      expect(calls.some((c) => c.method === "PATCH")).toBe(false);
      expect(screen.getByRole("dialog")).toBeTruthy();
    },
  );

  it("omits unchanged cook and servings when editing just the name", async () => {
    const user = userEvent.setup();
    const { calls } = setup({
      meals: [{ ...dinnerA, cook_id: "cook_a", servings: 4 }],
    });
    await user.click(within(await todayCard()).getByTestId("meal-row"));
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(calls.find((c) => c.method === "PATCH")?.body).toEqual({
        id: "meal_a",
        date: today,
        meal_type: "dinner",
        recipe_name: "Tacos",
        notes: null,
      }),
    );
  });

  it.each(["2026-03-08", "2026-11-01"])(
    "keeps seven local date-only days over DST from %s",
    async (start) => {
      window.history.replaceState({}, "", `/dashboard/meals?start=${start}`);
      const { calls } = setup({ meals: [] });
      const cards = await screen.findAllByTestId("meal-day");
      expect(cards).toHaveLength(7);
      expect(cards[0].getAttribute("data-day")).toBe(start);
      const end = start === "2026-03-08" ? "2026-03-15" : "2026-11-08";
      expect(
        calls.some((c) => c.url === `/api/meals?start=${start}&end=${end}`),
      ).toBe(true);
    },
  );

  it.each(["9999-12-25", "9999-12-28", "0099-12-25", "2026-02-31"])(
    "shows an explicit unsupported complete week for URL start %s without fetching a fallback",
    async (start) => {
      window.history.replaceState(
        {},
        "",
        `/dashboard/meals?start=${start}&keep=yes`,
      );
      const user = userEvent.setup();
      const { calls } = setup({ meals: [] });
      expect(await screen.findByRole("alert")).toHaveProperty(
        "textContent",
        expect.stringContaining("Choose a supported seven-day week"),
      );
      expect(calls.some((c) => c.url.startsWith("/api/meals?"))).toBe(false);
      expect(screen.queryByTestId("meal-day")).toBeNull();
      expect(
        screen.getByRole("button", { name: "Previous week" }),
      ).toHaveProperty("disabled", true);
      expect(screen.getByRole("button", { name: "Next week" })).toHaveProperty(
        "disabled",
        true,
      );
      expect(
        screen.getByRole("button", { name: /^Add meal$/i }),
      ).toHaveProperty("disabled", true);
      await user.click(screen.getByRole("button", { name: "Current week" }));
      await todayCard();
      expect(new URLSearchParams(window.location.search).has("start")).toBe(
        false,
      );
      expect(new URLSearchParams(window.location.search).get("keep")).toBe(
        "yes",
      );
    },
  );

  it.each([
    ["0100-01-01", "0100-01-08", "Previous week"],
    ["9999-12-24", "9999-12-31", "Next week"],
  ])(
    "fetches the full supported boundary week %s and disables %s navigation",
    async (start, end, blocked) => {
      window.history.replaceState({}, "", `/dashboard/meals?start=${start}`);
      const user = userEvent.setup();
      const { calls } = setup({ meals: [] });
      const cards = await screen.findAllByTestId("meal-day");
      expect(cards).toHaveLength(7);
      expect(cards[0].getAttribute("data-day")).toBe(start);
      expect(
        calls.filter((c) => c.url.startsWith("/api/meals?")).map((c) => c.url),
      ).toEqual([`/api/meals?start=${start}&end=${end}`]);
      const button = screen.getByRole("button", { name: blocked });
      expect(button).toHaveProperty("disabled", true);
      await user.click(button);
      expect(new URLSearchParams(window.location.search).get("start")).toBe(
        start,
      );
    },
  );

  it("sets nullable servings on the second meal without changing its recipe snapshot or notes", async () => {
    const user = userEvent.setup();
    const { calls } = setup({
      meals: [
        dinnerA,
        {
          ...dinnerB,
          servings: 6,
          cook_id: "cook_a",
          notes: "No onions",
          recipe_id: LASAGNA.id,
          recipe: LASAGNA,
        },
      ],
    });
    const card = await todayCard();
    await user.click(within(card).getAllByTestId("meal-row")[1]);
    const dialog = await screen.findByRole("dialog");
    const servings = within(dialog).getByLabelText("Servings (optional)");
    expect(servings).toHaveProperty("value", "6");
    await user.clear(servings);
    await user.type(servings, "100");
    await user.click(within(dialog).getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(calls.find((c) => c.method === "PATCH")?.body).toEqual({
        id: "meal_b",
        date: today,
        meal_type: "dinner",
        recipe_name: "Green salad",
        notes: "No onions",
        servings: 100,
      }),
    );
  });

  it("assigns a household cook when adding a free-text snack", async () => {
    const user = userEvent.setup();
    const { calls } = setup({ meals: [] });
    const card = await todayCard();
    await user.click(within(card).getByRole("button", { name: /^Add snack,/ }));
    const dialog = await screen.findByRole("dialog");
    await within(dialog).findByRole("option", { name: "Sam" });
    await user.selectOptions(
      within(dialog).getByLabelText("Cook (optional)"),
      "cook_b",
    );
    await user.type(within(dialog).getByLabelText("Recipe name"), "Apples");
    await user.click(within(dialog).getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(calls.find((c) => c.method === "POST")?.body).toEqual({
        date: today,
        meal_type: "snack",
        recipe_name: "Apples",
        cook_id: "cook_b",
      }),
    );
  });

  it("navigates URL-backed seven-day windows and returns to the viewer current week", async () => {
    window.history.replaceState(
      {},
      "",
      "/dashboard/meals?start=2026-12-28&keep=yes",
    );
    const user = userEvent.setup();
    const { calls } = setup({ meals: [] });
    await waitFor(() =>
      expect(
        calls.some(
          (c) => c.url === "/api/meals?start=2026-12-28&end=2027-01-04",
        ),
      ).toBe(true),
    );
    expect(
      (await screen.findAllByTestId("meal-day"))[0].getAttribute("data-day"),
    ).toBe("2026-12-28");
    expect(screen.queryByText("Today")).toBeNull();
    await user.click(screen.getByRole("button", { name: "Next week" }));
    await waitFor(() =>
      expect(
        calls.some(
          (c) => c.url === "/api/meals?start=2027-01-04&end=2027-01-11",
        ),
      ).toBe(true),
    );
    expect(new URLSearchParams(window.location.search).get("start")).toBe(
      "2027-01-04",
    );
    expect(new URLSearchParams(window.location.search).get("keep")).toBe("yes");
    await user.click(screen.getByRole("button", { name: "Previous week" }));
    await waitFor(() =>
      expect(new URLSearchParams(window.location.search).get("start")).toBe(
        "2026-12-28",
      ),
    );
    await user.click(screen.getByRole("button", { name: "Current week" }));
    await todayCard();
    expect(new URLSearchParams(window.location.search).has("start")).toBe(
      false,
    );
  });

  it("links to the food inventory when it is on (#263)", async () => {
    setup({ meals: [] });
    const link = await screen.findByRole("link", {
      name: "What's in the fridge",
    });
    expect(link.getAttribute("href")).toBe("/dashboard/inventory");
  });

  it("shows every meal in a slot, each editable and deletable (gap 2.4.1)", async () => {
    const user = userEvent.setup();
    const { calls } = setup({ meals: [dinnerA, dinnerB] });
    const card = await todayCard();
    const rows = within(card).getAllByTestId("meal-row");
    expect(rows.map((r) => r.textContent)).toEqual([
      expect.stringContaining("Tacos"),
      expect.stringContaining("Green salad"),
    ]);
    // One "add another" control for the slot, named for the meal type and day.
    expect(
      within(card).getAllByRole("button", { name: /^Add another dinner,/ }),
    ).toHaveLength(1);

    await user.click(rows[1]);
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByLabelText("Recipe name")).toHaveProperty(
      "value",
      "Green salad",
    );
    await user.click(within(dialog).getByRole("button", { name: "Delete" }));
    await waitFor(() =>
      expect(calls.some((c) => c.method === "DELETE")).toBe(true),
    );
    expect(calls.find((c) => c.method === "DELETE")!.url).toBe(
      "/api/meals/meal_b?id=meal_b",
    );
    // Undo over confirm (#269): no confirm dialog; Undo re-creates the meal.
    expect(window.confirm).not.toHaveBeenCalled();
    const toast = await screen.findByTestId("undo-toast");
    expect(toast.textContent).toContain("Deleted Green salad");
    await user.click(within(toast).getByRole("button", { name: "Undo" }));
    await waitFor(() =>
      expect(
        calls.some((c) => c.url === "/api/meals" && c.method === "POST"),
      ).toBe(true),
    );
    expect(
      calls.find((c) => c.url === "/api/meals" && c.method === "POST")!.body,
    ).toEqual({
      date: today,
      meal_type: "dinner",
      recipe_name: "Green salad",
    });
  });

  it("edits the second meal of a slot with the old free-text body (no recipe_id)", async () => {
    const user = userEvent.setup();
    const { calls } = setup({ meals: [dinnerA, dinnerB] });
    const card = await todayCard();
    await user.click(within(card).getAllByTestId("meal-row")[1]);
    const dialog = await screen.findByRole("dialog");
    const name = within(dialog).getByLabelText("Recipe name");
    await user.clear(name);
    await user.type(name, "Caesar salad");
    await user.click(within(dialog).getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(calls.some((c) => c.method === "PATCH")).toBe(true),
    );
    const patch = calls.find((c) => c.method === "PATCH")!;
    expect(patch.url).toBe("/api/meals/meal_b");
    expect(patch.body).toEqual({
      id: "meal_b",
      date: today,
      meal_type: "dinner",
      recipe_name: "Caesar salad",
      notes: null,
    });
  });

  it("clears notes when they are emptied on edit (sends null, not nothing)", async () => {
    const user = userEvent.setup();
    const { calls } = setup({ meals: [{ ...dinnerA, notes: "Extra cheese" }] });
    const card = await todayCard();
    await user.click(within(card).getAllByTestId("meal-row")[0]);
    const dialog = await screen.findByRole("dialog");
    const notes = within(dialog).getByLabelText("Notes (optional)");
    expect((notes as HTMLTextAreaElement).value).toBe("Extra cheese");
    await user.clear(notes);
    await user.click(within(dialog).getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(calls.some((c) => c.method === "PATCH")).toBe(true),
    );
    expect(calls.find((c) => c.method === "PATCH")!.body).toEqual(
      expect.objectContaining({ id: "meal_a", notes: null }),
    );
  });

  it("keeps edited notes when they are changed", async () => {
    const user = userEvent.setup();
    const { calls } = setup({ meals: [{ ...dinnerA, notes: "Extra cheese" }] });
    const card = await todayCard();
    await user.click(within(card).getAllByTestId("meal-row")[0]);
    const dialog = await screen.findByRole("dialog");
    const notes = within(dialog).getByLabelText("Notes (optional)");
    await user.clear(notes);
    await user.type(notes, "No onions");
    await user.click(within(dialog).getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(calls.some((c) => c.method === "PATCH")).toBe(true),
    );
    expect(calls.find((c) => c.method === "PATCH")!.body).toEqual(
      expect.objectContaining({ notes: "No onions" }),
    );
  });

  it("moves focus into the meal dialog, and Escape closes it and returns focus", async () => {
    const user = userEvent.setup();
    setup({ meals: [] });
    const card = await todayCard();
    const opener = within(card).getByRole("button", {
      name: /^Add breakfast,/,
    });
    await user.click(opener);
    const dialog = await screen.findByRole("dialog");
    expect(dialog.contains(document.activeElement)).toBe(true);
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(opener);
  });

  it("adds a free-text meal from an empty slot exactly as before", async () => {
    const user = userEvent.setup();
    const { calls } = setup({ meals: [] });
    const card = await todayCard();
    await user.click(
      within(card).getByRole("button", { name: /^Add breakfast,/ }),
    );
    const dialog = await screen.findByRole("dialog");
    await user.type(within(dialog).getByLabelText("Recipe name"), "Porridge");
    await user.click(within(dialog).getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(calls.some((c) => c.method === "POST")).toBe(true),
    );
    expect(calls.find((c) => c.method === "POST")!.body).toEqual({
      date: today,
      meal_type: "breakfast",
      recipe_name: "Porridge",
    });
  });

  it("adds a meal with a recipe: the name fills from the recipe and recipe_id is sent", async () => {
    const user = userEvent.setup();
    const { calls } = setup({ meals: [] });
    const card = await todayCard();
    await user.click(
      within(card).getByRole("button", { name: /^Add dinner,/ }),
    );
    const dialog = await screen.findByRole("dialog");
    const picker = within(dialog).getByLabelText("Recipe (optional)");
    await within(dialog).findByRole("option", { name: "Veggie lasagna" });
    await user.selectOptions(picker, "r_lasagna");
    expect(within(dialog).getByLabelText("Recipe name")).toHaveProperty(
      "value",
      "Veggie lasagna",
    );
    expect(
      within(dialog)
        .getByRole("link", { name: "View recipe" })
        .getAttribute("href"),
    ).toBe("/dashboard/meals/recipes/r_lasagna");
    await user.click(within(dialog).getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(calls.some((c) => c.method === "POST")).toBe(true),
    );
    expect(calls.find((c) => c.method === "POST")!.body).toEqual({
      date: today,
      meal_type: "dinner",
      recipe_name: "Veggie lasagna",
      recipe_id: "r_lasagna",
    });
  });

  it("shows the linked recipe and prep time on the meal row, and can unlink it", async () => {
    const user = userEvent.setup();
    const linked = {
      ...dinnerA,
      recipe_name: "Veggie lasagna",
      recipe_id: LASAGNA.id,
      recipe: LASAGNA,
    };
    const { calls } = setup({ meals: [linked] });
    const card = await todayCard();
    const row = within(card).getByTestId("meal-row");
    expect(row.textContent).toContain("Dinner · Recipe · 25 min prep");
    await user.click(row);
    const dialog = await screen.findByRole("dialog");
    await user.selectOptions(
      within(dialog).getByLabelText("Recipe (optional)"),
      "",
    );
    await user.click(within(dialog).getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(calls.some((c) => c.method === "PATCH")).toBe(true),
    );
    expect(calls.find((c) => c.method === "PATCH")!.body).toMatchObject({
      recipe_id: null,
      recipe_name: "Veggie lasagna",
    });
  });

  it.each([4, null])(
    "disables groceries while servings differ from the saved value %s",
    async (savedServings) => {
      const user = userEvent.setup();
      const { calls } = setup({
        meals: [
          {
            ...dinnerA,
            servings: savedServings,
            recipe_id: LASAGNA.id,
            recipe: LASAGNA,
          },
        ],
      });
      await user.click(within(await todayCard()).getByTestId("meal-row"));
      const dialog = await screen.findByRole("dialog");
      expect(
        within(dialog).getByRole("button", {
          name: "Add ingredients to groceries",
        }),
      ).toHaveProperty("disabled", false);
      const servings = within(dialog).getByLabelText("Servings (optional)");
      await user.clear(servings);
      await user.type(servings, "100");
      const groceries = within(dialog).getByRole("button", {
        name: "Add ingredients to groceries",
      });
      expect(groceries).toHaveProperty("disabled", true);
      expect(
        within(dialog).getByText(
          "Save servings before adding ingredients to groceries.",
        ),
      ).toBeTruthy();
      await user.click(groceries);
      expect(calls.some((c) => c.url === "/api/lists/items/from-recipe")).toBe(
        false,
      );
      await user.clear(servings);
      if (savedServings !== null)
        await user.type(servings, String(savedServings));
      expect(
        within(dialog).getByRole("button", {
          name: "Add ingredients to groceries",
        }),
      ).toHaveProperty("disabled", false);
    },
  );

  it('offers "Add to groceries" only for the saved recipe link, not an unsaved picker change', async () => {
    const user = userEvent.setup();
    const linked = {
      ...dinnerA,
      recipe_name: "Veggie lasagna",
      recipe_id: LASAGNA.id,
      recipe: LASAGNA,
    };
    setup({ meals: [linked] });
    const card = await todayCard();
    await user.click(within(card).getByTestId("meal-row"));
    const dialog = await screen.findByRole("dialog");
    expect(
      within(dialog).getByRole("button", {
        name: "Add ingredients to groceries",
      }),
    ).toBeTruthy();
    await user.selectOptions(
      within(dialog).getByLabelText("Recipe (optional)"),
      "",
    );
    expect(
      within(dialog).queryByRole("button", {
        name: "Add ingredients to groceries",
      }),
    ).toBeNull();
  });

  it("shows an error state with a working retry", async () => {
    const user = userEvent.setup();
    const { fetchMock } = setup({ meals: [], mealsStatus: 500 });
    expect(await screen.findByText("Could not load meals")).toBeTruthy();
    const before = fetchMock.mock.calls.length;
    await user.click(screen.getByRole("button", { name: "Try again" }));
    await waitFor(() =>
      expect(fetchMock.mock.calls.length).toBeGreaterThan(before),
    );
  });

  it("writes the meal type in text on empty slots (not icon-only)", async () => {
    setup({ meals: [] });
    const card = await todayCard();
    for (const label of ["Breakfast", "Lunch", "Dinner", "Snack"]) {
      expect(within(card).getByText(label)).toBeTruthy();
    }
    expect(within(card).getAllByText("Nothing planned")).toHaveLength(4);
  });

  it('shows one empty state for an empty week: the days, not an extra "No meals planned yet"', async () => {
    setup({ meals: [] });
    await todayCard();
    expect(screen.getAllByTestId("meal-day")).toHaveLength(7);
    expect(screen.queryByText("No meals planned yet")).toBeNull();
    expect(document.querySelector("img[data-brand-illustration]")).toBeNull();
  });

  it("shows the server's reason in a toast when a save fails, not alert(), and keeps the dialog open", async () => {
    const user = userEvent.setup();
    setup({
      meals: [],
      saveError: { status: 400, error: "Recipe name is too long" },
    });
    const card = await todayCard();
    await user.click(
      within(card).getByRole("button", { name: /^Add breakfast,/ }),
    );
    const dialog = await screen.findByRole("dialog");
    await user.type(within(dialog).getByLabelText("Recipe name"), "Porridge");
    await user.click(within(dialog).getByRole("button", { name: "Save" }));
    expect(await screen.findByText("Recipe name is too long")).toBeTruthy();
    expect(screen.getByText("Couldn't add the meal")).toBeTruthy();
    expect(window.alert).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog")).toBeTruthy();
  });

  it("says to check the connection when a save cannot reach the server", async () => {
    const user = userEvent.setup();
    const { fetchMock } = setup({ meals: [dinnerA] });
    const card = await todayCard();
    await user.click(within(card).getByTestId("meal-row"));
    const dialog = await screen.findByRole("dialog");
    fetchMock.mockImplementationOnce(async () => {
      throw new TypeError("Failed to fetch");
    });
    await user.click(within(dialog).getByRole("button", { name: "Save" }));
    expect(await screen.findByText("Couldn't save the meal")).toBeTruthy();
    expect(
      screen.getByText("Check your connection and try again."),
    ).toBeTruthy();
    expect(window.alert).not.toHaveBeenCalled();
  });
});
