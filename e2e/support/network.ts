/**
 * Network condition helpers for E2E specs (#155).
 *
 * - `goOffline` / `goOnline`: toggle the whole browser context offline, which
 *   makes `fetch` reject exactly like a dropped Wi-Fi connection on the tablet.
 * - `delayRoute`: hold matching requests for `ms` before letting them through,
 *   for loading/skeleton states. Deterministic (no throttling profiles).
 */
import type { Page } from "@playwright/test";

export async function goOffline(page: Page) {
  await page.context().setOffline(true);
}

export async function goOnline(page: Page) {
  await page.context().setOffline(false);
}

export async function delayRoute(page: Page, url: string | RegExp, ms: number) {
  await page.route(url, async (route) => {
    await new Promise((resolve) => setTimeout(resolve, ms));
    await route.continue();
  });
}

/** Force the app's stored theme before any page script runs (see theme-provider.tsx). */
export async function useStoredTheme(page: Page, theme: "light" | "dark") {
  await page.addInitScript((t) => {
    try {
      window.localStorage.setItem("familyPlanner_theme", t);
    } catch {
      // Storage blocked: the app falls back to light.
    }
  }, theme);
}
