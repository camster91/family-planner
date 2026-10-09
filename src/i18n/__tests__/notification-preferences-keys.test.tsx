/** @jest-environment jsdom */
import * as React from "react";
import { render, screen } from "@testing-library/react";
import { I18nProvider, useTranslation } from "@/i18n";
import { notificationPreferencesMessages as messages } from "../notification-preferences";
import {
  CATEGORY_COPY,
  MORNING_SUMMARY_COPY,
  NOTIFICATION_CATEGORIES,
} from "@/lib/notification-policy";
import { formatClock } from "@/components/account/NotificationPreferences";
import { quietHoursProblem } from "@/lib/quiet-hours";
import { pseudolocalizeTemplate } from "../pseudo";
it("keeps dictionary keys, nonempty translations and placeholder contracts aligned", () => {
  expect(Object.keys(messages.en).sort()).toEqual(
    Object.keys(messages.es).sort(),
  );
  for (const [key, english] of Object.entries(messages.en)) {
    const spanish = messages.es[key as keyof typeof messages.es];
    expect(spanish.trim()).not.toBe("");
    expect((spanish.match(/\{\w+\}/g) || []).sort()).toEqual(
      (english.match(/\{\w+\}/g) || []).sort(),
    );
  }
});
it("retains canonical policy copy and pure quiet validation defaults", () => {
  for (const category of NOTIFICATION_CATEGORIES) {
    expect(messages.en[`${category}Label`]).toBe(CATEGORY_COPY[category].label);
    expect(messages.en[`${category}Description`]).toBe(
      CATEGORY_COPY[category].description,
    );
  }
  expect(messages.en.summaryLabel).toBe(MORNING_SUMMARY_COPY.label);
  expect(messages.en.summaryDescription).toBe(MORNING_SUMMARY_COPY.description);
  expect(messages.en.summaryOn).toBe(MORNING_SUMMARY_COPY.whenOn);
  expect(messages.en.summaryOff).toBe(MORNING_SUMMARY_COPY.whenOff);
  expect(quietHoursProblem("", "07:00")).toBe(messages.en.chooseTimes);
  expect(quietHoursProblem("22:00", "22:00")).toBe(messages.en.differentTimes);
  expect(quietHoursProblem("22:00", "07:00")).toBeNull();
});
it("formats presentation language while retaining the default and malformed clock compatibility", () => {
  expect(formatClock("22:00", "es")).toBe("22:00");
  expect(formatClock("22:00", "en")).toBe("10:00 PM");
  expect(formatClock("not a time", "es")).toBe("not a time");
  const spy = jest
    .spyOn(Date.prototype, "toLocaleTimeString")
    .mockReturnValue("native\u202fclock");
  expect(formatClock("22:00")).toBe("native clock");
  expect(spy).toHaveBeenCalledWith(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
  spy.mockRestore();
});
const zone = " (Synthetic/{zone} — 李)";
function Probe() {
  const { t } = useTranslation();
  return <p data-testid="zone">{t("zoneHint", { zone }, messages)}</p>;
}
for (const locale of ["en", "es"] as const)
  for (const expanded of [false, true])
    it(`${locale} expanded=${expanded} preserves private zone interpolation`, () => {
      render(
        <I18nProvider locale={locale} pseudolocalize={expanded}>
          <Probe />
        </I18nProvider>,
      );
      const template = messages[locale].zoneHint;
      expect(screen.getByTestId("zone").textContent).toBe(
        (expanded ? pseudolocalizeTemplate(template) : template).replace(
          "{zone}",
          zone,
        ),
      );
    });
