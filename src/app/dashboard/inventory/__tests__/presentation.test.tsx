/** @jest-environment jsdom */
import "@testing-library/jest-dom";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { I18nProvider, useTranslation } from "@/i18n";
import { inventoryMessages } from "@/i18n/inventory";
import { pseudolocalizeTemplate } from "@/i18n/pseudo";
import { ToastProvider } from "@/components/ui/toast";
import InventoryClient from "../InventoryClient";
jest.mock("@/components/providers/features-provider", () => ({
  useFeatureEnabled: () => true,
}));
const privateName = "Synthetic {name} 李";
const item = {
  id: "synthetic",
  name: privateName,
  amount: 2,
  unit: "raw {unit} 李",
  location: "fridge",
  expires_on: "2026-10-10",
  date_kind: "use_by",
  category: "produce",
  purchased_on: null,
  opened_on: "2026-10-08",
  status: "active",
  expiry: { status: "past_use_by", daysLeft: -1 },
};
const response = (body: unknown, ok = true) =>
  ({ ok, json: async () => body }) as Response;
function Switch() {
  const { setLocale } = useTranslation();
  return <button onClick={() => setLocale("es")}>Switch</button>;
}
beforeEach(() =>
  Object.defineProperty(navigator, "onLine", {
    value: true,
    configurable: true,
  }),
);
for (const locale of ["en", "es"] as const)
  for (const expanded of [false, true]) {
    const copy = (key: keyof typeof inventoryMessages.en) =>
      expanded
        ? pseudolocalizeTemplate(inventoryMessages[locale][key])
        : inventoryMessages[locale][key];
    const mount = () =>
      render(
        <I18nProvider locale={locale} pseudolocalize={expanded}>
          <Switch />
          <ToastProvider>
            <InventoryClient canWrite={false} canOpenRecipes={false} />
          </ToastProvider>
        </I18nProvider>,
      );
    it(`${locale} expanded=${expanded}: loading/error/retry/reader empty states and canonical load count`, async () => {
      let release!: (value: Response) => void;
      const pending = new Promise<Response>((resolve) => {
        release = resolve;
      });
      global.fetch = jest.fn().mockReturnValue(pending);
      mount();
      expect(
        screen.getByRole("status", { name: copy("loading") }),
      ).toBeInTheDocument();
      expect(fetch).toHaveBeenCalledTimes(4);
      await act(async () => release(response({}, false)));
      expect(
        screen.getByRole("heading", { name: copy("loadFailed") }),
      ).toBeInTheDocument();
      (fetch as jest.Mock).mockImplementation(async (input: string) =>
        response(
          input.includes("/cook?")
            ? {
                suggestions: [],
                recipesConsidered: 0,
                truncated: false,
                inputsTruncated: true,
              }
            : input.includes("/adjustments?")
              ? { adjustments: [] }
              : { items: [], nextOffset: null },
        ),
      );
      fireEvent.click(
        screen.getAllByRole("button", { name: copy("tryAgain") })[0],
      );
      await act(async () => {});
      expect(
        screen.getByRole("heading", { name: copy("nothingTracked") }),
      ).toBeInTheDocument();
      expect(screen.getByText(copy("emptyReader"))).toBeInTheDocument();
      expect(screen.getByTestId("cook-empty")).toHaveTextContent(
        copy("recipesEmptyCapped"),
      );
      expect(
        screen.queryByRole("button", { name: copy("addItem") }),
      ).toBeNull();
      expect(fetch).toHaveBeenCalledTimes(8);
    });
    it(`${locale} expanded=${expanded}: safety, recipes, history and private metadata remain role aware`, async () => {
      const recipe = {
        recipeId: "synthetic-recipe",
        title: privateName,
        totalCount: 2,
        haveCount: 1,
        missingCount: 1,
        useSoonCount: 1,
        have: [{ name: privateName }],
        missing: [
          {
            name: "Raw missing {name} 李",
            ingredientId: "synthetic-ingredient",
          },
        ],
      };
      global.fetch = jest
        .fn()
        .mockImplementation(async (input: string) =>
          response(
            input.includes("/cook?")
              ? {
                  suggestions: [recipe],
                  recipesConsidered: 1,
                  truncated: false,
                  inputsTruncated: true,
                }
              : input.includes("/adjustments?")
                ? {
                    adjustments: [
                      {
                        id: "synthetic-adjustment",
                        kind: "discard",
                        item_name: privateName,
                        status_after: "discarded",
                        amount_delta: null,
                        created_at: "2026-10-08T12:00:00Z",
                        undone_at: "2026-10-08T12:01:00Z",
                        undoable: true,
                      },
                    ],
                  }
                : input.includes("/use-soon?")
                  ? { items: [] }
                  : { items: [item], nextOffset: null },
          ),
        );
      mount();
      await act(async () => {});
      expect(screen.getByTestId("past-use-by")).toHaveTextContent(
        copy("pastSafety"),
      );
      expect(screen.getByTestId("what-can-i-cook")).toHaveTextContent(
        copy("recipesIncomplete"),
      );
      expect(screen.getByTestId("cook-suggestion")).toHaveTextContent(
        privateName,
      );
      expect(screen.getByTestId("cook-missing")).toHaveTextContent(
        "Raw missing {name} 李",
      );
      expect(screen.getByTestId("inventory-item")).toHaveTextContent(
        "2 raw {unit} 李",
      );
      expect(screen.getByTestId("inventory-history")).toHaveTextContent(
        copy("undone"),
      );
      expect(
        within(screen.getByTestId("inventory-history")).queryByRole("button"),
      ).toBeNull();
      expect(
        screen.queryByRole("link", { name: new RegExp(copy("viewRecipe")) }),
      ).toBeNull();
      expect(fetch).toHaveBeenCalledTimes(4);
    });
  }
