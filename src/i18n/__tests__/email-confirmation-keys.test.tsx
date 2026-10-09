/** @jest-environment jsdom */
import "@testing-library/jest-dom";
import { render, screen } from "@testing-library/react";
import { I18nProvider, useTranslation } from "@/i18n";
import { PRODUCT_BRAND } from "@/lib/brand";
import { VERIFY_MESSAGES } from "@/lib/verify-email";
import VerifyEmailPage from "@/app/(auth)/verify-email/page";
import { emailConfirmationMessages as messages } from "../email-confirmation";
import { pseudolocalizeTemplate } from "../pseudo";

jest.mock("next/navigation", () => ({
  useRouter: () => ({ replace: jest.fn() }),
  useSearchParams: () => new URLSearchParams({ token: "synthetic-only-token" }),
}));
it("keeps nonempty keys and interpolation contracts aligned, and canonical English outcomes exact", () => {
  expect(Object.keys(messages.en).sort()).toEqual(
    Object.keys(messages.es).sort(),
  );
  for (const [key, text] of Object.entries(messages.en)) {
    const value = messages.es[key as keyof typeof messages.es];
    expect(value.trim()).not.toBe("");
    expect((value.match(/\{\w+\}/g) ?? []).sort()).toEqual(
      (text.match(/\{\w+\}/g) ?? []).sort(),
    );
  }
  for (const [key, text] of Object.entries(VERIFY_MESSAGES))
    expect(messages.en[key as keyof typeof VERIFY_MESSAGES]).toBe(text);
});
for (const locale of ["en", "es"] as const)
  for (const expanded of [false, true])
    it(`${locale} expanded=${expanded}: renders scoped labels and preserves substituted brand`, () => {
      const format = (text: string) =>
        expanded ? pseudolocalizeTemplate(text) : text;
      global.fetch = jest.fn();
      render(
        <I18nProvider locale={locale} pseudolocalize={expanded}>
          <VerifyEmailPage />
        </I18nProvider>,
      );
      expect(
        screen.getByRole("heading", { name: format(messages[locale].title) }),
      ).toBeInTheDocument();
      expect(
        screen.getByText(
          format(messages[locale].instruction).replace(
            "{brand}",
            PRODUCT_BRAND.name,
          ),
        ),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: format(messages[locale].confirm) }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("link", { name: format(messages[locale].signIn) }),
      ).toHaveAttribute("href", "/login");
      expect(fetch).not.toHaveBeenCalled();
    });
it("does not pseudotransform or recursively interpolate supplied parameter text", () => {
  const raw = "Synthetic {brand} 李";
  function Probe() {
    const { t } = useTranslation();
    return <p>{t("instruction", { brand: raw }, messages)}</p>;
  }
  render(
    <I18nProvider locale="es" pseudolocalize>
      <Probe />
    </I18nProvider>,
  );
  expect(
    screen.getByText(
      pseudolocalizeTemplate(messages.es.instruction).replace("{brand}", raw),
    ).textContent,
  ).toContain(raw);
});
