/** @jest-environment jsdom */
import "@testing-library/jest-dom";
import { fireEvent, render, screen } from "@testing-library/react";
import { I18nProvider, useTranslation } from "@/i18n";
import DevicesManager from "../DevicesManager";

function Language() {
  const { setLocale } = useTranslation();
  return <button onClick={() => setLocale("es")}>Change language</button>;
}

it("translates a removed tablet status in place without another request or device action", async () => {
  global.fetch = jest.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => ({
      devices: [
        {
          id: "fixture-removed-tablet",
          label: "Fixture kitchen tablet",
          platform: "android",
          pairedAt: "2026-10-20T12:00:00Z",
          lastSeenAt: null,
          appVersion: "fixture-version",
          status: "removed",
          revokedAt: "2026-10-21T12:00:00Z",
          revokeReason: null,
        },
      ],
    }),
  })) as unknown as typeof fetch;
  render(
    <I18nProvider locale="en">
      <Language />
      <DevicesManager />
    </I18nProvider>,
  );
  const badge = await screen.findByText("Removed", { exact: true });
  expect(badge).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Change language" }));
  expect(screen.getByText("Eliminado", { exact: true })).toBe(badge);
  expect(screen.queryByText("Removed", { exact: true })).toBeNull();
  expect(
    screen.getByRole("heading", { name: "Fixture kitchen tablet" }),
  ).toBeVisible();
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(fetch).toHaveBeenCalledWith("/api/family/devices", {
    cache: "no-store",
  });
});