it("keeps stale saved data and offline authority across language changes without locale reloads", async () => {
  let refusing = false;
  global.fetch = jest
    .fn()
    .mockImplementation(async (input: string) =>
      response(
        input.includes("/cook?")
          ? { suggestions: [], recipesConsidered: 0, truncated: false }
          : input.includes("/adjustments?")
            ? { adjustments: [] }
            : input.includes("/use-soon?")
              ? { items: [] }
              : { items: [item], nextOffset: null },
        !refusing,
      ),
    );
  render(
    <I18nProvider locale="en">
      <Switch />
      <ToastProvider>
        <InventoryClient canWrite canOpenRecipes={false} />
      </ToastProvider>
    </I18nProvider>,
  );
  await act(async () => {});
  Object.defineProperty(navigator, "onLine", {
    value: false,
    configurable: true,
  });
  act(() => window.dispatchEvent(new Event("offline")));
  expect(screen.getByTestId("inventory-connection")).toHaveTextContent(
    "Changes need a connection",
  );
  const count = (fetch as jest.Mock).mock.calls.length;
  fireEvent.click(screen.getByText("Switch"));
  expect(screen.getByTestId("inventory-connection")).toHaveTextContent(
    "Los cambios necesitan conexión",
  );
  expect(fetch).toHaveBeenCalledTimes(count);
  fireEvent.click(
    screen.getAllByRole("button", { name: "Añadir alimento" })[0],
  );
  expect(screen.queryByTestId("inventory-modal")).toBeNull();
  expect(screen.getByTestId("inventory-notice")).toHaveTextContent(
    inventoryMessages.es.offlineWrite,
  );
  expect(fetch).toHaveBeenCalledTimes(count);
  refusing = true;
  Object.defineProperty(navigator, "onLine", {
    value: true,
    configurable: true,
  });
  act(() => window.dispatchEvent(new Event("online")));
  await act(async () => {});
  expect(screen.getByTestId("inventory-connection")).toHaveTextContent(
    "No pudimos actualizar",
  );
  expect(screen.getByTestId("inventory-item")).toHaveTextContent(privateName);
  expect(fetch).toHaveBeenCalledTimes(count + 4);
});
