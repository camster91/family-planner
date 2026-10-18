/** Bounded form/print review: synthetic contacts, no household writes. */
import AxeBuilder from "@axe-core/playwright";
import { messages } from "../src/i18n";
import { emergencyMessages } from "../src/i18n/emergency";
import { authFile } from "./support/env";
import { guardContext } from "./support/inventory-localization";
import { test, expect, browserFetch } from "./support/test";

test.use({ storageState: authFile("parentA") });
for (const locale of ["en", "es"] as const) {
  test(`${locale}: optional emergency sections, retained draft and printable preview`, async ({
    page,
    context,
    baseURL,
  }, info) => {
    test.skip(
      !["phone-390x844", "desktop-1366x768"].includes(info.project.name),
      "Representative touch and keyboard form review",
    );
    await guardContext(context, baseURL!, locale);
    const copy = messages[locale].emergency;
    const extra = emergencyMessages[locale].emergency;
    const person = "Élodie – synthetic card";
    const allergy = "Verbatim allergy – fabricated QA only";
    const contact = {
      id: "synthetic_emergency_review",
      person_id: null,
      person_name: person,
      relationship: "child",
      blood_type: "O+",
      allergies: allergy,
    };
    let posts = 0;
    await page.route("**/api/emergency-contacts**", async (route) => {
      if (route.request().method() === "GET") {
        await route.fulfill({ json: { contacts: [contact] } });
      } else {
        expect(route.request().method()).toBe("POST");
        posts += 1;
        await route.fulfill({
          status: 503,
          json: { error: "Synthetic refusal" },
        });
      }
    });
    await page.goto("/dashboard/emergency");
    const versionResponse = await browserFetch(page, "/api/version");
    expect(versionResponse.status).toBe(200);
    const runtime = JSON.parse(versionResponse.body);
    if (process.env.RELEASE_SHA)
      expect(runtime.commit).toBe(process.env.RELEASE_SHA);
    await info.attach(`emergency-runtime-${locale}-${info.project.name}`, {
      body: JSON.stringify({
        runtime,
        locale,
        project: info.project.name,
        transport: "synthetic contacts; no household writes",
      }),
      contentType: "application/json",
    });
    await expect(page.locator("html")).toHaveAttribute("lang", locale);
    await expect(
      page.getByRole("heading", { name: copy.title, exact: true }),
    ).toBeVisible();
    await page.getByRole("button", { name: copy.addCard, exact: true }).click();
    const dialog = page.getByRole("dialog");
    const name = dialog.getByLabel(copy.personName, { exact: true });
    await expect(name).toBeFocused();
    await dialog
      .getByRole("button", { name: messages[locale].common.save, exact: true })
      .click();
    await expect(
      dialog.getByText(extra.nameRequired, { exact: true }),
    ).toBeVisible();
    expect(posts).toBe(0);
    await name.fill("  New synthetic card  ");
    const summary = dialog
      .locator("summary")
      .filter({ hasText: extra.groups.medical });
    await summary.click();
    await summary.focus();
    await page.keyboard.press("Tab");
    await expect(
      dialog.getByLabel(copy.bloodType, { exact: true }),
    ).toBeFocused();
    await dialog.getByLabel(copy.allergies, { exact: true }).fill(allergy);
    await dialog
      .getByRole("button", { name: messages[locale].common.save, exact: true })
      .click();
    await expect(dialog.getByRole("alert")).toBeVisible();
    await expect(name).toHaveValue("  New synthetic card  ");
    await expect(
      dialog.getByLabel(copy.allergies, { exact: true }),
    ).toHaveValue(allergy);
    expect(posts).toBe(1);
    const violations = (
      await new AxeBuilder({ page }).include('[role="dialog"]').analyze()
    ).violations.filter(
      (v) => v.impact === "critical" || v.impact === "serious",
    );
    expect(violations).toEqual([]);
    await info.attach(`emergency-form-${locale}-${info.project.name}`, {
      body: await page.screenshot({ animations: "disabled" }),
      contentType: "image/png",
    });
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await page.getByText(person, { exact: true }).first().click();
    const preview = page.getByTestId("emergency-preview");
    await expect(preview.getByText(allergy, { exact: true })).toBeVisible();
    expect(
      await page.evaluate(
        () =>
          document.documentElement.scrollWidth <=
          document.documentElement.clientWidth,
      ),
    ).toBe(true);
    await info.attach(`emergency-preview-${locale}-${info.project.name}`, {
      body: await page.screenshot({ animations: "disabled" }),
      contentType: "image/png",
    });
    await page.emulateMedia({ media: "print" });
    await info.attach(`emergency-print-${locale}-${info.project.name}`, {
      body: await page.screenshot({ animations: "disabled" }),
      contentType: "image/png",
    });
  });
}
