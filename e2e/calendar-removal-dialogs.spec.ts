/** Actual rendered settings dialogs; provider reads/writes are isolated synthetic transport. */
import { test, expect } from "./support/test";
import { authFile } from "./support/env";
import {
  SettingsRequests,
  install,
  guard,
  open,
  selectSettingsTab,
  capture,
  msg,
  identity,
} from "./support/settings-localization";
test.use({ storageState: authFile("parentA") });
test.skip(
  process.env.E2E_SETTINGS_QA !== "enabled",
  "Requires guarded opted-in Settings QA server",
);
for (const locale of ["en", "es"] as const)
  test(`${locale}: calendar removals cancel, wait, fail and recover in the app`, async ({
    page,
    context,
    baseURL,
  }, info) => {
    const s = new SettingsRequests();
    s.reads.set("/api/calendar/subscriptions", {
      body: {
        subscriptions: [
          {
            id: "fixture-sub",
            name: "School calendar",
            color: null,
            last_fetched_at: null,
            last_status: "pending",
            last_error: null,
          },
        ],
      },
    });
    s.reads.set("/api/calendar/connections", {
      body: {
        providers: [],
        connections: [
          {
            id: "fixture-connection",
            provider: "google",
            provider_label: "Google Calendar",
            calendar_id: "home",
            calendar_name: "Family",
            push_mode: "linked",
            status: "ok",
            last_synced_at: null,
            last_error: null,
            conflicts_count: 0,
            owner: { id: "fixture-parent", name: "Fixture parent" },
            is_mine: true,
          },
        ],
      },
    });
    await guard(context, baseURL!, locale);
    await install(page, s);
    try {
      await page.goto("/dashboard/settings");
      await expect(page.locator("#profileName")).toBeVisible();
      await identity(page, info, locale, "parentA");
      for (const item of [
        {
          section: "subscriptions" as const,
          button: msg(locale, "removeLabel", { name: "School calendar" }),
          path: "/api/calendar/subscriptions/fixture-sub",
          action: "remove" as const,
        },
        {
          section: "connectedCalendars" as const,
          button: msg(locale, "disconnectLabel", {
            provider: "Google Calendar",
          }),
          path: "/api/calendar/sync-connections/fixture-connection",
          action: "disconnect" as const,
        },
      ]) {
        if (item.action === "disconnect") {
          await selectSettingsTab(page, locale, "account");
          const themes = page
            .locator("#settings-account")
            .locator("..")
            .getByRole("group")
            .first()
            .getByRole("button");
          await themes.nth(1).click();
          await expect(themes.nth(1)).toHaveAttribute("aria-pressed", "true");
        }
        const section = await open(page, locale, item.section);
        const opener = section.getByRole("button", {
          name: item.button,
          exact: true,
        });
        await opener.click();
        let dialog = page.getByRole("alertdialog");
        const cancel = dialog.getByRole("button", {
          name: msg(locale, "cancel"),
          exact: true,
        });
        await expect(cancel).toBeFocused();
        await page.keyboard.press("Escape");
        await expect(dialog).toHaveCount(0);
        await expect(opener).toBeFocused();
        expect(s.count("DELETE", item.path)).toBe(0);
        await opener.click();
        dialog = page.getByRole("alertdialog");
        await dialog
          .getByRole("button", { name: msg(locale, "cancel"), exact: true })
          .click();
        expect(s.count("DELETE", item.path)).toBe(0);
        await opener.click();
        dialog = page.getByRole("alertdialog");
        const confirm = dialog.getByRole("button", {
          name: msg(locale, item.action),
          exact: true,
        });
        await capture(
          page,
          info,
          item.section + "-confirmation",
          [
            confirm,
            dialog.getByRole("button", {
              name: msg(locale, "cancel"),
              exact: true,
            }),
          ],
          dialog,
        );
        const release = s.hold("DELETE", item.path);
        await confirm.click();
        await s.arrived("DELETE", item.path);
        await expect(confirm).toBeDisabled();
        await page.keyboard.press("Escape");
        await expect(dialog).toBeVisible();
        release({ status: 503, body: { error: "Synthetic removal refusal" } });
        if (item.action === "remove") {
          // Subscription writes fail closed outside the dialog when the
          // response is ambiguous. The recovery surface keeps the original
          // request held and offers an explicit list check instead of
          // retrying a potentially already-applied delete.
          await expect(dialog).toHaveCount(0);
          await expect(section.getByRole("alert")).toHaveText(
            msg(locale, "calendarWriteUnconfirmed"),
          );
          const check = section.getByRole("button", {
            name: msg(locale, "checkSubscriptions"),
            exact: true,
          });
          await expect(check).toBeEnabled();
          expect(s.count("DELETE", item.path)).toBe(1);
          await capture(page, info, item.section + "-recovery", [], section);
          continue;
        }
        await expect(dialog.getByRole("alert")).toHaveText(
          "Synthetic removal refusal",
        );
        await expect(confirm).toBeEnabled();
        await capture(page, info, item.section + "-retry", [confirm], dialog);
        s.reply("DELETE", item.path, { body: { success: true } });
        await confirm.click();
        await expect(dialog).toHaveCount(0);
        expect(s.count("DELETE", item.path)).toBe(2);
        await expect(opener).toHaveCount(0);
        await expect(section.locator("summary")).toBeFocused();
      }
    } finally {
      s.finish();
    }
  });
