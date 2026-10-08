/**
 * Offline grocery ticks (#162): the bounded offline queue and the
 * Idempotency-Key on PATCH /api/lists/items/update, in a real browser.
 * Contract: docs/architecture/OFFLINE_SYNC.md.
 *
 * Every test works on its own throwaway grocery list (created and deleted
 * through the API) so the seeded Groceries list, the dashboard Shopping card
 * and the visual baselines never see these writes.
 *
 * A page cannot be reloaded while the browser is fully offline (the O-41
 * service worker only shows the offline page, and it is blocked here anyway,
 * see playwright.config.ts). The restart case therefore reloads with only the
 * mutation endpoint unreachable, which is what the queue sees either way.
 */
import AxeBuilder from "@axe-core/playwright";
import type { Page, Request, TestInfo } from "@playwright/test";
import { FIXTURE_EMAILS } from "../src/lib/fixtures/dataset";
import { authFile, E2E_ANCHOR, E2E_BASE_URL } from "./support/env";
import { goOffline, goOnline } from "./support/network";
import {
  browserFetch,
  browserSend,
  expect,
  loginViaUi,
  test,
} from "./support/test";

const UPDATE_URL = "**/api/lists/items/update";
/** Two representative sizes are enough for a data-path journey. */
const PROJECTS = ["phone-390x844", "fridge-landscape-1280x800"];

type Fixture = { listId: string; items: Record<string, string> };

function onlyOnSomeProjects(testInfo: TestInfo) {
  test.skip(
    !PROJECTS.includes(testInfo.project.name),
    "sync journeys run on two representative projects",
  );
}

async function createList(
  page: Page,
  testInfo: TestInfo,
  contents: string[],
): Promise<Fixture> {
  await page.goto("/dashboard/lists");
  const created = await browserSend(page, "POST", "/api/lists/create", {
    name: `Sync proof ${testInfo.project.name} ${testInfo.title.slice(0, 20)}`,
    type: "grocery",
  });
  expect(created.status, created.body).toBe(200);
  const listId = JSON.parse(created.body).list.id as string;
  const items: Record<string, string> = {};
  for (const content of contents) {
    const res = await browserSend(page, "POST", "/api/lists/items/create", {
      listId,
      content,
    });
    expect(res.status, res.body).toBe(200);
    items[content] = JSON.parse(res.body).item.id;
  }
  return { listId, items };
}

async function serverItem(page: Page, listId: string, itemId: string) {
  const { status, body } = await browserFetch(
    page,
    `/api/lists/items?listId=${listId}`,
  );
  expect(status).toBe(200);
  return (
    JSON.parse(body).items as Array<{
      id: string;
      checked: boolean;
      checked_at: string | null;
    }>
  ).find((i) => i.id === itemId)!;
}

function row(page: Page, itemId: string) {
  return page.locator(`[data-item-id="${itemId}"]`);
}

function trackUpdates(page: Page) {
  const requests: Request[] = [];
  page.on("request", (r) => {
    if (r.method() === "PATCH" && r.url().includes("/api/lists/items/update"))
      requests.push(r);
  });
  return requests;
}

