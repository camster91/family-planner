/** #473: a paired tablet must retain unread queue bytes until explicit recovery. */
import type { Browser, BrowserContext, Page, TestInfo } from "@playwright/test";
import { FIXTURE_IDS } from "../src/lib/fixtures/dataset";
import { E2E_ANCHOR, authFile } from "./support/env";
import { browserFetch, browserSend, expect, test } from "./support/test";
import {
  checkGroceryControls,
  groceryText,
} from "./support/grocery-localization";

const A = FIXTURE_IDS.familyA;
const DEVICE_QUEUE_KEY = "fp-device:v1:queue";
const DEVICE_QUEUE_DB = "fp-device";
const PARENT_NAME = "Avery Fixture-A";

type RecoveryWindow = Window & {
  __deviceQueueReadRecovery: {
    unblock(): void;
    read(): Promise<{ indexed: string | null; local: string | null }>;
  };
};

async function openParent(
  browser: Browser,
  testInfo: TestInfo,
): Promise<{ context: BrowserContext; page: Page }> {
  const use = testInfo.project.use;
  const context = await browser.newContext({
    baseURL: use.baseURL,
    viewport: use.viewport,
    deviceScaleFactor: use.deviceScaleFactor,
    hasTouch: use.hasTouch,
    isMobile: use.isMobile,
    locale: use.locale,
    timezoneId: use.timezoneId,
    colorScheme: "light",
    reducedMotion: "reduce",
    extraHTTPHeaders: use.extraHTTPHeaders,
    storageState: authFile("parentA"),
  });
  const page = await context.newPage();
  await page.clock.install({ time: E2E_ANCHOR });
  return { context, page };
}

async function pairViaApi(
  parent: Page,
  tablet: Page,
  label: string,
): Promise<string> {
  await parent.goto("/dashboard/settings/devices");
  const created = await browserSend(
    parent,
    "POST",
    "/api/family/devices/pairings",
    { label },
  );
  expect(created.status, created.body).toBe(201);
  const { pairingId, code } = JSON.parse(created.body) as {
    pairingId: string;
    code: string;
  };

  await tablet.goto("/device/pair");
  const claim = await browserSend(tablet, "POST", "/api/device/pair/claim", {
    code,
    platform: "web",
    appVersion: "web",
  });
  expect(claim.status, claim.body).toBe(200);
  const { claimToken, confirmDigits } = JSON.parse(claim.body) as {
    claimToken: string;
    confirmDigits: string;
  };
  const confirmed = await browserSend(
    parent,
    "POST",
    `/api/family/devices/pairings/${pairingId}/confirm`,
    { digits: confirmDigits },
  );
  expect(confirmed.status, confirmed.body).toBe(200);

  const status = await browserSend(tablet, "POST", "/api/device/pair/status", {
    claimToken,
  });
  expect(status.status, status.body).toBe(200);
  const body = JSON.parse(status.body) as {
    status: string;
    device: { id: string };
  };
  expect(body.status).toBe("paired");
  return body.device.id;
}

async function seedDeviceQueue(
  page: Page,
  key: string,
  raw: string,
): Promise<void> {
  await page.evaluate(
    async ({ dbName, key: queueKey, raw: queueRaw }) => {
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open(dbName, 1);
        request.onupgradeneeded = () => {
          if (!request.result.objectStoreNames.contains("kv"))
            request.result.createObjectStore("kv");
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      try {
        await new Promise<void>((resolve, reject) => {
          const tx = db.transaction("kv", "readwrite");
          tx.objectStore("kv").put(queueRaw, queueKey);
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error);
        });
        localStorage.setItem(queueKey, queueRaw);
      } finally {
        db.close();
      }
    },
    { dbName: DEVICE_QUEUE_DB, key, raw },
  );
}

