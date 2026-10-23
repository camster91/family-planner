import { preserveQueueRecoveryProof } from "./support/queue-recovery-proof";
/** #473/#480: unread stored work must survive failed reads and deliberate recovery. */
import { FIXTURE_IDS } from "../src/lib/fixtures/dataset";
import { authFile, E2E_ANCHOR } from "./support/env";
import { browserFetch, browserSend, expect, test } from "./support/test";
import {
  checkGroceryControls,
  groceryText,
} from "./support/grocery-localization";

type RecoveryWindow = Window & {
  __queueReadRecovery: {
    unblock(): void;
    read(): Promise<{ indexed: string | null; local: string | null }>;
  };
};

test.use({ storageState: authFile("parentA") });
for (const locale of ["en", "es"] as const) {
  test(`${locale}: unread pending tick survives storage failure and one deliberate recovery`, async ({
    page,
  }, info) => {
    const key = `fp-sync:v1:${FIXTURE_IDS.familyA.parent}:queue`;
    const copy = groceryText(locale);
    let listId = "";
    const sent: Array<{ path: string; key: string | undefined }> = [];
    page.on("request", (request) => {
      const path = new URL(request.url()).pathname;
      if (
        (request.method() === "PATCH" && path === "/api/lists/items/update") ||
        (request.method() === "POST" && path === "/api/lists/items/grocery-add")
      )
        sent.push({ path, key: request.headers()["idempotency-key"] });
    });
    await page.addInitScript(
      ({ key, locale }) => {
        localStorage.setItem("familyPlanner_language", locale);
        let blocked = true;
        const get = IDBObjectStore.prototype.get;
        const localGet = Storage.prototype.getItem;
        IDBObjectStore.prototype.get = function (target) {
          if (blocked && target === key)
            throw new DOMException("QA read unavailable", "UnknownError");
          return get.call(this, target);
        };
        Storage.prototype.getItem = function (target) {
          if (blocked && target === key)
            throw new DOMException("QA read unavailable", "SecurityError");
          return localGet.call(this, target);
        };
        (window as unknown as RecoveryWindow).__queueReadRecovery = {
          unblock() {
            blocked = false;
          },
          async read() {
            const db = await new Promise<IDBDatabase>((resolve, reject) => {
              const request = indexedDB.open("fp-sync", 1);
              request.onupgradeneeded = () =>
                request.result.createObjectStore("kv");
              request.onsuccess = () => resolve(request.result);
              request.onerror = () => reject(request.error);
            });
            try {
              const indexed = await new Promise<string | null>(
                (resolve, reject) => {
                  const tx = db.transaction("kv", "readonly");
                  const request = get.call(tx.objectStore("kv"), key);
                  tx.oncomplete = () => resolve(request.result ?? null);
                  tx.onerror = () => reject(tx.error);
                },
              );
              return { indexed, local: localGet.call(localStorage, key) };
            } finally {
              db.close();
            }
          },
        };
      },
      { key, locale },
    );
    try {
      await page.goto("/dashboard/lists");
      const created = await browserSend(page, "POST", "/api/lists/create", {
        name: "Storage recovery fixture",
        type: "grocery",
      });
      expect(created.status).toBe(200);
      listId = JSON.parse(created.body).list.id;
      const added = await browserSend(page, "POST", "/api/lists/items/create", {
        listId,
        content: "Milk",
      });
      expect(added.status).toBe(200);
      const itemId: string = JSON.parse(added.body).item.id;
      const operationKey = `original-storage-${itemId}`;
      const raw = JSON.stringify({
        v: 1,
        ops: [
          {
            id: operationKey,
            action: "list-item.set-checked",
            v: 1,
            payload: { itemId, checked: true },
            createdAt: new Date(E2E_ANCHOR).getTime(),
            state: "pending",
            attempts: 0,
            nextAttemptAt: 0,
          },
        ],
      });
      await page.evaluate(
        async ({ key, raw }) => {
          const db = await new Promise<IDBDatabase>((resolve, reject) => {
            const request = indexedDB.open("fp-sync", 1);
            request.onupgradeneeded = () =>
              request.result.createObjectStore("kv");
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
          });
          try {
            await new Promise<void>((resolve, reject) => {
              const tx = db.transaction("kv", "readwrite");
              tx.objectStore("kv").put(raw, key);
              tx.oncomplete = () => resolve();
              tx.onerror = () => reject(tx.error);
            });
            localStorage.setItem(key, raw);
          } finally {
            db.close();
          }
        },
        { key, raw },
      );
      await page.goto(`/dashboard/lists/${listId}`);
      const recovery = page.getByTestId("queue-storage-recovery");
      await expect(recovery).toHaveCount(1);
      await expect(recovery).toContainText(copy("storageUnavailable"));
      await expect(page.getByRole("checkbox").first()).toBeDisabled();
      const input = page.getByRole("textbox", {
        name: copy("inputLabel"),
        exact: true,
      });
      await input.fill("Keep this unsent draft");
      await expect(
        page.getByRole("button", { name: copy("add"), exact: true }),
      ).toBeDisabled();
      await input.press("Enter");
      await expect(input).toHaveValue("Keep this unsent draft");
      expect(
        await page.evaluate(() =>
          (window as unknown as RecoveryWindow).__queueReadRecovery.read(),
        ),
      ).toEqual({ indexed: raw, local: raw });
      expect(sent).toEqual([]);
      await checkGroceryControls(
        page,
        recovery,
        info,
        `${locale}-storage-paused`,
      );

      await page.evaluate(() =>
        (window as unknown as RecoveryWindow).__queueReadRecovery.unblock(),
      );
      const updated = page.waitForResponse(
        (response) =>
          new URL(response.url()).pathname === "/api/lists/items/update" &&
          response.request().method() === "PATCH",
      );
      await recovery
        .getByRole("button", { name: copy("storageRetry"), exact: true })
        .click();
      expect((await updated).status()).toBe(200);
      await expect(recovery).toHaveCount(0);
      await expect(page.getByRole("checkbox").first()).toBeChecked();
      await expect(input).toHaveValue("Keep this unsent draft");
      expect(sent).toEqual([
        { path: "/api/lists/items/update", key: operationKey },
      ]);
      const items = await browserFetch(
        page,
        `/api/lists/items?listId=${listId}`,
      );
      expect(items.status).toBe(200);
      expect(
        JSON.parse(items.body).items.find(
          (row: { id: string }) => row.id === itemId,
        ).checked,
      ).toBe(true);
      await expect
        .poll(() =>
          page.evaluate(() =>
            (window as unknown as RecoveryWindow).__queueReadRecovery.read(),
          ),
        )
        .toEqual({ indexed: null, local: null });
      await page.screenshot({
        path: info.outputPath(`${locale}-storage-recovered.png`),
        fullPage: true,
        animations: "disabled",
      });
      await preserveQueueRecoveryProof(page, info, "person", locale, [
        `${locale}-storage-paused.png`,
        `${locale}-storage-recovered.png`,
      ]);
    } finally {
      await page
        .evaluate(() =>
          (window as unknown as RecoveryWindow).__queueReadRecovery?.unblock(),
        )
        .catch(() => {});
      if (listId)
        expect(
          (await browserSend(page, "DELETE", "/api/lists", { listId })).status,
        ).toBe(200);
    }
  });
}
