/** @jest-environment jsdom */
import "@testing-library/jest-dom";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { useState } from "react";
import { I18nProvider, useTranslation } from "@/i18n";
import { inventoryMessages, type InventoryFeedback } from "@/i18n/inventory";
import { pseudolocalizeTemplate } from "@/i18n/pseudo";
import { InventoryText } from "../inventory-copy";
import { ScanFridgeDialog } from "../ScanFridgeDialog";
const raw = "Synthetic {name} <b>李</b>";
const rows = [
  {
    name: raw,
    unit: "raw {unit} 李",
    amount: 2,
    location: "fridge",
    confidence: 0.95,
  },
  {
    name: "Synthetic second",
    unit: null,
    amount: null,
    location: "pantry",
    confidence: 0.6,
  },
  {
    name: "Synthetic doubtful",
    unit: null,
    amount: null,
    location: "freezer",
    confidence: 0.2,
  },
];
const json = (body: unknown, ok = true) =>
  ({ ok, status: ok ? 200 : 422, json: async () => body }) as Response;
function upload() {
  fireEvent.change(screen.getByTestId("scan-file-input"), {
    target: {
      files: [new File(["synthetic"], "synthetic.png", { type: "image/png" })],
    },
  });
}
for (const locale of ["en", "es"] as const)
  for (const expanded of [false, true]) {
    const copy = (key: keyof typeof inventoryMessages.en) =>
      expanded
        ? pseudolocalizeTemplate(inventoryMessages[locale][key])
        : inventoryMessages[locale][key];
    it(`${locale} expanded=${expanded}: actual scan fields preserve private values, confidence and canonical selections`, async () => {
      global.fetch = jest.fn().mockResolvedValue(json({ items: rows }));
      render(
        <I18nProvider locale={locale} pseudolocalize={expanded}>
          <ScanFridgeDialog onDone={jest.fn()} onClose={jest.fn()} />
        </I18nProvider>,
      );
      expect(
        screen.getByRole("dialog", { name: copy("scanTitle") }),
      ).toBeInTheDocument();
      expect(screen.getByTestId("scan-privacy-note")).toHaveTextContent(
        "Anthropic",
      );
      expect(screen.getByTestId("scan-privacy-note")).toHaveTextContent(
        "Herewoven",
      );
      upload();
      await act(async () => {});
      const suggestions = screen.getAllByTestId("scan-suggestion");
      for (const [i, row] of suggestions.entries()) {
        expect(within(row).getByLabelText(copy("name"))).toHaveValue(
          rows[i].name,
        );
        expect(within(row).getByLabelText(copy("where"))).toHaveValue(
          rows[i].location,
        );
        expect(within(row).getByRole("checkbox").hasAttribute("checked")).toBe(
          i < 2,
        );
        expect(within(row).getByTestId("scan-confidence")).toHaveTextContent(
          copy(i === 0 ? "likely" : i === 1 ? "checkConfidence" : "unsure"),
        );
      }
      expect(within(suggestions[0]).getByLabelText(copy("unit"))).toHaveValue(
        "raw {unit} 李",
      );
      expect(document.querySelector("b")).toBeNull();
      expect(fetch).toHaveBeenCalledTimes(1);
    });
    it(`${locale} expanded=${expanded}: collision refusal preserves its deliberate unticked state and raw other refusal`, async () => {
      let calls = 0;
      global.fetch = jest
        .fn()
        .mockImplementation(async (input: string) =>
          input === "/api/inventory/scan"
            ? json({ items: rows })
            : json(
                {
                  error:
                    ++calls === 1
                      ? {
                          code: "IDEMPOTENCY_KEY_REUSED",
                          message: "Raw collision",
                        }
                      : { message: "Raw refusal {name} 李" },
                },
                false,
              ),
        );
      render(
        <I18nProvider locale={locale} pseudolocalize={expanded}>
          <ScanFridgeDialog onDone={jest.fn()} onClose={jest.fn()} />
        </I18nProvider>,
      );
      upload();
      await act(async () => {});
      fireEvent.click(screen.getByTestId("scan-add"));
      await act(async () => {});
      const suggestions = screen.getAllByTestId("scan-suggestion");
      expect(within(suggestions[0]).getByRole("checkbox")).not.toBeChecked();
      expect(
        within(suggestions[0]).getByTestId("scan-row-error"),
      ).toHaveTextContent(copy("probablyAdded"));
      expect(within(suggestions[1]).getByRole("checkbox")).toBeChecked();
      expect(
        within(suggestions[1]).getByTestId("scan-row-error"),
      ).toHaveTextContent("Raw refusal {name} 李");
      expect(within(suggestions[2]).getByRole("checkbox")).not.toBeChecked();
      expect(fetch).toHaveBeenCalledTimes(3);
    });
  }
it("reports one semantic partial-close result while legacy callbacks remain untouched, and visible result follows locale", async () => {
  const legacy = jest.fn();
  const closed = jest.fn();
  let creates = 0;
  global.fetch = jest
    .fn()
    .mockImplementation(async (input: string) =>
      input === "/api/inventory/scan"
        ? json({ items: rows })
        : ++creates === 1
          ? json({})
          : json({}, false),
    );
  function Host() {
    const { setLocale } = useTranslation();
    const [notice, setNotice] = useState<InventoryFeedback | null>(null);
    const [open, setOpen] = useState(true);
    return (
      <>
        <button onClick={() => setLocale("es")}>Switch</button>
        {notice && (
          <p data-testid="notice">
            <InventoryText feedback={notice} />
          </p>
        )}
        {open && (
          <ScanFridgeDialog
            onDone={legacy}
            onClose={closed}
            onFeedback={(value) => {
              setNotice(value);
              setOpen(false);
            }}
          />
        )}
      </>
    );
  }
  render(
    <I18nProvider locale="en">
      <Host />
    </I18nProvider>,
  );
  upload();
  await act(async () => {});
  fireEvent.click(screen.getByTestId("scan-add"));
  await act(async () => {});
  fireEvent.click(screen.getByRole("button", { name: "Close" }));
  expect(screen.getByTestId("notice")).toHaveTextContent(
    "Added 1 item from your photo.",
  );
  fireEvent.click(screen.getByText("Switch"));
  expect(screen.getByTestId("notice")).toHaveTextContent(
    "Se añadió 1 alimento de tu foto.",
  );
  expect(legacy).not.toHaveBeenCalled();
  expect(closed).not.toHaveBeenCalled();
  expect(fetch).toHaveBeenCalledTimes(3);
  expect(screen.queryByTestId("scan-dialog")).toBeNull();
});
