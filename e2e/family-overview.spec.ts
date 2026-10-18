/** Parent-only account roster; no profile capability or real member removal. */
import AxeBuilder from "@axe-core/playwright";
import { execFileSync } from "node:child_process";
import { test, expect, browserFetch, browserSend } from "./support/test";
import { authFile } from "./support/env";
import { FIXTURE_IDS, FIXTURE_EMAILS } from "../src/lib/fixtures/dataset";
import { assertFixtureTargetAllowed } from "../src/lib/fixtures/guard";
import { familyOverviewMessages } from "../src/i18n/family-overview";
import { LOCALE_STORAGE_KEY } from "../src/i18n";
import { THEME_STORAGE_KEY } from "../src/lib/theme";

const A = FIXTURE_IDS.familyA;
const B = FIXTURE_IDS.familyB;

test.beforeEach(async ({ context, baseURL }) => {
  assertFixtureTargetAllowed(process.env);
  expect(["localhost", "127.0.0.1", "[::1]"]).toContain(
    new URL(baseURL!).hostname,
  );
  await context.route("**/*", (route) => {
    const url = new URL(route.request().url());
    return ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) ||
      ["data:", "blob:"].includes(url.protocol)
      ? route.continue()
      : route.abort();
  });
});

test.describe("Family account overview", () => {
  test.use({ storageState: authFile("parentA") });
  for (const locale of ["en", "es"] as const) {
    test(`${locale}: real roster, readable cards, safe pending/retry/cancel and focused local removal`, async ({
      page,
    }, info) => {
      const text = familyOverviewMessages[locale];
      const copy = (
        key: keyof typeof text,
        params: Record<string, string | number> = {},
      ) =>
        text[key].replace(/\{(\w+)\}/g, (all, key) =>
          String(params[key] ?? all),
        );
      await page.addInitScript(
        ({ locale, localeKey, themeKey }) => {
          localStorage.setItem(localeKey, locale);
          localStorage.setItem(themeKey, locale === "es" ? "dark" : "light");
        },
        { locale, localeKey: LOCALE_STORAGE_KEY, themeKey: THEME_STORAGE_KEY },
      );
      await page.goto("/dashboard/family");
      await expect(page.locator("html")).toHaveAttribute("lang", locale);
      const response = await browserFetch(page, "/api/family/members");
      expect(response.status).toBe(200);
      const version = await browserFetch(page, "/api/version");
      expect(version.status).toBe(200);
      const runtime = JSON.parse(version.body);
      expect(runtime.commit).toBe(
        execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
      );
      await info.attach("actual-family-runtime", {
        body: JSON.stringify(runtime),
        contentType: "application/json",
      });
      const roster = JSON.parse(response.body).members as Array<{
        id: string;
        name: string;
        email: string;
      }>;
      expect(roster.some((member) => member.id === A.parent)).toBe(true);
      await expect(page.getByTestId("family-member")).toHaveCount(
        roster.length,
      );
      await expect(
        page.getByText(copy("account"), { exact: true }),
      ).toHaveCount(roster.length);
      await expect(
        page.getByRole("link", { name: copy("addMember"), exact: true }),
      ).toHaveAttribute("href", "/dashboard/family/invite");
      await expect(
        page.getByRole("button", {
          name: copy("removeAria", {
            name: roster.find((member) => member.id === A.parent)!.name,
          }),
          exact: true,
        }),
      ).toHaveCount(0);
      const cards = page.getByTestId("family-members");
      const box = await cards.boundingBox();
      expect(box!.width).toBeGreaterThanOrEqual(
        page.viewportSize()!.width - 72,
      );
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth - innerWidth,
        ),
      ).toBeLessThanOrEqual(0);
      for (const card of await page.getByTestId("family-member").all()) {
        const overflow = await card.evaluate(
          (node) => node.scrollWidth - node.clientWidth,
        );
        expect(overflow).toBeLessThanOrEqual(0);
      }
      expect(
        (
          await new AxeBuilder({ page })
            .include("main")
            .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
            .analyze()
        ).violations,
      ).toEqual([]);
      await page.screenshot({
        path: info.outputPath(`family-overview-${locale}.png`),
        fullPage: true,
        animations: "disabled",
      });

      const child = roster.find((member) => member.id === A.child)!;
      expect(child).toBeTruthy();
      const opener = page.getByRole("button", {
        name: copy("removeAria", { name: child.name }),
        exact: true,
      });
      const writes: string[] = [];
      let release!: () => void;
      const held = new Promise<void>((resolve) => {
        release = resolve;
      });
      let attempt = 0;
      let heldResponse: Promise<void> | null = null;
      await page.route(
        `**/api/family/members/${encodeURIComponent(child.id)}`,
        async (route) => {
          expect(route.request().method()).toBe("DELETE");
          writes.push(new URL(route.request().url()).pathname);
          if (++attempt === 1)
            return route.fulfill({
              status: 409,
              contentType: "application/json",
              body: JSON.stringify({ error: "Synthetic raw refusal {reason}" }),
            });
          heldResponse = held.then(() =>
            route.fulfill({
              status: 200,
              contentType: "application/json",
              body: JSON.stringify({
                success: true,
                removedId: child.id,
                tabletsRevoked: 1,
              }),
            }),
          );
          await heldResponse;
        },
      );
      try {
        await opener.press("Enter");
        let dialog = page.getByRole("dialog", {
          name: copy("removeTitle", { name: child.name }),
          exact: true,
        });
        await expect(dialog).toBeVisible();
        await page.keyboard.press("Escape");
        await expect(dialog).toHaveCount(0);
        await expect(opener).toBeFocused();
        expect(writes).toEqual([]);
        await opener.press("Enter");
        dialog = page.getByRole("dialog", {
          name: copy("removeTitle", { name: child.name }),
          exact: true,
        });
        await dialog
          .getByRole("button", { name: copy("removeConfirm"), exact: true })
          .click();
        await expect(dialog.getByRole("alert")).toHaveText(
          "Synthetic raw refusal {reason}",
        );
        const confirmation = dialog.getByRole("button", {
          name: copy("removeConfirm"),
          exact: true,
        });
        await confirmation.click();
        await expect(
          dialog.getByRole("button", { name: copy("removing"), exact: true }),
        ).toBeDisabled();
        await page.keyboard.press("Escape");
        await expect(dialog).toBeVisible();
        expect(writes).toHaveLength(2);
        expect(
          (
            await new AxeBuilder({ page })
              .include('[role="dialog"]')
              .withTags(["wcag2a", "wcag2aa"])
              .analyze()
          ).violations,
        ).toEqual([]);
        release();
        await expect(dialog).toHaveCount(0);
        await expect(
          page.getByRole("heading", { name: copy("people"), exact: true }),
        ).toBeFocused();
        await expect(page.getByTestId("family-member")).toHaveCount(
          roster.length - 1,
        );
        await expect(page.getByRole("status")).toHaveText(
          copy("removedWithTablets", { name: child.name }),
        );
        expect(writes).toEqual(
          Array(2).fill(`/api/family/members/${child.id}`),
        );
        const unchanged = JSON.parse(
          (await browserFetch(page, "/api/family/members")).body,
        ).members;
        expect(
          unchanged.some((member: { id: string }) => member.id === child.id),
        ).toBe(true);
      } finally {
        release();
        if (heldResponse) await heldResponse;
        await page.unroute(
          `**/api/family/members/${encodeURIComponent(child.id)}`,
        );
      }
    });
  }
});

