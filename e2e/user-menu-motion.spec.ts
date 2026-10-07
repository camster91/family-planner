import { test, expect } from "@playwright/test";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import postcss from "postcss";
import tailwind from "tailwindcss";

// Isolated rendering regression: real DashboardNav markup and production CSS,
// synthetic child/feature inputs. Live navigation/ACL remains inventory.spec.ts.
let markup: string;
let css: string;
test.beforeAll(async () => {
  markup = execFileSync(
    process.execPath,
    [path.join(__dirname, "support/user-menu-markup.cjs")],
    { encoding: "utf8" },
  );
  const source = path.join(__dirname, "../src/app/globals.css");
  css = (
    await postcss([
      tailwind(path.join(__dirname, "../tailwind.config.js")),
    ]).process(fs.readFileSync(source, "utf8"), { from: source })
  ).css;
});

for (const reducedMotion of ["no-preference", "reduce"] as const) {
  test(`child user-menu target keeps its physical size throughout entrance (${reducedMotion})`, async ({
    page,
  }, testInfo) => {
    test.skip(
      testInfo.project.name !== "phone-390x844",
      "phone menu rendering regression",
    );
    await page.emulateMedia({ reducedMotion });
    // No app/HMR scripts are retained in this isolated document.
    await page.goto("about:blank");
    await page.setContent(
      `<meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style>${markup}`,
    );
    const link = page.getByRole("link", { name: "Food inventory" });
    await expect(link).toHaveAttribute("href", "/dashboard/inventory");
    await expect(
      page.getByRole("button", { name: "User menu" }),
    ).toHaveAttribute("aria-expanded", "true");
    const measurements = await link.evaluate((element) => {
      const link = element as HTMLElement;
      const menu = link.parentElement!.parentElement!;
      const animations = menu.getAnimations();
      if (animations.length !== 1)
        throw new Error(
          `Expected menu entrance animation, got ${animations.length}`,
        );
      const animation = animations[0];
      animation.pause();
      const duration = Number(animation.effect!.getTiming().duration);
      // Seek the actual CSS animation, including its very first frame. Do not
      // wait for completion: the target is already pointer-active on entrance.
      return [0, 0.25, 0.5, 0.75, 1].map((progress) => {
        animation.currentTime = duration * progress;
        const box = link.getBoundingClientRect();
        const style = getComputedStyle(link);
        const menuStyle = getComputedStyle(menu);
        const matrix = new DOMMatrix(menuStyle.transform);
        // One pixel inside the edges avoids fractional boundary rounding to
        // the adjacent sibling in Chromium's point hit test.
        const hits = [box.top + 1, box.bottom - 1].map((y) =>
          link.contains(document.elementFromPoint(box.left + box.width / 2, y)),
        );
        return {
          progress,
          duration,
          layoutHeight: link.offsetHeight,
          minHeight: style.minHeight,
          height: box.height,
          width: box.width,
          scaleX: matrix.a,
          scaleY: matrix.d,
          opacity: menuStyle.opacity,
          pointerEvents: menuStyle.pointerEvents,
          animation: menuStyle.animationName,
          background: menuStyle.backgroundColor,
          hits,
        };
      });
    });
    await testInfo.attach(`menu-motion-${reducedMotion}.json`, {
      body: JSON.stringify(measurements, null, 2),
      contentType: "application/json",
    });
    for (const sample of measurements) {
      expect(sample.minHeight, "production target utility loaded").toBe("44px");
      expect(sample.background, "production surface paint loaded").not.toBe(
        "rgba(0, 0, 0, 0)",
      );
      expect(
        sample.height,
        `${reducedMotion} entrance ${sample.progress}`,
      ).toBeGreaterThanOrEqual(44);
      expect(sample.width).toBeGreaterThanOrEqual(44);
      expect(sample.scaleX).toBe(1);
      expect(sample.scaleY).toBe(1);
      expect(sample.pointerEvents).toBe("auto");
      expect(
        sample.hits,
        "actual link receives pointer hits near both edges",
      ).toEqual([true, true]);
    }
  });
}
