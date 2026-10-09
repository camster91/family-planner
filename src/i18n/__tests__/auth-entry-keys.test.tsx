/** @jest-environment jsdom */
import "@testing-library/jest-dom";
import { act, render, screen } from "@testing-library/react";
import { I18nProvider, useTranslation } from "@/i18n";
import {
  authEntryMessages as messages,
  authEntryArrivalKey,
  authEntryRoleKey,
} from "../auth-entry";
import { pseudolocalizeTemplate } from "../pseudo";
import { loginNoticeFor } from "@/lib/safe-redirect";
import LoginPage from "@/app/(auth)/login/page";
import RegisterPage from "@/app/(auth)/register/page";
jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: jest.fn(), refresh: jest.fn() }),
}));
jest.mock("@/lib/offline-queue-browser", () => ({
  clearAllPersonQueues: jest.fn(),
}));
beforeEach(() => {
  window.history.replaceState({}, "", "/login");
  global.fetch = jest.fn();
});
it("has nonempty EN/ES key and parameter parity; maps canonical arrival identity without changing query policy", () => {
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
  for (const [query, key] of [
    ["verified=1&error=server", "verified"],
    ["error=invalid_token", "invalidToken"],
    ["error=missing_token", "missingToken"],
    ["error=server", "verificationError"],
  ] as const) {
    const notice = loginNoticeFor(new URLSearchParams(query))!;
    expect(messages.en[key]).toBe(notice.text);
    expect(authEntryArrivalKey(notice.text)).toBe(key);
  }
  expect(authEntryArrivalKey("Future raw notice {private} 李")).toBeUndefined();
  expect(authEntryRoleKey("Unknown raw role 李")).toBeUndefined();
});
for (const locale of ["en", "es"] as const)
  for (const expanded of [false, true]) {
    it(`${locale} expanded=${expanded}: renders placeholders, reveal and arrival without mutation`, () => {
      const format = (s: string) => (expanded ? pseudolocalizeTemplate(s) : s);
      window.history.replaceState(
        {},
        "",
        "/login?verified=1&deleted=household",
      );
      render(
        <I18nProvider locale={locale} pseudolocalize={expanded}>
          <LoginPage />
        </I18nProvider>,
      );
      expect(
        screen.getByPlaceholderText(format(messages[locale].emailPlaceholder)),
      ).toHaveAttribute("autocomplete", "username");
      expect(
        screen.getByRole("button", {
          name: format(messages[locale].showPassword),
        }),
      ).toBeInTheDocument();
      expect(
        screen.getByText(format(messages[locale].verified)),
      ).toHaveAttribute("role", "status");
      expect(
        screen.getByText(format(messages[locale].householdDeleted)),
      ).toHaveAttribute("role", "status");
      expect(fetch).not.toHaveBeenCalled();
    });
    it(`${locale} expanded=${expanded}: preserves invited private values and raw unknown role in actual registration`, async () => {
      const familyName = "Synthetic {familyName} 李";
      const role = "Unknown {role} 李";
      const email = "synthetic@example.test";
      window.history.replaceState({}, "", "/register?token=synthetic");
      (fetch as jest.Mock).mockResolvedValue({
        ok: true,
        json: async () => ({ familyName, role, email }),
      });
      const format = (s: string) => (expanded ? pseudolocalizeTemplate(s) : s);
      render(
        <I18nProvider locale={locale} pseudolocalize={expanded}>
          <RegisterPage />
        </I18nProvider>,
      );
      await act(async () => {});
      expect(
        screen.getByText(
          format(messages[locale].invitation)
            .replace("{familyName}", familyName)
            .replace("{role}", role),
        ),
      ).toBeInTheDocument();
      expect(
        screen.getByPlaceholderText(format(messages[locale].emailPlaceholder)),
      ).toHaveValue(email);
      expect(
        screen.getByPlaceholderText(format(messages[locale].namePlaceholder)),
      ).toBeInTheDocument();
      expect(fetch).toHaveBeenCalledTimes(1);
    });
  }
it("substitutes private parameters after expansion without recursive interpolation", () => {
  function Probe() {
    const { t } = useTranslation();
    return (
      <p>
        {t(
          "invitation",
          { familyName: "Synthetic {role} 李", role: "Unknown {familyName}" },
          messages,
        )}
      </p>
    );
  }
  render(
    <I18nProvider locale="es" pseudolocalize>
      <Probe />
    </I18nProvider>,
  );
  expect(
    screen.getByText(
      pseudolocalizeTemplate(messages.es.invitation)
        .replace("{familyName}", "Synthetic {role} 李")
        .replace(/\{role\}(?! 李)/, "Unknown {familyName}"),
    ),
  ).toBeInTheDocument();
});