test.describe("offline grocery ticks: Family A parent", () => {
  test.use({ storageState: authFile("parentA") });

  let fixture: Fixture | null = null;

  test.beforeEach(async ({}, testInfo) => onlyOnSomeProjects(testInfo));

  test.afterEach(async ({ page }) => {
    await page.unrouteAll({ behavior: "ignoreErrors" });
    await goOnline(page);
    if (fixture) {
      await page.goto("/dashboard/lists");
      const res = await browserSend(page, "DELETE", "/api/lists", {
        listId: fixture.listId,
      });
      expect(res.status, res.body).toBe(200);
      fixture = null;
    }
  });

  test("personal grocery add survives offline reload, flapping and a lost committed response", async ({
    page,
  }, testInfo) => {
    fixture = await createList(page, testInfo, []);
    const listId = fixture.listId;
    const content =
      "Phone grocery with a long label that wraps on a narrow screen";
    const requests: Request[] = [];
    page.on("request", (request) => {
      if (
        request.method() === "POST" &&
        request.url().endsWith("/api/lists/items/grocery-add")
      )
        requests.push(request);
    });
    let mode: "unreachable" | "lose-response" | "send" = "unreachable";
    let committed: { item: { id: string } } | null = null;
    const replayed: string[] = [];
    await page.route("**/api/lists/items/grocery-add", async (route) => {
      if (mode === "unreachable") {
        await route.abort("internetdisconnected");
        return;
      }
      const response = await route.fetch();
      expect(response.status()).toBe(200);
      if (mode === "lose-response") {
        committed = await response.json();
        mode = "unreachable";
        await route.abort("connectionreset");
      } else {
        replayed.push(response.headers()["idempotency-replayed"]);
        await route.fulfill({ response });
      }
    });
    await page.goto(`/dashboard/lists/${listId}`);
    await goOffline(page);
    const section = page.getByRole("region", { name: "Grocery adds" });
    await section.getByRole("textbox", { name: "Add an item" }).fill(content);
    await section.getByRole("button", { name: "Add", exact: true }).click();
    const queued = page.getByTestId("queued-grocery-add");
    await expect(queued).toHaveAttribute("data-sync-state", "pending");
    await expect(queued).toContainText("Waiting to add");
    await expect(section).not.toContainText("confirmed");
    expect(requests).toHaveLength(0);
    await expect(page.getByTestId("app-offline-banner")).toBeVisible();
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({
      path: testInfo.outputPath("personal-grocery-pending.png"),
      fullPage: true,
    });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    for (const button of await queued.getByRole("button").all()) {
      const box = await button.boundingBox();
      expect(box!.height).toBeGreaterThanOrEqual(44);
      expect(box!.width).toBeGreaterThanOrEqual(44);
    }
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    await goOnline(page);
    await page.reload(); // app shell reachable, write endpoint still unavailable
    await expect(queued).toHaveAttribute("data-sync-state", /pending|syncing/);
    const empty = await browserFetch(page, `/api/lists/items?listId=${listId}`);
    expect(JSON.parse(empty.body).items).toHaveLength(0);
    mode = "lose-response";
    await goOffline(page);
    await goOnline(page);
    await expect.poll(() => committed).not.toBeNull();
    await goOffline(page);
    await expect(queued).toHaveAttribute("data-sync-state", "pending");
    await goOnline(page);
    await page.reload();
    await expect(queued).toHaveAttribute("data-sync-state", /pending|syncing/);
    const once = await browserFetch(page, `/api/lists/items?listId=${listId}`);
    expect(JSON.parse(once.body).items).toHaveLength(1);
    mode = "send";
    await goOffline(page);
    await goOnline(page);
    await expect(queued).toHaveCount(0, { timeout: 20_000 });
    await expect(section).toContainText("Grocery add confirmed");
    await expect(page.getByRole("checkbox", { name: content })).toBeVisible();
    expect(requests.length).toBeGreaterThanOrEqual(3);
    expect(
      new Set(requests.map((request) => request.headers()["idempotency-key"]))
        .size,
    ).toBe(1);
    for (const request of requests)
      expect(request.postDataJSON()).toEqual({ listId, content });
    expect(replayed).toContain("true");
    const final = await browserFetch(page, `/api/lists/items?listId=${listId}`);
    expect(
      JSON.parse(final.body).items.map((item: { id: string }) => item.id),
    ).toEqual([committed!.item.id]);
    await page.reload();
    await expect(page.getByRole("checkbox", { name: content })).toBeVisible();
    await expect(queued).toHaveCount(0);
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({
      path: testInfo.outputPath("personal-grocery-confirmed.png"),
      fullPage: true,
    });
  });

  test("a failed personal add retries the same intent and a deleted list keeps recovery after reload", async ({
    page,
  }, testInfo) => {
    fixture = await createList(page, testInfo, []);
    const listId = fixture.listId;
    const keys: string[] = [];
    let fail = true;
    await page.route("**/api/lists/items/grocery-add", async (route) => {
      keys.push(route.request().headers()["idempotency-key"]);
      if (fail)
        await route.fulfill({
          status: 422,
          contentType: "application/json",
          body: JSON.stringify({
            error: { code: "INVALID", message: "Rejected test add" },
          }),
        });
      else await route.continue();
    });
    await page.goto(`/dashboard/lists/${listId}`);
    const section = page.getByRole("region", { name: "Grocery adds" });
    await section.getByRole("textbox").fill("Retry recovery milk");
    await section.getByRole("button", { name: "Add", exact: true }).click();
    const queued = page.getByTestId("queued-grocery-add");
    await expect(queued).toHaveAttribute("data-sync-state", "failed");
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({
      path: testInfo.outputPath("personal-grocery-failed.png"),
      fullPage: true,
    });
    fail = false;
    await queued.getByRole("button", { name: "Retry add" }).click();
    await expect(queued).toHaveCount(0);
    await expect(
      page.getByRole("checkbox", { name: "Retry recovery milk" }),
    ).toBeVisible();
    expect(keys).toHaveLength(2);
    expect(keys[0]).toBe(keys[1]);
    await goOffline(page);
    await section.getByRole("textbox").fill("Deleted-list groceries");
    await section.getByRole("button", { name: "Add", exact: true }).click();
    await expect(queued).toHaveAttribute("data-sync-state", "pending");
    // Block this new send while deleting the canonical list through the authenticated API.
    await page.unroute("**/api/lists/items/grocery-add");
    await page.route("**/api/lists/items/grocery-add", (route) =>
      route.abort("internetdisconnected"),
    );
    await goOnline(page);
    const deleted = await browserSend(page, "DELETE", "/api/lists", { listId });
    expect(deleted.status, deleted.body).toBe(200);
    fixture = null; // the owned list was already deleted
    await page.unroute("**/api/lists/items/grocery-add");
    await page.reload();
    await expect(
      page.getByText("List not found", { exact: true }),
    ).toBeVisible();
    await expect(queued).toHaveAttribute("data-sync-state", "conflict");
    await expect(queued).toContainText("no longer available");
    await expect(section.getByRole("textbox")).toHaveCount(0);
    await page.reload();
    await expect(queued).toHaveAttribute("data-sync-state", "conflict");
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({
      path: testInfo.outputPath("personal-grocery-missing-list.png"),
      fullPage: true,
    });
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    await queued.getByRole("button", { name: "Remove queued add" }).click();
    await expect(queued).toHaveCount(0);
    await expect(section).toContainText("previous send may have added it");
  });

  test("a queued phone add reaches the paired board through its bounded version refresh", async ({
    page,
    browser,
  }, testInfo) => {
    fixture = await createList(page, testInfo, []);
    const listId = fixture.listId;
    const context = await browser.newContext({
      baseURL: E2E_BASE_URL,
      viewport: { width: 1280, height: 800 },
      serviceWorkers: "block",
      storageState: { cookies: [], origins: [] },
    });
    const tablet = await context.newPage();
    await tablet.clock.install({ time: E2E_ANCHOR });
    let deviceId: string | null = null;
    try {
      await page.goto("/dashboard/settings/devices");
      const paired = await browserSend(
        page,
        "POST",
        "/api/family/devices/pairings",
        { label: "Offline phone add proof" },
      );
      expect(paired.status, paired.body).toBe(201);
      const { pairingId, code } = JSON.parse(paired.body);
      await tablet.goto("/device/pair");
      const claim = await browserSend(
        tablet,
        "POST",
        "/api/device/pair/claim",
        { code, platform: "web", appVersion: "web" },
      );
      expect(claim.status, claim.body).toBe(200);
      const { claimToken, confirmDigits } = JSON.parse(claim.body);
      const confirmed = await browserSend(
        page,
        "POST",
        `/api/family/devices/pairings/${pairingId}/confirm`,
        { digits: confirmDigits },
      );
      expect(confirmed.status, confirmed.body).toBe(200);
      const status = await browserSend(
        tablet,
        "POST",
        "/api/device/pair/status",
        { claimToken },
      );
      expect(status.status).toBe(200);
      deviceId = JSON.parse(status.body).device.id;
      await tablet.goto("/device/today");
      const initial = await browserFetch(tablet, "/api/device/today");
      expect(initial.status).toBe(200);
      const before = JSON.parse(initial.body);
      const groceries = tablet.getByRole("region", {
        name: "Groceries",
        exact: true,
      });
      await expect(groceries).toContainText(`${before.shopping.total} to buy`);
      await page.goto(`/dashboard/lists/${listId}`);
      await goOffline(page);
      const adds = page.getByRole("region", { name: "Grocery adds" });
      await adds.getByRole("textbox").fill("Phone to shared board proof");
      await adds.getByRole("button", { name: "Add", exact: true }).click();
      await expect(page.getByTestId("queued-grocery-add")).toHaveAttribute(
        "data-sync-state",
        "pending",
      );
      await expect(groceries).toContainText(`${before.shopping.total} to buy`);
      await goOnline(page);
      await expect(page.getByTestId("queued-grocery-add")).toHaveCount(0);
      await expect(
        page.getByRole("checkbox", { name: "Phone to shared board proof" }),
      ).toBeVisible();
      // Normal version timer, no page reload or full-board polling per write.
      await tablet.clock.fastForward(26_000);
      await expect(groceries).toContainText(
        `${before.shopping.total + 1} to buy`,
      );
      const after = await browserFetch(tablet, "/api/device/today");
      const board = JSON.parse(after.body);
      expect(board.version).not.toBe(before.version);
      expect(board.shopping.total).toBe(before.shopping.total + 1);
      expect(
        board.groceryLists.some((list: { id: string }) => list.id === listId),
      ).toBe(true);
      await tablet.screenshot({
        path: testInfo.outputPath("personal-grocery-shared-board.png"),
        fullPage: true,
      });
      // The board deliberately displays the oldest five rows, so this proves
      // canonical count/version propagation, not that every new row is shown.
    } finally {
      await goOnline(page);
      if (deviceId) {
        const revoked = await browserSend(
          page,
          "POST",
          `/api/family/devices/${deviceId}/revoke`,
          { reason: "other" },
        );
        expect(revoked.status, revoked.body).toBe(200);
      }
      await context.close();
    }
  });

  test("a keyed personal grocery create survives a lost response without resurrecting a deleted item", async ({
    page,
  }, testInfo) => {
    fixture = await createList(page, testInfo, []);
    const listId = fixture.listId;
    const key = await page.evaluate(() => crypto.randomUUID());
    const submit = () =>
      page.evaluate(
        async ({ listId, key }) => {
          const csrf =
            document.cookie
              .split("; ")
              .find((c) => c.startsWith("csrf_token="))
              ?.slice("csrf_token=".length) ?? "";
          try {
            const response = await fetch("/api/lists/items/create", {
              method: "POST",
              credentials: "same-origin",
              headers: {
                "Content-Type": "application/json",
                "X-CSRF-Token": csrf,
                "Idempotency-Key": key,
              },
              body: JSON.stringify({ listId, content: "Retry-safe grocery" }),
            });
            return {
              status: response.status,
              replayed: response.headers.get("Idempotency-Replayed"),
              body: await response.json(),
            };
          } catch {
            return { status: 0, replayed: null, body: null };
          }
        },
        { listId, key },
      );
    await page.route("**/api/lists/items/create", async (route) => {
      const committed = await route.fetch();
      expect(committed.status()).toBe(200);
      await route.abort("failed");
    });
    expect((await submit()).status).toBe(0);
    await page.unroute("**/api/lists/items/create");
    await page.reload();
    const replay = await submit();
    expect(replay.status).toBe(200);
    expect(replay.replayed).toBe("true");
    const items = await browserFetch(page, `/api/lists/items?listId=${listId}`);
    expect(JSON.parse(items.body).items).toHaveLength(1);
    const deleted = await browserSend(
      page,
      "DELETE",
      `/api/lists/items/${replay.body.item.id}`,
    );
    expect(deleted.status, deleted.body).toBe(200);
    const afterDelete = await submit();
    expect(afterDelete.replayed).toBe("true");
    expect(afterDelete.body).toEqual(replay.body);
    const empty = await browserFetch(page, `/api/lists/items?listId=${listId}`);
    expect(JSON.parse(empty.body).items).toHaveLength(0);
  });

  test("local support report counts failures and conflicts without household content", async ({
    page,
  }, testInfo) => {
    fixture = await createList(page, testInfo, [
      "Private failed grocery",
      "Private conflicting grocery",
    ]);
    const failedId = fixture.items["Private failed grocery"];
    const conflictId = fixture.items["Private conflicting grocery"];
    await page.route(UPDATE_URL, async (route) => {
      const body = route.request().postDataJSON();
      await route.fulfill({
        status: body.itemId === conflictId ? 409 : 422,
        contentType: "application/json",
        body: JSON.stringify({
          error: {
            code: body.itemId === conflictId ? "CONFLICT" : "INVALID",
            message: "Private error details",
          },
        }),
      });
    });
    await page.goto(`/dashboard/lists/${fixture.listId}`);
    await row(page, failedId).getByRole("checkbox").click();
    await expect(row(page, failedId)).toHaveAttribute(
      "data-sync-state",
      "failed",
    );
    await row(page, conflictId).getByRole("checkbox").click();
    await expect(row(page, conflictId)).toHaveAttribute(
      "data-sync-state",
      "conflict",
    );
    const updates = trackUpdates(page);
    await page.getByRole("button", { name: "User menu", exact: true }).click();
    await page.getByRole("link", { name: "Help", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: "Help", exact: true }),
    ).toBeVisible();
    await page.getByRole("button", { name: "View sync details" }).click();
    await expect(page.getByText(/2 queued changes/)).toBeVisible();
    await page.getByText("Report for support", { exact: true }).click();
    const report = page.getByTestId("sync-diagnostics-report");
    await expect(report).toBeVisible();
    const data = JSON.parse(await report.innerText());
    expect(data.replay).toEqual({
      attempts: 2,
      completed: 2,
      successes: 0,
      failures: 2,
      conflicts: 1,
    });
    expect(data.states).toEqual({
      pending: 0,
      syncing: 0,
      failed: 1,
      conflict: 1,
    });
    expect(data.rates).toEqual({ success: 0, failure: 1, conflict: 0.5 });
    expect(await report.innerText()).not.toMatch(
      /Private|itemId|listId|payload|key-|parent.a@example/,
    );
    expect(await report.innerText()).not.toContain(failedId);
    expect(await report.innerText()).not.toContain(conflictId);
    expect(updates).toHaveLength(0);
    const scan = await new AxeBuilder({ page })
      .include('[aria-labelledby="help-sync"]')
      .withTags(["wcag2a", "wcag2aa"])
      .analyze();
    expect(scan.violations).toEqual([]);
    await page.screenshot({
      path: testInfo.outputPath("sync-report.png"),
      fullPage: true,
      animations: "disabled",
    });
  });

  test("offline tick is pending, survives a reload and syncs exactly once", async ({
    page,
  }, testInfo) => {
    fixture = await createList(page, testInfo, ["Sync apples"]);
    const itemId = fixture.items["Sync apples"];
    const updates = trackUpdates(page);
    await page.goto(`/dashboard/lists/${fixture.listId}`);
    const item = row(page, itemId);
    await expect(item).toBeVisible();

    await goOffline(page);
    // One offline message (OFFLINE_SYNC.md): the app banner says offline, the
    // list adds what ticks do offline.
    await expect(page.getByTestId("app-offline-banner")).toBeVisible();
    await expect(page.getByTestId("list-offline-detail")).toContainText(
      "You can still tick items.",
    );
    await expect(page.getByTestId("list-offline-detail")).not.toContainText(
      "offline",
    );
    await item.getByRole("checkbox").click();
    await expect(item).toHaveAttribute("data-sync-state", "pending");
    await expect(item).toContainText("Waiting to sync");
    await expect(item.getByRole("checkbox")).toHaveAttribute(
      "aria-checked",
      "true",
    );

    // Restart: the mutation endpoint stays unreachable across the reload.
    await page.route(UPDATE_URL, (route) =>
      route.abort("internetdisconnected"),
    );
    await goOnline(page);
    await page.reload();
    await expect(item.getByRole("checkbox")).toHaveAttribute(
      "aria-checked",
      "true",
    );
    await expect(item).toHaveAttribute("data-sync-state", /pending|syncing/);
    expect((await serverItem(page, fixture.listId, itemId)).checked).toBe(
      false,
    );

    // The network comes back (a flap triggers an immediate retry).
    await page.unroute(UPDATE_URL);
    await goOffline(page);
    await goOnline(page);
    await expect(item).toHaveAttribute("data-sync-state", "synced", {
      timeout: 20_000,
    });
    await expect(item).toContainText("Synced");
    const server = await serverItem(page, fixture.listId, itemId);
    expect(server.checked).toBe(true);

    // Every attempt carried the same key; the server applied it once.
    const keys = new Set(
      updates.map((r) => r.headers()["idempotency-key"]).filter(Boolean),
    );
    expect(keys.size).toBe(1);
    // request.failure() is still null while an aborted request is settling.
    // Await each response before classifying actual successful deliveries.
    const responses = await Promise.all(
      updates.map((request) => request.response()),
    );
    const delivered = responses.filter(
      (response) => response?.status() === 200,
    );
    expect(delivered.length).toBeGreaterThanOrEqual(1);
    for (const response of delivered.slice(1)) {
      expect(response!.headers()["idempotency-replayed"]).toBe("true");
    }

    // The confirmed state is what a fresh load shows.
    await page.reload();
    await expect(item.getByRole("checkbox")).toHaveAttribute(
      "aria-checked",
      "true",
    );
    await expect(item).not.toHaveAttribute("data-sync-state", /.+/);
  });

  test("a lost response is retried with the same key and replayed, not applied twice", async ({
    page,
  }, testInfo) => {
    fixture = await createList(page, testInfo, ["Sync bread"]);
    const itemId = fixture.items["Sync bread"];
    const first: { body: { item: { checked_at: string } } | null } = {
      body: null,
    };
    const keys: string[] = [];
    const replayed: Array<string | undefined> = [];
    await page.route(UPDATE_URL, async (route) => {
      keys.push(route.request().headers()["idempotency-key"]);
      if (!first.body) {
        // The server applies the change, but the response never arrives.
        const response = await route.fetch();
        first.body = await response.json();
        await route.abort("connectionreset");
        return;
      }
      const response = await route.fetch();
      replayed.push(response.headers()["idempotency-replayed"]);
      await route.fulfill({ response });
    });

    await page.goto(`/dashboard/lists/${fixture.listId}`);
    const item = row(page, itemId);
    await item.getByRole("checkbox").click();
    await expect(item).toHaveAttribute("data-sync-state", "synced", {
      timeout: 20_000,
    });

    expect(keys.length).toBeGreaterThanOrEqual(2);
    expect(new Set(keys).size).toBe(1);
    expect(replayed[0]).toBe("true");
    const server = await serverItem(page, fixture.listId, itemId);
    expect(server.checked).toBe(true);
    // Applied once: the timestamp is the first (lost) request's.
    expect(server.checked_at).toBe(first.body!.item.checked_at);
  });

  test("a rejected change stays visible as failed and can be retried", async ({
    page,
  }, testInfo) => {
    fixture = await createList(page, testInfo, ["Sync eggs"]);
    const itemId = fixture.items["Sync eggs"];
    await page.route(UPDATE_URL, (route) =>
      route.fulfill({
        status: 400,
        contentType: "application/json",
        body: JSON.stringify({ error: "Rejected in test" }),
      }),
    );
    await page.goto(`/dashboard/lists/${fixture.listId}`);
    const item = row(page, itemId);
    await item.getByRole("checkbox").click();
    await expect(item).toHaveAttribute("data-sync-state", "failed");
    await expect(item).toContainText("Couldn’t sync this change");
    const retry = item.getByRole("button", { name: "Retry syncing Sync eggs" });
    await expect(retry).toBeVisible();
    expect((await serverItem(page, fixture.listId, itemId)).checked).toBe(
      false,
    );

    // Still there after a reload: failed changes are never dropped silently.
    await page.reload();
    await expect(item).toHaveAttribute("data-sync-state", "failed");

    await page.unroute(UPDATE_URL);
    await retry.click();
    await expect(item).toHaveAttribute("data-sync-state", "synced", {
      timeout: 20_000,
    });
    expect((await serverItem(page, fixture.listId, itemId)).checked).toBe(true);
  });

  test("an item removed elsewhere is a conflict that can be discarded", async ({
    page,
  }, testInfo) => {
    fixture = await createList(page, testInfo, ["Sync jam", "Sync tea"]);
    const itemId = fixture.items["Sync jam"];
    await page.goto(`/dashboard/lists/${fixture.listId}`);
    const item = row(page, itemId);
    await expect(item).toBeVisible();
    // Another device deletes the item while this page still shows it.
    const del = await browserSend(
      page,
      "DELETE",
      `/api/lists/items/delete?itemId=${itemId}`,
    );
    expect(del.status, del.body).toBe(200);

    await item.getByRole("checkbox").click();
    await expect(item).toHaveAttribute("data-sync-state", "conflict");
    await expect(item).toContainText("this item was removed");
    await item
      .getByRole("button", { name: "Discard change to Sync jam" })
      .click();
    await expect(item).not.toHaveAttribute("data-sync-state", /.+/);
    await expect(item.getByRole("checkbox")).toHaveAttribute(
      "aria-checked",
      "false",
    );
  });
});

