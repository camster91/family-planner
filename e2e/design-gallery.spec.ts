/**
 * Design gallery (#156, docs/design/DESIGN_GALLERY.md): /dev/design-system
 * renders production components with deterministic fake data. The E2E server
 * reaches it through DESIGN_GALLERY_ENABLED=1 (playwright.config.ts); without
 * the flag a production build answers 404 (unit-tested in
 * src/app/dev/design-system/__tests__/gate.test.tsx).
 *
 * - Every section renders, with no horizontal overflow, in light, dark,
 *   fridge night and the long pseudolocalised text.
 * - axe (WCAG 2.0/2.1/2.2 A+AA): no serious or critical violation.
 * - The empty data set shows the empty states.
 * - Dialog and sheet: focus moves in, Escape closes, focus returns; the route
 *   error state takes focus.
 *
 * Signed out and read-only: the gallery never touches the database. Runs at
 * 390x844, 800x1280 and 1280x800. No @visual baselines yet; record them on CI
 * (docs/design/DESIGN_GALLERY.md).
 */
import AxeBuilder from "@axe-core/playwright";
import type { Page, TestInfo } from "@playwright/test";
import { GALLERY_SECTIONS } from "../src/app/dev/design-system/options";
import { expect, test } from "./support/test";

const PROJECTS = [
  "phone-390x844",
  "tablet-portrait-800x1280",
  "fridge-landscape-1280x800",
];

function onlyOnSomeProjects(testInfo: TestInfo) {
  test.skip(
    !PROJECTS.includes(testInfo.project.name),
    "design gallery runs at 390x844, 800x1280 and 1280x800",
  );
}

async function openGallery(page: Page, query = "") {
  await page.goto(`/dev/design-system${query}`);
  await expect(page.getByTestId("design-gallery")).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
}

