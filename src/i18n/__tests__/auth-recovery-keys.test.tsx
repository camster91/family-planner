/** @jest-environment jsdom */
import "@testing-library/jest-dom";
import { fireEvent, render, screen } from "@testing-library/react";
import ForgotPasswordPage from "@/app/(auth)/forgot-password/page";
import { I18nProvider, messages as shared } from "@/i18n";
import { authRecoveryMessages as messages } from "../auth-recovery";
import { pseudolocalizeTemplate } from "../pseudo";
it("preserves key/parameter contracts and nonempty recovery translations", () => {
  expect(Object.keys(messages.en).sort()).toEqual(
    Object.keys(messages.es).sort(),
  );
  for (const [key, text] of Object.entries(messages.en)) {
    const translated = messages.es[key as keyof typeof messages.es];
    expect(translated.trim()).not.toBe("");
    expect((translated.match(/\{\w+\}/g) || []).sort()).toEqual(
      (text.match(/\{\w+\}/g) || []).sort(),
    );
  }
});
for (const locale of ["en", "es"] as const)
  for (const expanded of [false, true])
    it(`${locale} expanded=${expanded}: neutral confirmation leaves private email unchanged`, async () => {
      global.fetch = jest
        .fn()
        .mockResolvedValue({ ok: true, json: async () => ({}) });
      const privateEmail = "Private+{count}@example.test";
      const format = (text: string) =>
        expanded ? pseudolocalizeTemplate(text) : text;
      const { container } = render(
        <I18nProvider locale={locale} pseudolocalize={expanded}>
          <ForgotPasswordPage />
        </I18nProvider>,
      );
      fireEvent.change(
        screen.getByLabelText(format(shared[locale].auth.email)),
        { target: { value: privateEmail } },
      );
      fireEvent.submit(container.querySelector("form")!);
      await screen.findByRole("heading", {
        name: format(messages[locale].checkEmail),
      });
      expect(screen.getByText(privateEmail).textContent).toBe(privateEmail);
      expect(screen.getByText(privateEmail).parentElement?.textContent).toBe(
        format(messages[locale].emailBefore) +
          " " +
          privateEmail +
          format(messages[locale].emailAfter),
      );
      expect(
        screen.getByRole("link", {
          name: format(shared[locale].auth.backToSignIn),
        }),
      ).toHaveAttribute("href", "/login");
    });
