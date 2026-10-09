/** @jest-environment jsdom */
import "@testing-library/jest-dom";
import { render, screen } from "@testing-library/react";
import { I18nProvider } from "@/i18n";
import { InventoryText } from "@/app/dashboard/inventory/inventory-copy";
import { OFFLINE_WRITE_MESSAGE } from "@/app/dashboard/inventory/InventoryClient";
import { confidenceLabel } from "@/app/dashboard/inventory/ScanFridgeDialog";
import {
  inventoryMessages as messages,
  inventoryFeedbackEnglish,
  inventoryFeedback,
  expiryFeedback,
  photoAddedFeedback,
  partialScanFeedback,
} from "../inventory";
import {
  LOCATION_LABELS,
  DATE_KIND_LABELS,
  CATEGORY_LABELS,
  expiryLabel,
  type ExpiryStatus,
} from "@/lib/inventory";
import { pseudolocalizeTemplate } from "../pseudo";
it("has nonempty key and parameter parity and preserves canonical English identities", () => {
  expect(Object.keys(messages.en).sort()).toEqual(
    Object.keys(messages.es).sort(),
  );
  for (const [key, text] of Object.entries(messages.en)) {
    const spanish = messages.es[key as keyof typeof messages.es];
    expect(spanish.trim()).not.toBe("");
    expect((spanish.match(/\{\w+\}/g) ?? []).sort()).toEqual(
      (text.match(/\{\w+\}/g) ?? []).sort(),
    );
  }
  expect(messages.en.offlineWrite).toBe(OFFLINE_WRITE_MESSAGE);
  for (const labels of [LOCATION_LABELS, DATE_KIND_LABELS, CATEGORY_LABELS])
    for (const [key, text] of Object.entries(labels))
      expect(messages.en[key as keyof typeof messages.en]).toBe(text);
  expect([0, 0.49, 0.5, 0.79, 0.8, 1].map(confidenceLabel)).toEqual([
    "Unsure",
    "Unsure",
    "Check this",
    "Check this",
    "Likely",
    "Likely",
  ]);
  for (const status of [
    "none",
    "expired",
    "past_use_by",
    "today",
    "soon",
    "later",
  ] as ExpiryStatus[])
    for (const days of [null, -30, -1, 0, 1, 2, 30])
      for (const kind of ["best_before", "use_by"] as const) {
        const text = expiryLabel(status, days, kind);
        expect(inventoryFeedbackEnglish(expiryFeedback(text))).toBe(text);
      }
  expect(expiryFeedback("Future raw label {days} 李")).toEqual({
    raw: "Future raw label {days} 李",
  });
});
it("retains exact legacy singular/plural reports including zero, and interpolates private values only once", () => {
  for (const n of [0, 1, 2])
    expect(inventoryFeedbackEnglish(photoAddedFeedback(n))).toBe(
      `Added ${n} item${n === 1 ? "" : "s"} from your photo.`,
    );
  for (const count of [0, 1, 2])
    for (const failed of [1, 2])
      expect(inventoryFeedbackEnglish(partialScanFeedback(count, failed))).toBe(
        `Added ${count} item${count === 1 ? "" : "s"}. ${failed} couldn't be added; check ${failed === 1 ? "it" : "them"} and try again.`,
      );
  expect(
    inventoryFeedbackEnglish(
      inventoryFeedback("usedAmount", {
        name: "Synthetic {amount} 李",
        amount: "1.5 raw {name} 李",
      }),
    ),
  ).toBe("Used 1.5 raw {name} 李 of Synthetic {amount} 李");
});
for (const locale of ["en", "es"] as const)
  for (const expanded of [false, true]) {
    it(`${locale} expanded=${expanded}: owned stored feedback follows scoped mode with raw parameters intact`, () => {
      const name = "Synthetic {amount} <b>李</b>";
      const amount = "1.5 raw {name} 李";
      const format = (s: string) => (expanded ? pseudolocalizeTemplate(s) : s);
      render(
        <I18nProvider locale={locale} pseudolocalize={expanded}>
          <p data-testid="message">
            <InventoryText
              feedback={inventoryFeedback("usedAmount", { name, amount })}
            />
          </p>
          <p data-testid="raw">
            <InventoryText feedback={{ raw: "Raw refusal {name} <b>李</b>" }} />
          </p>
          <p data-testid="privacy">
            <InventoryText
              feedback={inventoryFeedback("scanPrivacy", {
                brand: "Herewoven",
                provider: "Anthropic",
              })}
            />
          </p>
        </I18nProvider>,
      );
      expect(screen.getByTestId("message").textContent).toBe(
        format(messages[locale].usedAmount)
          .replace("{name}", name)
          .replace("{amount}", amount),
      );
      expect(screen.getByTestId("raw").textContent).toBe(
        "Raw refusal {name} <b>李</b>",
      );
      expect(screen.getByTestId("privacy").textContent).toBe(
        format(messages[locale].scanPrivacy)
          .replace("{provider}", "Anthropic")
          .replace("{brand}", "Herewoven"),
      );
      expect(document.querySelector("b")).toBeNull();
    });
  }