async function expectNoHorizontalOverflow(page: Page) {
  const overflow = await page.evaluate(
    () =>
      document.documentElement.scrollWidth -
      document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
}

/**
 * Known findings in production components that the gallery surfaced. Each
 * matches one rule and one element (by its HTML), so the same rule failing
 * anywhere else still fails. Remove an entry when its component is fixed
 * (docs/design/DESIGN_GALLERY.md, "Known findings").
 */
const KNOWN_FINDINGS: Array<{ rule: string; html: RegExp; reason: string }> = [
  {
    rule: "target-size",
    html: /<button[^>]*aria-label="Clear"/,
    reason:
      "SearchField clear button is 20x20 CSS px (WCAG 2.5.8 needs 24); src/components/ui/search-field.tsx, used by the command palette",
  },
];

async function expectNoSeriousAxeViolations(page: Page, testInfo: TestInfo) {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    // The Next.js route announcer is framework-owned and empty by design.
    .exclude("next-route-announcer")
    .analyze();
  await testInfo.attach("axe-design-gallery.json", {
    body: JSON.stringify(results.violations, null, 2),
    contentType: "application/json",
  });
  const blocking = results.violations
    .filter((v) => v.impact === "serious" || v.impact === "critical")
    .map((v) => ({
      rule: v.id,
      impact: v.impact,
      nodes: v.nodes
        .filter(
          (n) =>
            !KNOWN_FINDINGS.some((k) => k.rule === v.id && k.html.test(n.html)),
        )
        .map((n) => n.target.join(" ")),
    }))
    .filter((v) => v.nodes.length > 0);
  expect(blocking).toEqual([]);
}

const VARIANTS = [
  { name: "light", query: "", theme: "light" },
  { name: "dark", query: "?theme=dark", theme: "dark" },
  { name: "fridge night", query: "?theme=fridge-night", theme: "fridge-night" },
  { name: "long text", query: "?long=1", theme: "light" },
];

test.describe("design gallery", () => {
  for (const variant of VARIANTS) {
    test(`renders every section (${variant.name})`, async ({
      page,
    }, testInfo) => {
      onlyOnSomeProjects(testInfo);
      await openGallery(page, variant.query);
      const gallery = page.getByTestId("design-gallery");
      await expect(gallery).toHaveAttribute("data-theme", variant.theme);
      if (variant.theme === "light") {
        await expect(gallery).not.toHaveClass(/\bdark\b/);
      } else {
        await expect(gallery).toHaveClass(/\bdark\b/);
      }
      for (const section of GALLERY_SECTIONS) {
        const el = page.getByTestId(`gallery-section-${section.id}`);
        await expect(el).toBeAttached();
        await expect(
          el.getByRole("heading", { level: 2, name: section.title }),
        ).toBeAttached();
      }
      // A production component in each data-driven section.
      await expect(page.getByTestId("region-today")).toBeVisible();
      await expect(page.getByTestId("region-dinner")).toBeVisible();
      await expect(page.getByTestId("region-groceries")).toBeVisible();
      await expect(page.getByTestId("region-chores")).toBeVisible();
      await expect(page.getByTestId("region-usesoon")).toBeVisible();
      await expect(page.getByTestId("recipe-detail")).toBeVisible();
      await expect(page.getByTestId("kid-routines")).toBeVisible();
      await expect(page.getByTestId("gallery-sync-row")).toHaveCount(5);
      await expect(
        page.getByTestId("gallery-toast-frame").getByTestId("undo-toast"),
      ).toBeVisible();
      if (variant.theme === "fridge-night") {
        await expect(page.getByTestId("gallery-calm-frame")).toBeVisible();
        await expect(page.getByTestId("night-dim")).toBeAttached();
      }
      if (variant.query === "?long=1") {
        await expect(gallery).toHaveAttribute("data-long", "true");
        await expect(page.getByTestId("today-event").first()).toContainText(
          "[Šŵîɱɱîñĝ ļéššöñ",
        );
      }
      await expectNoHorizontalOverflow(page);
    });

    test(`has no serious axe violations (${variant.name})`, async ({
      page,
    }, testInfo) => {
      onlyOnSomeProjects(testInfo);
      await openGallery(page, variant.query);
      await expectNoSeriousAxeViolations(page, testInfo);
    });
  }

  test("empty data shows the empty states", async ({ page }, testInfo) => {
    onlyOnSomeProjects(testInfo);
    await openGallery(page, "?data=empty");
    await expect(page.getByTestId("region-today")).toContainText(
      "Nothing else on the calendar today.",
    );
    await expect(page.getByTestId("region-dinner")).toContainText(
      "No dinner planned yet.",
    );
    await expect(page.getByTestId("region-chores")).toContainText(
      "No chores due today.",
    );
    await expect(page.getByTestId("region-groceries")).toContainText(
      "The grocery list is clear.",
    );
    await expect(page.getByTestId("region-usesoon")).toHaveCount(0);
    await expect(
      page.getByRole("heading", { name: "No items yet" }),
    ).toBeVisible();
    await expectNoHorizontalOverflow(page);
    await expectNoSeriousAxeViolations(page, testInfo);
  });

  test("one section on its own", async ({ page }, testInfo) => {
    onlyOnSomeProjects(testInfo);
    await openGallery(page, "?section=groceries");
    await expect(page.getByTestId("gallery-section-groceries")).toBeVisible();
    await expect(page.locator("[data-testid^='gallery-section-']")).toHaveCount(
      1,
    );
  });

  test("dialog and sheet manage focus", async ({ page }, testInfo) => {
    onlyOnSomeProjects(testInfo);
    await openGallery(page, "?section=overlays");

    const open = page.getByTestId("gallery-open-dialog");
    await open.click();
    const dialog = page.getByRole("dialog", { name: "Rename list" });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole("button", { name: "Close" })).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(open).toBeFocused();

    const openSheet = page.getByTestId("gallery-open-sheet");
    await openSheet.click();
    const sheet = page.getByTestId("move-section-dialog");
    await expect(sheet).toBeVisible();
    await expect(sheet.getByRole("button", { name: /Produce/ })).toBeVisible();
    await expectNoSeriousAxeViolations(page, testInfo);
    await sheet.getByRole("button", { name: /Produce/ }).click();
    await expect(sheet).toBeHidden();
    await expect(
      page.getByRole("status").getByText("Picked: Produce"),
    ).toBeVisible();
  });

  test("route error state takes focus", async ({ page }, testInfo) => {
    onlyOnSomeProjects(testInfo);
    await openGallery(page, "?section=states");
    await page.getByTestId("gallery-show-error").click();
    const error = page.getByTestId("dashboard-error");
    await expect(error).toBeVisible();
    await expect(error.getByRole("heading", { level: 2 })).toBeFocused();
  });
});