for (const locale of ["en", "es"] as const) {
  test(`${locale}: paired-device queue read recovery preserves draft and pending tick`, async ({
    page: tablet,
    browser,
  }, testInfo) => {
    const text = groceryText(locale);
    const parent = await openParent(browser, testInfo);
    const listName = `Device recovery ${locale} ${testInfo.project.name}`;
    const draft = `Unsent tablet draft ${locale} ${testInfo.project.name}`;
    const operationKey =
      `device-recovery-${locale}-${testInfo.project.name}`.replace(
        /[^A-Za-z0-9_-]/g,
        "-",
      );
    let listId = "";
    let deviceId = "";
    let originalDeviceWrites: boolean | undefined;
    const sentKeys: string[] = [];

    await tablet.addInitScript((queueKey) => {
      let blocked = true;
      const indexedGet = IDBObjectStore.prototype.get;
      const localGet = Storage.prototype.getItem;
      IDBObjectStore.prototype.get = function (target) {
        if (blocked && target === queueKey)
          throw new DOMException(
            "QA device queue read unavailable",
            "UnknownError",
          );
        return indexedGet.call(this, target);
      };
      Storage.prototype.getItem = function (target) {
        if (blocked && target === queueKey)
          throw new DOMException(
            "QA device queue read unavailable",
            "SecurityError",
          );
        return localGet.call(this, target);
      };
      (window as unknown as RecoveryWindow).__deviceQueueReadRecovery = {
        unblock() {
          blocked = false;
        },
        async read() {
          const db = await new Promise<IDBDatabase>((resolve, reject) => {
            const request = indexedDB.open("fp-device", 1);
            request.onupgradeneeded = () => {
              if (!request.result.objectStoreNames.contains("kv"))
                request.result.createObjectStore("kv");
            };
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
          });
          try {
            const indexed = await new Promise<string | null>(
              (resolve, reject) => {
                const tx = db.transaction("kv", "readonly");
                const request = indexedGet.call(tx.objectStore("kv"), queueKey);
                request.onsuccess = () => resolve(request.result ?? null);
                request.onerror = () => reject(request.error);
              },
            );
            return { indexed, local: localGet.call(localStorage, queueKey) };
          } finally {
            db.close();
          }
        },
      };
    }, DEVICE_QUEUE_KEY);

    tablet.on("request", (request) => {
      if (
        request.method() === "PATCH" &&
        new URL(request.url()).pathname.startsWith("/api/device/lists/items/")
      )
        sentKeys.push(request.headers()["idempotency-key"] ?? "");
    });

    try {
      const settings = await browserFetch(
        parent.page,
        "/api/family/board-settings",
      );
      expect(settings.status, settings.body).toBe(200);
      originalDeviceWrites = JSON.parse(settings.body).deviceWrites.enabled;
      const enabled = await browserSend(
        parent.page,
        "PATCH",
        "/api/family/board-settings",
        { deviceWrites: { enabled: true } },
      );
      expect(enabled.status, enabled.body).toBe(200);

      const created = await browserSend(
        parent.page,
        "POST",
        "/api/lists/create",
        {
          name: listName,
          type: "grocery",
        },
      );
      expect(created.status, created.body).toBe(200);
      listId = JSON.parse(created.body).list.id;
      const added = await browserSend(
        parent.page,
        "POST",
        "/api/lists/items/create",
        {
          listId,
          content: `Seeded tablet item ${locale}`,
        },
      );
      expect(added.status, added.body).toBe(200);
      const itemId: string = JSON.parse(added.body).item.id;

      deviceId = await pairViaApi(
        parent.page,
        tablet,
        `Storage recovery ${locale} ${testInfo.project.name}`,
      );
      const raw = JSON.stringify({
        v: 1,
        ops: [
          {
            id: operationKey,
            action: "device.list-item.set-checked",
            v: 1,
            payload: {
              itemId,
              checked: true,
              actingMemberId: A.parent,
            },
            createdAt: new Date(E2E_ANCHOR).getTime(),
            state: "pending",
            attempts: 0,
            nextAttemptAt: 0,
          },
        ],
      });
      await seedDeviceQueue(tablet, DEVICE_QUEUE_KEY, raw);
      await tablet.goto("/device/today");

      const recovery = tablet.getByTestId("queue-storage-recovery");
      await expect(recovery).toHaveCount(1);
      await expect(recovery).toContainText(text("storageUnavailable"));
      await expect(
        tablet.getByRole("button", { name: text("storageRetry"), exact: true }),
      ).toBeVisible();

      await tablet
        .getByRole("button", { name: text("deviceTitle"), exact: true })
        .click();
      await tablet
        .getByTestId("who-is-this")
        .getByRole("button", { name: PARENT_NAME, exact: true })
        .click();
      const dialog = tablet.getByTestId("device-grocery-add");
      await dialog
        .getByLabel(text("groceryList"), { exact: true })
        .selectOption(listId);
      await dialog.getByLabel(text("item"), { exact: true }).fill(draft);
      await expect(
        dialog.getByLabel(text("item"), { exact: true }),
      ).toHaveValue(draft);
      await checkGroceryControls(
        tablet,
        recovery,
        testInfo,
        `device-storage-recovery-${locale}`,
      );
      await dialog
        .getByRole("button", { name: text("addItem"), exact: true })
        .click();
      await expect(dialog).toBeVisible();
      await expect(
        dialog.getByLabel(text("item"), { exact: true }),
      ).toHaveValue(draft);
      await expect(dialog.getByTestId("queue-storage-recovery")).toHaveCount(1);
      await expect(recovery).toHaveCount(1);
      expect(sentKeys).toEqual([]);
      expect(
        await tablet.evaluate(() =>
          (
            window as unknown as RecoveryWindow
          ).__deviceQueueReadRecovery.read(),
        ),
      ).toEqual({ indexed: raw, local: raw });

      await tablet.evaluate(() =>
        (
          window as unknown as RecoveryWindow
        ).__deviceQueueReadRecovery.unblock(),
      );
      const replay = tablet.waitForRequest(
        (request) =>
          request.method() === "PATCH" &&
          request.url().endsWith(`/api/device/lists/items/${itemId}`),
      );
      const response = tablet.waitForResponse(
        (response) =>
          response.request().method() === "PATCH" &&
          new URL(response.url()).pathname ===
            `/api/device/lists/items/${itemId}`,
      );
      await recovery
        .getByRole("button", { name: text("storageRetry"), exact: true })
        .click();
      const replayRequest = await replay;
      expect((await response).status()).toBe(200);
      expect(replayRequest.headers()["idempotency-key"]).toBe(operationKey);
      expect(replayRequest.postDataJSON()).toEqual({
        checked: true,
        actingMemberId: A.parent,
      });
      expect(sentKeys).toEqual([operationKey]);
      await expect(recovery).toHaveCount(0);
      await expect(
        dialog.getByLabel(text("item"), { exact: true }),
      ).toHaveValue(draft);

      const canonical = await browserFetch(
        parent.page,
        `/api/lists/items?listId=${listId}`,
      );
      expect(canonical.status, canonical.body).toBe(200);
      const canonicalItem = JSON.parse(canonical.body).items.find(
        (item: { id: string }) => item.id === itemId,
      );
      expect(canonicalItem.checked).toBe(true);
      await expect
        .poll(() =>
          tablet.evaluate(() =>
            (
              window as unknown as RecoveryWindow
            ).__deviceQueueReadRecovery.read(),
          ),
        )
        .toEqual({ indexed: null, local: null });
      await tablet.screenshot({
        path: testInfo.outputPath(`${locale}-device-storage-recovered.png`),
        fullPage: true,
        animations: "disabled",
      });
    } finally {
      await tablet
        .evaluate(() =>
          (
            window as unknown as RecoveryWindow
          ).__deviceQueueReadRecovery?.unblock(),
        )
        .catch(() => {});
      if (deviceId) {
        const revoked = await browserSend(
          parent.page,
          "POST",
          `/api/family/devices/${deviceId}/revoke`,
          { reason: "other" },
        );
        expect(revoked.status, revoked.body).toBe(200);
      }
      if (listId) {
        const deleted = await browserSend(parent.page, "DELETE", "/api/lists", {
          listId,
        });
        expect(deleted.status, deleted.body).toBe(200);
      }
      if (originalDeviceWrites !== undefined) {
        const restored = await browserSend(
          parent.page,
          "PATCH",
          "/api/family/board-settings",
          { deviceWrites: { enabled: originalDeviceWrites } },
        );
        expect(restored.status, restored.body).toBe(200);
      }
      await parent.context.close();
    }
  });
}
