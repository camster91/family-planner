/** @jest-environment jsdom */
import "@testing-library/jest-dom";
import {
  act,
  fireEvent,
  render,
  screen,
  within,
  waitFor,
} from "@testing-library/react";
import { I18nProvider } from "@/i18n";
import { ToastProvider } from "@/components/ui/toast";
import InventoryClient from "../InventoryClient";
import {
  INVENTORY_READ_SCOPE_HEADER,
  inventoryReadScopeValue,
} from "@/lib/inventory-read-scope";
jest.mock("@/components/providers/features-provider", () => ({
  useFeatureEnabled: () => false,
}));
const context = { userId: "fixture-parent", familyId: "fixture-family" };
const scope = inventoryReadScopeValue(context);
const item = {
  id: "fixture-item",
  name: "Private fixture beans",
  amount: 2,
  unit: "cans",
  location: "pantry",
  expires_on: null,
  expiry: { status: "none", daysLeft: null },
  updated_at: "2026-10-19T12:00:00.000Z",
};
function json(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers({ [INVENTORY_READ_SCOPE_HEADER]: scope }),
    json: async () => body,
  } as Response;
}
function auxiliary(url: string) {
  return json(
    url.includes("/adjustments?") ? { adjustments: [] } : { items: [] },
  );
}
function mount() {
  return render(
    <I18nProvider locale="en">
      <ToastProvider>
        <InventoryClient
          canWrite
          canOpenRecipes={false}
          intakeContext={context}
        />
      </ToastProvider>
    </I18nProvider>,
  );
}
beforeEach(() =>
  Object.defineProperty(navigator, "onLine", {
    value: true,
    configurable: true,
  }),
);
it("hides private cached stock on access loss and only restores it after the same scope is confirmed", async () => {
  let denied = false;
  global.fetch = jest.fn(async (url) =>
    denied
      ? json({}, 403)
      : String(url).startsWith("/api/inventory?")
        ? json({ items: [item], nextOffset: null })
        : auxiliary(String(url)),
  );
  mount();
  await screen.findByText(item.name);
  denied = true;
  fireEvent.click(screen.getByRole("button", { name: "Refresh inventory" }));
  await screen.findByRole("heading", {
    name: "Inventory access needs checking",
  });
  expect(screen.queryByText(item.name)).not.toBeInTheDocument();
  denied = false;
  fireEvent.click(screen.getByRole("button", { name: "Try again" }));
  expect(await screen.findByText(item.name)).toBeInTheDocument();
});
it("drops a late older refresh after a confirmed create starts a newer one", async () => {
  let listRead = 0;
  let resolveOlder!: (response: Response) => void;
  const older = new Promise<Response>((resolve) => {
    resolveOlder = resolve;
  });
  global.fetch = jest.fn(async (url, init) => {
    if (String(url) === "/api/inventory/intake" && init?.method === "POST")
      return json({ itemId: "fixture-created" }, 201);
    if (String(url).startsWith("/api/inventory?")) {
      listRead++;
      if (listRead === 2) return older;
      return json({
        items: [
          { ...item, name: listRead > 2 ? "Newer confirmed stock" : item.name },
        ],
        nextOffset: null,
      });
    }
    return auxiliary(String(url));
  });
  mount();
  await screen.findByText(item.name);
  fireEvent.click(screen.getByRole("button", { name: "Refresh inventory" }));
  fireEvent.click(screen.getAllByRole("button", { name: "Add item" })[0]);
  const dialog = await screen.findByTestId("inventory-modal");
  fireEvent.change(within(dialog).getByLabelText("Name"), {
    target: { value: "Created food" },
  });
  fireEvent.click(within(dialog).getByRole("button", { name: "Save" }));
  await screen.findByText("Newer confirmed stock");
  await act(async () =>
    resolveOlder(
      json({
        items: [{ ...item, name: "Outdated response" }],
        nextOffset: null,
      }),
    ),
  );
  expect(screen.queryByText("Outdated response")).not.toBeInTheDocument();
  expect(screen.getByText("Newer confirmed stock")).toBeInTheDocument();
});
it("discloses failed history refresh and disables stale Undo without deleting earlier entries", async () => {
  let failHistory = false;
  global.fetch = jest.fn(async (url) =>
    String(url).startsWith("/api/inventory?")
      ? json({ items: [item], nextOffset: null })
      : String(url).includes("/adjustments?")
        ? failHistory
          ? json({}, 503)
          : json({
              adjustments: [
                {
                  id: "fixture-adjustment",
                  item_name: item.name,
                  kind: "consume",
                  amount_delta: -1,
                  created_at: "2026-10-19T11:00:00.000Z",
                  undoable: true,
                },
              ],
            })
        : auxiliary(String(url)),
  );
  mount();
  const history = await screen.findByTestId("inventory-history");
  expect(
    within(history).getByRole("button", { name: /^Undo/ }),
  ).toBeInTheDocument();
  failHistory = true;
  fireEvent.click(screen.getByRole("button", { name: "Refresh inventory" }));
  await screen.findByText(
    "History could not be refreshed. Earlier entries are shown without Undo until the next successful refresh.",
  );
  await waitFor(() =>
    expect(within(history).queryByRole("button", { name: /^Undo/ })).toBeNull(),
  );
});
