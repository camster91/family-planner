/** @jest-environment jsdom */
import * as React from "react";
import { render, screen } from "@testing-library/react";
import { I18nProvider, useTranslation } from "@/i18n";
import { navigationMessages, navigationTabKey } from "../navigation";
import { offlineBannerMessages } from "../offline-banner";
import { tabsFor } from "@/lib/nav-items";
import { defaultFeatures } from "@/lib/features";
import { OFFLINE_TEXT, BACK_ONLINE_TEXT } from "@/components/ui/offline-banner";
import { pseudolocalizeTemplate } from "../pseudo";
for (const [name, messages] of Object.entries({
  navigation: navigationMessages,
  offline: offlineBannerMessages,
}))
  it(`${name} has matching nonempty keys and interpolation contracts`, () => {
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
it("covers canonical role tabs by href without altering pure English defaults or gate policy", () => {
  for (const role of ["parent", "teen", "child"])
    for (const features of [
      defaultFeatures(),
      {
        ...defaultFeatures(),
        calendar: false,
        meals: false,
        lists: false,
        emergency: false,
        family: false,
      },
    ])
      for (const tab of tabsFor(role, features)) {
        const key = navigationTabKey(tab.href);
        expect(key).not.toBeNull();
        expect(navigationMessages.en[key!]).toBe(tab.label);
        expect(navigationMessages.es[key!]).toBeTruthy();
      }
  for (const unknown of ["/other", "constructor", "__proto__"])
    expect(navigationTabKey(unknown)).toBeNull();
});
it("retains exact English offline constants for existing callers", () => {
  expect(offlineBannerMessages.en.offline).toBe(OFFLINE_TEXT);
  expect(offlineBannerMessages.en.back).toBe(BACK_ONLINE_TEXT);
});
const privateBrand = "Synthetic {brand} — 李";
function Probe() {
  const { t } = useTranslation();
  return (
    <p data-testid="home">
      {t("home", { brand: privateBrand }, navigationMessages)}
    </p>
  );
}
for (const locale of ["en", "es"] as const)
  for (const expanded of [false, true])
    it(`${locale} expanded=${expanded} preserves private brand interpolation`, () => {
      render(
        <I18nProvider locale={locale} pseudolocalize={expanded}>
          <Probe />
        </I18nProvider>,
      );
      const template = navigationMessages[locale].home;
      expect(screen.getByTestId("home").textContent).toBe(
        (expanded ? pseudolocalizeTemplate(template) : template).replace(
          "{brand}",
          privateBrand,
        ),
      );
    });