test.describe("Family privacy", () => {
  test.describe("child", () => {
    test.use({ storageState: authFile("childA") });
    test("parent-only page stays blocked and own selector omits emails", async ({
      page,
    }) => {
      await page.goto("/dashboard/family");
      await expect(page).not.toHaveURL(/\/dashboard\/family(?:\/)?$/);
      const me = await browserFetch(page, "/api/auth/me");
      expect(me.status).toBe(200);
      expect(JSON.parse(me.body).user.id).toBe(A.child);
      const response = await browserFetch(page, "/api/family/members");
      expect(response.status).toBe(200);
      const members = JSON.parse(response.body).members;
      expect(
        members.every((member: object) => !Object.hasOwn(member, "email")),
      ).toBe(true);
      await expect(
        page.getByText(FIXTURE_EMAILS.familyA.parent, { exact: true }),
      ).toHaveCount(0);
      expect(
        (await browserSend(page, "DELETE", `/api/family/members/${A.teen}`))
          .status,
      ).toBe(403);
    });
  });
  test.describe("other household", () => {
    test.use({ storageState: authFile("parentB") });
    test("only own members appear and cross-household removal is refused", async ({
      page,
    }) => {
      await page.goto("/dashboard/family");
      const response = await browserFetch(page, "/api/family/members");
      expect(response.status).toBe(200);
      const members = JSON.parse(response.body).members;
      expect(
        members.some((member: { id: string }) => member.id === B.parent),
      ).toBe(true);
      expect(
        members.some(
          (member: { id: string }) =>
            member.id === A.parent || member.id === A.child,
        ),
      ).toBe(false);
      await expect(
        page.getByText(FIXTURE_EMAILS.familyA.parent, { exact: true }),
      ).toHaveCount(0);
      expect(
        (await browserSend(page, "DELETE", `/api/family/members/${A.child}`))
          .status,
      ).toBe(404);
    });
  });
});
