/** @jest-environment jsdom */
import * as React from "react";
import { render, screen } from "@testing-library/react";
import { I18nProvider, useTranslation } from "@/i18n";
import {
  calendarFormsEnglish,
  calendarFormsSpanish,
  calendarFormMessages,
} from "../calendar-forms";
import { pseudolocalizeTemplate } from "../pseudo";
it("route-owned languages match keys and parameter contracts with no empty copy", () => {
  expect(Object.keys(calendarFormsSpanish).sort()).toEqual(
    Object.keys(calendarFormsEnglish).sort(),
  );
  for (const [key, text] of Object.entries(calendarFormsEnglish)) {
    const translated =
      calendarFormsSpanish[key as keyof typeof calendarFormsEnglish];
    expect(translated.trim()).not.toBe("");
    expect((translated.match(/\{\w+\}/g) || []).sort()).toEqual(
      (text.match(/\{\w+\}/g) || []).sort(),
    );
  }
});
const privateText = "Fixture {title} {source} 🗓️";
function Probe() {
  const { t } = useTranslation();
  return (
    <>
      <p data-testid="source">
        {t("from", { source: privateText }, calendarFormMessages)}
      </p>
      <p data-testid="delete">
        {t("deleteDescription", { title: privateText }, calendarFormMessages)}
      </p>
    </>
  );
}
for (const locale of ["en", "es"] as const)
  for (const expanded of [false, true])
    it(`${locale} expanded=${expanded} interpolates household/source text verbatim`, () => {
      render(
        <I18nProvider locale={locale} pseudolocalize={expanded}>
          <Probe />
        </I18nProvider>,
      );
      const copy = calendarFormMessages[locale];
      expect(screen.getByTestId("source").textContent).toBe(
        (expanded ? pseudolocalizeTemplate(copy.from) : copy.from).replace(
          "{source}",
          privateText,
        ),
      );
      expect(screen.getByTestId("delete").textContent).toBe(
        (expanded
          ? pseudolocalizeTemplate(copy.deleteDescription)
          : copy.deleteDescription
        ).replace("{title}", privateText),
      );
    });
