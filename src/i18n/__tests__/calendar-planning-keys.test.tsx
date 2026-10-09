/** @jest-environment jsdom */
import * as React from "react";
import { render, screen } from "@testing-library/react";
import { I18nProvider, useTranslation } from "@/i18n";
import { calendarPlannerMessages } from "../calendar-planner";
import { calendarImportMessages } from "../calendar-import";
import { calendarPageMessages } from "../calendar-page";
import { syncStatusMessages } from "../sync-status";
import { pseudolocalizeTemplate } from "../pseudo";
for (const [name, messages] of Object.entries({
  planner: calendarPlannerMessages,
  imports: calendarImportMessages,
  page: calendarPageMessages,
  sync: syncStatusMessages,
}))
  it(`${name} languages cover identical nonempty keys and interpolation contracts`, () => {
    expect(Object.keys(messages.es).sort()).toEqual(
      Object.keys(messages.en).sort(),
    );
    for (const [key, english] of Object.entries(messages.en)) {
      const spanish = (messages.es as Record<string, string>)[key];
      expect(spanish.trim()).not.toBe("");
      expect((spanish.match(/\{\w+\}/g) || []).sort()).toEqual(
        (english.match(/\{\w+\}/g) || []).sort(),
      );
    }
  });
const privateText = "Fixture {source} {title} 🗓️";
function Probe() {
  const { t } = useTranslation();
  return (
    <p data-testid="source">
      {t("ics", { source: privateText }, calendarPlannerMessages)}
    </p>
  );
}
for (const locale of ["en", "es"] as const)
  for (const expanded of [false, true])
    it(`${locale} expanded=${expanded} never expands or interprets private source parameters`, () => {
      render(
        <I18nProvider locale={locale} pseudolocalize={expanded}>
          <Probe />
        </I18nProvider>,
      );
      const template = calendarPlannerMessages[locale].ics;
      expect(screen.getByTestId("source").textContent).toBe(
        (expanded ? pseudolocalizeTemplate(template) : template).replace(
          "{source}",
          privateText,
        ),
      );
    });
