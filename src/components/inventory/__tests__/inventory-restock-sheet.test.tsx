/** @jest-environment jsdom */
/** Source only. Real storage, browser focus and cross-household QA remain deferred. */
import "@testing-library/jest-dom";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { I18nProvider } from "@/i18n";
import { InventoryRestockSheet } from "../InventoryRestockSheet";
import { readRestockReview } from "@/lib/inventory-restock-client";
const mockSend = jest.fn();
jest.mock("../InventoryRecovery", () => ({
  useInventoryWrites: () => ({ restock: mockSend }),
}));
jest.mock("@/lib/inventory-restock-client", () => ({
  ...jest.requireActual("@/lib/inventory-restock-client"),
  readRestockReview: jest.fn(),
  undoRestock: jest.fn(),
}));
const context = { userId: "fixture-parent", familyId: "fixture-family" };
const initial: Awaited<ReturnType<typeof readRestockReview>> = {
  ...context,
  item: {
    id: "fixture-stock",
    name: "Fixture beans",
    version: "2026-10-20T12:00:00.000Z",
  },
  lists: [{ id: "fixture-list", name: "Family groceries", type: "grocery" }],
  listsTruncated: false,
  selectedListId: null,
  existingSourceItemId: null,
  similar: [],
  comparisonIncomplete: false,
};
function mount() {
  return render(
    <I18nProvider locale="en">
      <InventoryRestockSheet
        itemId="fixture-stock"
        context={context}
        onClose={jest.fn()}
        onChanged={jest.fn()}
      />
    </I18nProvider>,
  );
}
beforeEach(() => {
  jest.clearAllMocks();
  Object.defineProperty(navigator, "onLine", {
    value: true,
    configurable: true,
  });
  jest
    .mocked(readRestockReview)
    .mockImplementation(async (_context, _item, list) => ({
      ...initial,
      selectedListId: list ?? null,
    }));
  mockSend.mockResolvedValue({ kind: "unknown" });
});
it("requires an explicit purchase amount/list review and retains identical bytes through an unknown retry", async () => {
  mount();
  await screen.findByText("Current source: Fixture beans");
  expect(screen.getByLabelText("Amount to buy")).toHaveValue(null);
  fireEvent.change(screen.getByLabelText("Grocery list"), {
    target: { value: "fixture-list" },
  });
  fireEvent.change(screen.getByLabelText("Amount to buy"), {
    target: { value: "3" },
  });
  fireEvent.change(screen.getByLabelText("Unit (optional)"), {
    target: { value: "cans" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Review replacement" }));
  await waitFor(() =>
    expect(
      screen.getByRole("button", { name: "Add replacement" }),
    ).toBeEnabled(),
  );
  fireEvent.click(screen.getByRole("button", { name: "Add replacement" }));
  await screen.findByRole("button", { name: "Check the same add" });
  expect(screen.getByLabelText("Item to buy")).toBeDisabled();
  const first = mockSend.mock.calls[0][0];
  fireEvent.click(screen.getByRole("button", { name: "Check the same add" }));
  await waitFor(() => expect(mockSend).toHaveBeenCalledTimes(2));
  expect(mockSend.mock.calls[1][0]).toBe(first);
  expect(JSON.parse(first.body)).toMatchObject({
    list_id: "fixture-list",
    amount: 3,
    unit: "cans",
  });
});
it("requires a separate-row choice when the named target contains similar food", async () => {
  jest
    .mocked(readRestockReview)
    .mockImplementation(async (_context, _item, list) => ({
      ...initial,
      selectedListId: list ?? null,
      similar: list
        ? [{ id: "fixture-existing", content: "Existing beans" }]
        : [],
    }));
  mount();
  await screen.findByText("Current source: Fixture beans");
  fireEvent.change(screen.getByLabelText("Grocery list"), {
    target: { value: "fixture-list" },
  });
  fireEvent.change(screen.getByLabelText("Amount to buy"), {
    target: { value: "1" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Review replacement" }));
  await screen.findByText("Existing beans");
  expect(
    screen.getByRole("button", { name: "Add replacement" }),
  ).toBeDisabled();
  fireEvent.click(
    screen.getByLabelText("Add a separate row even if similar items exist"),
  );
  expect(screen.getByRole("button", { name: "Add replacement" })).toBeEnabled();
});
