import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";

// Explicit CSS text-only enlargement simulation, not Android hardware evidence.
// Real component, canonical tabsFor/feature provider/Next Link, production CSS.
// Isolated labelled fixture: no API mocks, auth or household writes.
const labels = {
  parent: ["Today", "Calendar", "Meals", "Lists", "Family"],
  teen: ["Today", "Calendar", "Meals", "Lists", "Emergency"],
  child: ["Today", "Lists", "Emergency"],
};
let browserBundle: string;
test.beforeAll(async ({}, testInfo) => {
  browserBundle = testInfo.outputPath("tab-bar-browser.js");
  execFileSync(
    process.execPath,
    [
      path.join(__dirname, "support/tab-bar-markup.cjs"),
      "--browser",
      browserBundle,
    ],
    { encoding: "utf8" },
  );
});
test.use({ storageState: { cookies: [], origins: [] } });
for (const width of [320, 390]) {
  for (const role of ["parent", "teen", "child"] as const) {
    test(`@reflow phone tabs ${role} ${width}px at 2x text`, async ({
      page,
    }, testInfo) => {
      test.skip(
        testInfo.project.name !== "desktop-1366x768",
        "one explicit viewport matrix",
      );
      await page.setViewportSize({ width, height: 844 });
      await page.goto("/login");
      await expect(
        page.getByRole("link", { name: "Herewoven home" }),
      ).toBeVisible();
      await page.evaluate(() => document.fonts.ready);
      const markup = execFileSync(
        process.execPath,
        [path.join(__dirname, "support/tab-bar-markup.cjs"), role],
        { encoding: "utf8" },
      );
      const shell = await page.evaluate(() => ({
        head: `<style>${Array.from(document.styleSheets)
          .map((sheet) =>
            Array.from(sheet.cssRules)
              .map((rule) => rule.cssText)
              .join("\n"),
          )
          .join("\n")}</style>`,
        htmlClass: document.documentElement.className,
      }));
      // Drop Next's running app/scripts, retain its actual styles and font classes.
      // This prevents the unrelated login hydration from replacing fixture styles.
      const cssBase = page.url();
      await page.goto("about:blank");
      await page.setContent(
        `<html class="${shell.htmlClass}"><head><base href="${cssBase}">${shell.head}</head><body>${markup}</body></html>`,
      );
      await page.evaluate((r) => {
        (window as unknown as { __tabRole: string }).__tabRole = r;
      }, role);
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.addScriptTag({ path: browserBundle });
      await page.evaluate(() => document.fonts.ready);
      await expect
        .poll(() =>
          page
            .locator("#main-content")
            .evaluate((el) =>
              parseFloat(el.style.getPropertyValue("--phone-tab-bar-height")),
            ),
        )
        .toBeGreaterThan(0);
      const nav = page.getByRole("navigation", { name: "Tabs" });
      const links = nav.getByRole("link");
      await expect(links).toHaveText(labels[role]);
      await expect(nav.locator('[aria-current="page"]')).toHaveText(
        role === "parent" ? "Calendar" : "Emergency",
      );
      expect(
        await nav.evaluate((el) => getComputedStyle(el).position),
        "production CSS loaded",
      ).toBe("fixed");
      expect(
        await links
          .first()
          .locator("span")
          .evaluate((el) => getComputedStyle(el).fontSize),
      ).toBe("12px");
      await page.screenshot({ path: testInfo.outputPath("normal-tabs.png") });
      const normalReserve = `${Math.max(80, (await nav.boundingBox())!.height)}px`;
      expect(
        await page
          .locator("#main-content")
          .evaluate((el) => getComputedStyle(el).paddingBottom),
        "keep the 5rem floor; reserve more only when labels actually need it",
      ).toBe(normalReserve);
      const textScale = await page.addStyleTag({
        content: "nav.tab-bar a > span { font-size: 24px !important; }",
      });
      await expect
        .poll(() =>
          links
            .locator("span")
            .evaluateAll((els) =>
              els.map((el) => getComputedStyle(el).fontSize),
            ),
        )
        .toEqual(labels[role].map(() => "24px"));
      await page.evaluate(() => document.fonts.ready);
      await expect
        .poll(
          () =>
            page.locator("#main-content").evaluate((el) => {
              const bar = document.querySelector("nav.tab-bar")!;
              return (
                parseFloat(getComputedStyle(el).paddingBottom) >=
                bar.getBoundingClientRect().height
              );
            }),
          {
            message: "reserve must follow enlarged navigation before measuring",
          },
        )
        .toBe(true);
      const geometry = await nav.evaluate((node) => {
        const rect = (el: Element) => {
          const r = el.getBoundingClientRect();
          return {
            left: r.left,
            right: r.right,
            top: r.top,
            bottom: r.bottom,
            width: r.width,
            height: r.height,
          };
        };
        return {
          nav: rect(node),
          main: {
            className: document.getElementById("main-content")!.className,
            padding: getComputedStyle(document.getElementById("main-content")!)
              .paddingBottom,
            measured: document
              .getElementById("main-content")!
              .style.getPropertyValue("--phone-tab-bar-height"),
          },
          navScrollWidth: node.scrollWidth,
          navClientWidth: node.clientWidth,
          pageScrollWidth: document.documentElement.scrollWidth,
          pageClientWidth: document.documentElement.clientWidth,
          tabs: Array.from(node.querySelectorAll("a")).map((link) => {
            const span = link.querySelector("span")!;
            const range = document.createRange();
            range.selectNodeContents(span);
            return {
              text: span.textContent,
              target: rect(link),
              label: rect(span),
              textRects: Array.from(range.getClientRects()).map((r) => ({
                left: r.left,
                right: r.right,
                top: r.top,
                bottom: r.bottom,
              })),
              font: getComputedStyle(span).fontSize,
              overflow: getComputedStyle(span).overflow,
              lineHeight: getComputedStyle(span).lineHeight,
            };
          }),
        };
      });
      const geometryPath = testInfo.outputPath("tab-geometry.json");
      writeFileSync(geometryPath, JSON.stringify(geometry, null, 2));
      await testInfo.attach("tab-geometry.json", {
        path: geometryPath,
        contentType: "application/json",
      });
      const screenshotPath = testInfo.outputPath("enlarged-tabs.png");
      await page.screenshot({ path: screenshotPath });
      await testInfo.attach("enlarged-tabs.png", {
        path: screenshotPath,
        contentType: "image/png",
      });
      expect
        .soft(geometry.pageScrollWidth)
        .toBeLessThanOrEqual(geometry.pageClientWidth + 1);
      expect
        .soft(geometry.navScrollWidth)
        .toBeLessThanOrEqual(geometry.navClientWidth + 1);
      for (const tab of geometry.tabs) {
        expect.soft(tab.font).toBe("24px");
        expect.soft(tab.target.width, tab.text!).toBeGreaterThanOrEqual(44);
        expect.soft(tab.target.height, tab.text!).toBeGreaterThanOrEqual(44);
        expect
          .soft(tab.label.left, `${tab.text} label left`)
          .toBeGreaterThanOrEqual(tab.target.left - 1);
        expect
          .soft(tab.label.right, `${tab.text} label right`)
          .toBeLessThanOrEqual(tab.target.right + 1);
        for (const r of tab.textRects) {
          expect
            .soft(r.left, `${tab.text} painted text left`)
            .toBeGreaterThanOrEqual(tab.target.left - 1);
          expect
            .soft(r.right, `${tab.text} painted text right`)
            .toBeLessThanOrEqual(tab.target.right + 1);
          expect
            .soft(r.bottom, `${tab.text} text bottom`)
            .toBeLessThanOrEqual(tab.target.bottom + 1);
        }
        expect
          .soft(tab.overflow, "critical text must not be clipped")
          .not.toBe("hidden");
      }
      const long = geometry.tabs.find(
        (t) => t.text === (role === "parent" ? "Calendar" : "Emergency"),
      )!;
      expect
        .soft(
          new Set(long.textRects.map((r) => r.top)).size,
          "long label really wraps",
        )
        .toBeGreaterThan(1);
      await links.last().focus();
      await expect(links.last()).toBeFocused();
      expect(
        await links.last().evaluate((el) => getComputedStyle(el).outlineStyle),
      ).not.toBe("none");
      expect(
        await links
          .last()
          .evaluate((el) => parseFloat(getComputedStyle(el).outlineWidth)),
      ).toBeGreaterThan(0);
      await page.evaluate(() =>
        window.scrollTo(0, document.documentElement.scrollHeight),
      );
      const bottom = await page.locator("#bottom-action").boundingBox();
      const bar = await nav.boundingBox();
      const bottomPath = testInfo.outputPath("bottom-reachability.json");
      writeFileSync(bottomPath, JSON.stringify({ bottom, bar }, null, 2));
      await testInfo.attach("bottom-reachability.json", {
        path: bottomPath,
        contentType: "application/json",
      });
      await page.screenshot({
        path: testInfo.outputPath("bottom-reachable.png"),
      });
      expect(errors, "actual hydrated component must not throw").toEqual([]);
      expect(
        bottom!.y + bottom!.height,
        "last content action must be fully above fixed navigation at maximum scroll",
      ).toBeLessThanOrEqual(bar!.y + 1);

      // A live height change must release the extra reserve again, and desktop
      // must retain its existing md padding rather than the phone measurement.
      await textScale.evaluate((el) => el.parentNode?.removeChild(el));
      await expect
        .poll(() =>
          page
            .locator("#main-content")
            .evaluate((el) => getComputedStyle(el).paddingBottom),
        )
        .toBe(normalReserve);
      await page.setViewportSize({ width: 768, height: 844 });
      await expect(nav).toBeHidden();
      await expect
        .poll(() =>
          page
            .locator("#main-content")
            .evaluate((el) => getComputedStyle(el).paddingBottom),
        )
        .toBe("32px");
      await expect
        .poll(() =>
          page
            .locator("#main-content")
            .evaluate((el) =>
              el.style.getPropertyValue("--phone-tab-bar-height"),
            ),
        )
        .toBe("0px");
      await page.setViewportSize({ width, height: 844 });
      await expect(nav).toBeVisible();
      await expect
        .poll(() =>
          page
            .locator("#main-content")
            .evaluate((el) =>
              parseFloat(el.style.getPropertyValue("--phone-tab-bar-height")),
            ),
        )
        .toBeGreaterThan(0);
      await page.evaluate(() =>
        (
          window as unknown as { __tabRoot: { unmount: () => void } }
        ).__tabRoot.unmount(),
      );
      await expect
        .poll(() =>
          page
            .locator("#main-content")
            .evaluate((el) =>
              el.style.getPropertyValue("--phone-tab-bar-height"),
            ),
        )
        .toBe("");
      expect(errors).toEqual([]);
    });
  }
}