test.describe("offline grocery ticks: sign-out", () => {
  // Sign-out revokes every session of the user; use an account that is not
  // shared through e2e/.auth storage state (as journeys.spec.ts does).
  test("drops queued changes; nothing is replayed", async ({
    page,
    browser,
  }, testInfo) => {
    onlyOnSomeProjects(testInfo);
    await loginViaUi(page, FIXTURE_EMAILS.familyA.teen);
    await expect(page).toHaveURL(/\/dashboard$/);
    // A teen may create lists (D9); deleting it at the end is parent-only.
    const fixture = await createList(page, testInfo, ["Sync milk"]);
    const itemId = fixture.items["Sync milk"];
    await page.goto(`/dashboard/lists/${fixture.listId}`);
    const item = row(page, itemId);
    await goOffline(page);
    await item.getByRole("checkbox").click();
    await expect(item).toHaveAttribute("data-sync-state", "pending");
    const adds = page.getByRole("region", { name: "Grocery adds" });
    await adds.getByRole("textbox").fill("Signed-out queued grocery");
    await adds.getByRole("button", { name: "Add", exact: true }).click();
    await expect(page.getByTestId("queued-grocery-add")).toHaveAttribute(
      "data-sync-state",
      "pending",
    );
    await page.route("**/api/lists/items/grocery-add", (route) =>
      route.abort("internetdisconnected"),
    );

    await page.route(UPDATE_URL, (route) =>
      route.abort("internetdisconnected"),
    );
    await goOnline(page);
    await page.getByRole("button", { name: "User menu" }).click();
    await page.getByRole("button", { name: "Sign Out" }).click();
    await expect(page).toHaveURL(/\/login$/);

    const leftovers = await page.evaluate(async () => {
      const keys = Object.keys(window.localStorage).filter((k) =>
        k.startsWith("fp-sync:"),
      );
      const dbs = (await indexedDB.databases?.()) ?? [];
      const store = dbs.some((d) => d.name === "fp-sync")
        ? await new Promise<string | null>((resolve) => {
            const open = indexedDB.open("fp-sync");
            open.onsuccess = () => {
              const db = open.result;
              if (!db.objectStoreNames.contains("kv")) return resolve(null);
              const get = db.transaction("kv").objectStore("kv").getAllKeys();
              get.onsuccess = () =>
                resolve(get.result.length ? String(get.result) : null);
            };
            open.onerror = () => resolve(null);
          })
        : null;
      return { keys, store };
    });
    expect(leftovers).toEqual({ keys: [], store: null });
    await page.unroute(UPDATE_URL);

    // Nothing reached the server.
    const parentContext = await browser.newContext({
      storageState: authFile("parentA"),
      baseURL: E2E_BASE_URL,
    });
    const parentPage = await parentContext.newPage();
    await parentPage.goto("/dashboard/lists");
    expect((await serverItem(parentPage, fixture.listId, itemId)).checked).toBe(
      false,
    );
    const noAdd = await browserFetch(
      parentPage,
      `/api/lists/items?listId=${fixture.listId}`,
    );
    expect(JSON.parse(noAdd.body).items).toHaveLength(1);
    expect(noAdd.body).not.toContain("Signed-out queued grocery");
    const cleanup = await browserSend(parentPage, "DELETE", "/api/lists", {
      listId: fixture.listId,
    });
    expect(cleanup.status).toBe(200);
    await parentContext.close();
  });
});
