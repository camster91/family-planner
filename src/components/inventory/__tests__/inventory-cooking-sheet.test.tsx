/** @jest-environment jsdom */
/** Authored only. Mounted/browser journeys remain for the final QA pass. */
import "@testing-library/jest-dom";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { InventoryCookingSheet } from "../InventoryCookingSheet";
import { I18nProvider } from "@/i18n";
import { inventoryReadScopeValue } from "@/lib/inventory-read-scope";
import { inventoryReadItem } from "@/lib/inventory-read-contract";
const scope = { userId: "fixture-parent", familyId: "fixture-family" };
const source = { kind: "recipe" as const, id: "fixture-recipe", servings: 4 };
const data = {
  ...scope,
  source,
  title: "Fixture meal",
  basis: "current-recipe",
  baseServings: 2,
  targetServings: 4,
  lines: [
    {
      id: "line-a",
      ingredientId: "beans",
      name: "Fixture beans",
      amount: 200,
      unit: "g",
    },
  ],
};
const lot = inventoryReadItem.parse({
  id: "lot-a",
  name: "Fixture beans",
  ingredient_id: "beans",
  amount: 2,
  unit: "cans",
  location: "pantry",
  updated_at: "2026-10-20T12:00:00.000Z",
  expiry: { status: "later", daysLeft: 10 },
});
const mockFetch = jest.fn();
beforeEach(() => {
  jest.clearAllMocks();
  global.fetch = mockFetch;
  mockFetch.mockResolvedValue({
    ok: true,
    headers: new Headers({
      "X-Herewoven-Inventory-Scope": inventoryReadScopeValue(scope),
    }),
    json: async () => data,
  });
});
it("shows recipe amounts as guidance and opens the exact chosen lot without sending a stock mutation", async () => {
  const onChoose = jest.fn();
  render(
    <I18nProvider locale="en">
      <InventoryCookingSheet
        source={source}
        context={scope}
        items={[lot]}
        capped={false}
        suspended={false}
        disabled={false}
        onChoose={onChoose}
        onClose={jest.fn()}
      />
    </I18nProvider>,
  );
  await screen.findByText("Fixture meal");
  const summary = screen.getByText(/Fixture beans · 400 g/);
  fireEvent.click(summary);
  fireEvent.click(screen.getByRole("button", { name: "Review amount used" }));
  expect(onChoose).toHaveBeenCalledWith(lot);
  expect(mockFetch).toHaveBeenCalledTimes(1);
  expect(mockFetch.mock.calls[0][0]).toContain(
    "/api/inventory/cooking-review?",
  );
  expect(mockFetch.mock.calls[0][1]).not.toHaveProperty("method", "POST");
});
it("does not read a private reply without the original scope echo", async () => {
  const json = jest.fn(async () => data);
  mockFetch.mockResolvedValue({ ok: true, headers: new Headers(), json });
  render(
    <I18nProvider locale="en">
      <InventoryCookingSheet
        source={source}
        context={scope}
        items={[lot]}
        capped={false}
        suspended={false}
        disabled={false}
        onChoose={jest.fn()}
        onClose={jest.fn()}
      />
    </I18nProvider>,
  );
  await screen.findByRole("alert");
  expect(json).not.toHaveBeenCalled();
  expect(screen.queryByText("Fixture meal")).not.toBeInTheDocument();
});
it("conceals recipe content when inventory ownership is suspended", async () => {
  const props = {
    source,
    context: scope,
    items: [lot],
    capped: false,
    disabled: false,
    onChoose: jest.fn(),
    onClose: jest.fn(),
  };
  const view = render(
    <I18nProvider locale="en">
      <InventoryCookingSheet {...props} suspended={false} />
    </I18nProvider>,
  );
  await screen.findByText("Fixture meal");
  view.rerender(
    <I18nProvider locale="en">
      <InventoryCookingSheet {...props} suspended />
    </I18nProvider>,
  );
  await waitFor(() =>
    expect(screen.queryByText("Fixture meal")).not.toBeInTheDocument(),
  );
});
