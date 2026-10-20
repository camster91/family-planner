/** @jest-environment jsdom */
import "@testing-library/jest-dom";
import {
  fireEvent,
  render,
  screen,
  within,
  waitFor,
} from "@testing-library/react";
import { I18nProvider } from "@/i18n";
import { ScanFridgeDialog } from "../ScanFridgeDialog";
import { FOOD_PHOTO_PROTOCOL } from "@/lib/food-photo-contract";
const json = (body: unknown) =>
  ({ ok: true, status: 200, json: async () => body }) as Response;
const item = {
  name: "Fixture beans",
  amount: null,
  unit: null,
  location: null,
  confidence: 0.99,
  package_size: "500 g",
  date_text: "Best before 2027-02-28",
  date_candidate: "2027-02-28",
  date_kind: "best_before",
};
function mount() {
  render(
    <I18nProvider locale="en">
      <ScanFridgeDialog
        canCaptureDocuments
        initialContext={{
          userId: "fixture-parent",
          familyId: "fixture-family",
        }}
        onClose={jest.fn()}
        onDone={jest.fn()}
      />
    </I18nProvider>,
  );
}
function upload() {
  fireEvent.change(screen.getByTestId("scan-file-input"), {
    target: {
      files: [new File(["fixture"], "label.png", { type: "image/png" })],
    },
  });
}
it("requires explicit selection/date apply and sends reviewed label size separately", async () => {
  const writes: RequestInit[] = [];
  global.fetch = jest.fn(async (url, init) => {
    if (String(url) === "/api/inventory/scan")
      return json({
        protocol: FOOD_PHOTO_PROTOCOL,
        capture_mode: "package",
        items: [item],
        dropped: 0,
      });
    writes.push(init!);
    return json({ itemId: "fixture-stock" });
  });
  mount();
  fireEvent.click(screen.getByRole("button", { name: "Package / date" }));
  upload();
  const row = await screen.findByTestId("scan-suggestion");
  expect(within(row).getByRole("checkbox")).not.toBeChecked();
  expect(within(row).getByLabelText("Date on the pack")).toHaveValue("");
  fireEvent.click(
    within(row).getByRole("button", { name: /Use .*2027-02-28/ }),
  );
  fireEvent.click(within(row).getByRole("checkbox"));
  fireEvent.click(screen.getByTestId("scan-add"));
  await waitFor(() => expect(writes).toHaveLength(1));
  expect(JSON.parse(String(writes[0].body))).toMatchObject({
    item: { expires_on: "2027-02-28", date_kind: "best_before", amount: null },
    label: { package_size: "500 g" },
  });
});
it("requires receipt redaction acknowledgement and pages unselected review rows", async () => {
  global.fetch = jest.fn(async () =>
    json({
      protocol: FOOD_PHOTO_PROTOCOL,
      capture_mode: "receipt",
      items: Array.from({ length: 6 }, (_, i) => ({
        ...item,
        name: `Fixture ${i}`,
        date_text: null,
        date_candidate: null,
        date_kind: null,
      })),
      dropped: 0,
    }),
  );
  mount();
  fireEvent.click(screen.getByRole("button", { name: "Receipt" }));
  expect(
    screen.getByRole("button", { name: "Take or choose a photo" }),
  ).toBeDisabled();
  upload();
  expect(fetch).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("checkbox", { name: /cropped or covered/ }));
  upload();
  await screen.findAllByTestId("scan-suggestion");
  expect(screen.getAllByTestId("scan-suggestion")).toHaveLength(1);
  for (const row of screen.getAllByTestId("scan-suggestion"))
    expect(within(row).getByRole("checkbox")).not.toBeChecked();
  fireEvent.click(screen.getByRole("button", { name: "Next" }));
  expect(screen.getAllByTestId("scan-suggestion")).toHaveLength(1);
  expect(screen.getByLabelText("Name")).toHaveValue("Fixture 1");
});
