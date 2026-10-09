/** @jest-environment jsdom */
import * as React from "react";
import "@testing-library/jest-dom";
import { render, screen } from "@testing-library/react";
import { I18nProvider } from "@/i18n";
import DeleteAccountDialog from "@/components/account/DeleteAccountDialog";
import { accountDeletionMessages as messages } from "../account-deletion";
import { accountDeletionStatusMessages as status } from "../account-deletion-status";
import { pseudolocalizeTemplate } from "../pseudo";
import { ACCOUNT_DELETE_PHRASE } from "@/lib/account-deletion-shared";
it("keeps nonempty keys, placeholder contracts and eager/lazy presentation consistent", () => {
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
  for (const locale of ["en", "es"] as const)
    for (const [key, text] of Object.entries(status[locale]))
      expect(messages[locale][key as keyof typeof messages.en]).toBe(text);
  expect(ACCOUNT_DELETE_PHRASE).toBe("DELETE");
});
for (const locale of ["en", "es"] as const)
  for (const expanded of [false, true])
    it(`${locale} expanded=${expanded}: private household name stays exact and singular warning is grammatical`, async () => {
      const name = " Synthetic {count} / 李 ";
      global.fetch = jest.fn(async () => ({
        ok: true,
        json: async () => ({
          role: "parent",
          household: {
            id: "fixture-household",
            name,
            memberCount: 1,
            parentCount: 1,
          },
          isOnlyParent: true,
          canDeleteAccount: false,
          canDeleteHousehold: true,
        }),
      })) as unknown as typeof fetch;
      render(
        <I18nProvider locale={locale} pseudolocalize={expanded}>
          <DeleteAccountDialog open onClose={jest.fn()} />
        </I18nProvider>,
      );
      await screen.findByLabelText(
        expanded
          ? pseudolocalizeTemplate(messages[locale].password)
          : messages[locale].password,
      );
      const privateNodes = screen.getAllByText(name.trim());
      expect(privateNodes).toHaveLength(2);
      privateNodes.forEach((node) => expect(node.textContent).toBe(name));
      const text = screen.getByRole("dialog").textContent!;
      const template = messages[locale].householdWarningOne;
      expect(text).toContain(
        (expanded ? pseudolocalizeTemplate(template) : template).replace(
          "{count}",
          "1",
        ),
      );
      const plural = messages[locale].householdWarningMany;
      expect(text).not.toContain(
        (expanded ? pseudolocalizeTemplate(plural) : plural).replace(
          "{count}",
          "1",
        ),
      );
    });
