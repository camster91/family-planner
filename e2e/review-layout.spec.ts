/** #375: reflow checks against production components, using fabricated copy. */
import type { Page } from "@playwright/test";
import { expect, test } from "./support/test";

async function doubleText(page: Page, selector: string) {
  // Text-only zoom, not CSS zoom: keep the viewport/containers unchanged.
  await page.locator(selector).evaluate((root) => {
    const elements = [root, ...root.querySelectorAll("*")];
    const sizes = elements.map((el) => {
      const style = getComputedStyle(el);
      return [parseFloat(style.fontSize), parseFloat(style.lineHeight)];
    });
    elements.forEach((el, i) => {
      if (!(el instanceof HTMLElement)) return;
      el.style.fontSize = `${sizes[i][0] * 2}px`;
      if (Number.isFinite(sizes[i][1]))
        el.style.lineHeight = `${sizes[i][1] * 2}px`;
    });
  });
}

for (const enlarged of [false, true]) {
  test(`login legal links reflow (${enlarged ? "200%" : "100%"} text)`, async ({
    page,
  }, testInfo) => {
    await page.goto("/login");
    await page.evaluate(() => document.fonts.ready);
    if (enlarged) await doubleText(page, ".auth-help");
    const footer = page.locator(".auth-help");
    for (const href of ["/terms", "/privacy"]) {
      const link = footer.locator(`a[href="${href}"]`);
      await expect(link).toBeVisible();
      const dimensions = await link.evaluate((el) => ({
        width: el.clientWidth,
        content: el.scrollWidth,
        height: el.clientHeight,
        lineHeight: parseFloat(getComputedStyle(el).lineHeight),
      }));
      expect(dimensions.content).toBeLessThanOrEqual(dimensions.width);
      expect(dimensions.height).toBeLessThanOrEqual(
        Math.ceil(dimensions.lineHeight),
      );
    }
    expect(
      await page.evaluate(
        () =>
          document.documentElement.scrollWidth -
          document.documentElement.clientWidth,
      ),
    ).toBeLessThanOrEqual(0);
    await testInfo.attach("login-legal-links.png", {
      body: await footer.screenshot(),
      contentType: "image/png",
    });
  });

  test(`Today time column reflows (${enlarged ? "200%" : "100%"} text)`, async ({
    page,
  }, testInfo) => {
    await page.goto("/dev/design-system?section=schedule");
    const row = page.getByTestId("today-event").first();
    await expect(row).toBeVisible();
    await page.evaluate(() => document.fonts.ready);
    // Probe the longest English time label without modifying shared fixtures.
    await row.locator(":scope > p").evaluate((el) => {
      el.textContent = "Until 10:30 PM";
    });
    if (enlarged) await doubleText(page, '[data-testid="region-today"]');
    const geometry = await row.evaluate((el) => {
      const time = el.querySelector("p")!;
      const title = el.querySelector("div")!;
      const timeBox = time.getBoundingClientRect();
      const titleBox = title.getBoundingClientRect();
      return {
        content: time.scrollWidth,
        width: time.clientWidth,
        timeRight: timeBox.right,
        titleLeft: titleBox.left,
        rowRight: el.getBoundingClientRect().right,
        titleRight: titleBox.right,
      };
    });
    expect(geometry.content).toBeLessThanOrEqual(geometry.width);
    expect(geometry.timeRight).toBeLessThan(geometry.titleLeft);
    expect(geometry.titleRight).toBeLessThanOrEqual(geometry.rowRight + 1);
    await testInfo.attach("today-time-reflow.png", {
      body: await row.screenshot(),
      contentType: "image/png",
    });
  });
}
