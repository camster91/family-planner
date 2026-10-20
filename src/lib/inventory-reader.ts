/** One bounded refresh generation. No persistence, provider or mutation. */
import {
  inventoryReadPage,
  inventoryUseSoonPage,
  inventoryHistoryPage,
} from "@/lib/inventory-read-contract";
import { cookSuggestionsSchema } from "@/lib/inventory-cook-contract";
import { INVENTORY_READ_SCOPE_HEADER } from "@/lib/inventory-read-scope";
import type { z } from "zod";
export const INVENTORY_REFRESH_MS = 15000;
export const INVENTORY_READ_BYTES = 2 * 1024 * 1024;
export const INVENTORY_ITEM_PAGE_SIZE = 500;
export const INVENTORY_ITEM_MAX_PAGES = 20;
export const INVENTORY_HISTORY_ROWS = 10;
export type InventoryRead<T> = { state: "ready"; data: T } | { state: "error" };
export type InventoryReadAccess = "context" | "unsupported" | null;
/** Even implementations that ignore AbortSignal must settle the owner promptly. */
function abortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const abort = () => reject(new Error("Inventory read aborted"));
    if (signal.aborted) {
      void promise.catch(() => undefined);
      abort();
      return;
    }
    signal.addEventListener("abort", abort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener("abort", abort);
        resolve(value);
      },
      (error) => {
        signal.removeEventListener("abort", abort);
        reject(error);
      },
    );
  });
}
async function boundedJson(
  response: Response,
  signal: AbortSignal,
): Promise<unknown> {
  const declared = Number(response.headers?.get("content-length"));
  if (declared > INVENTORY_READ_BYTES) {
    void response.body?.cancel().catch(() => undefined);
    throw new Error("Inventory response too large");
  }
  const reader = response.body?.getReader();
  if (!reader) {
    // Older fetch bridges/test doubles expose JSON only: post-parse bound,
    // not a claim of pre-allocation streaming protection on those platforms.
    const data: unknown = await abortable(response.json(), signal);
    const serialized = JSON.stringify(data);
    if (
      typeof serialized !== "string" ||
      new Blob([serialized]).size > INVENTORY_READ_BYTES
    )
      throw new Error("Inventory response too large");
    return data;
  }
  const abort = () => {
    void reader.cancel().catch(() => undefined);
  };
  signal.addEventListener("abort", abort, { once: true });
  const decoder = new TextDecoder();
  let size = 0,
    text = "";
  try {
    while (true) {
      const part = await abortable(reader.read(), signal);
      if (part.done) break;
      size += part.value.byteLength;
      if (size > INVENTORY_READ_BYTES) {
        void reader.cancel().catch(() => undefined);
        throw new Error("Inventory response too large");
      }
      text += decoder.decode(part.value, { stream: true });
    }
    if (signal.aborted) throw new Error("Inventory read aborted");
    return JSON.parse(text + decoder.decode());
  } finally {
    signal.removeEventListener("abort", abort);
    reader.releaseLock();
  }
}
export async function readInventorySnapshot(options: {
  scope?: string;
  today: string;
  mealsOn: boolean;
  signal: AbortSignal;
  fetchImpl?: typeof fetch;
}) {
  const controller = new AbortController();
  const signal = controller.signal;
  const abort = () => controller.abort();
  options.signal.addEventListener("abort", abort, { once: true });
  if (options.signal.aborted) abort();
  const timer = setTimeout(abort, INVENTORY_REFRESH_MS);
  let accessLost: InventoryReadAccess = null;
  const get = async <S extends z.ZodTypeAny>(
    url: string,
    schema: S,
  ): Promise<InventoryRead<z.infer<S>>> => {
    try {
      if (signal.aborted) throw new Error("Inventory read aborted");
      const response = await abortable(
        (options.fetchImpl ?? fetch)(url, {
          cache: "no-store",
          signal,
          headers: options.scope
            ? { [INVENTORY_READ_SCOPE_HEADER]: options.scope }
            : undefined,
        }),
        signal,
      );
      if (response.status === 401 || response.status === 403) {
        accessLost = "context";
        abort();
        throw new Error("Inventory access changed");
      }
      if (!response.ok) throw new Error("Inventory unavailable");
      if (
        options.scope &&
        response.headers?.get(INVENTORY_READ_SCOPE_HEADER) !== options.scope
      ) {
        accessLost = response.headers?.get(INVENTORY_READ_SCOPE_HEADER)
          ? "context"
          : "unsupported";
        abort();
        throw new Error("Inventory scope unavailable");
      }
      return {
        state: "ready",
        data: schema.parse(await boundedJson(response, signal)),
      };
    } catch {
      return { state: "error" };
    }
  };
  const q = `today=${encodeURIComponent(options.today)}`;
  const items = async (): Promise<
    InventoryRead<{
      items: z.infer<typeof inventoryReadPage>["items"];
      capped: boolean;
    }>
  > => {
    const all: z.infer<typeof inventoryReadPage>["items"] = [];
    const seen = new Set<string>();
    let offset: number | null = 0;
    for (
      let page = 0;
      offset !== null && page < INVENTORY_ITEM_MAX_PAGES;
      page++
    ) {
      const reply = await get(
        `/api/inventory?${q}&limit=${INVENTORY_ITEM_PAGE_SIZE}&offset=${offset}`,
        inventoryReadPage,
      );
      if (reply.state === "error") return reply;
      for (const item of reply.data.items) {
        if (seen.has(item.id)) return { state: "error" };
        seen.add(item.id);
        all.push(item);
      }
      const next: number | null = reply.data.nextOffset;
      if (
        next !== null &&
        (next !== offset + INVENTORY_ITEM_PAGE_SIZE ||
          reply.data.items.length === 0)
      )
        return { state: "error" };
      offset = next;
    }
    return { state: "ready", data: { items: all, capped: offset !== null } };
  };
  try {
    const [list, useSoon, cook, history] = await Promise.all([
      items(),
      get(`/api/inventory/use-soon?${q}&days=3`, inventoryUseSoonPage),
      options.mealsOn
        ? get(`/api/inventory/cook?${q}`, cookSuggestionsSchema)
        : Promise.resolve({
            state: "ready" as const,
            data: {
              suggestions: [],
              recipesConsidered: 0,
              truncated: false,
              inputsTruncated: false,
            },
          }),
      get(
        `/api/inventory/adjustments?limit=${INVENTORY_HISTORY_ROWS}`,
        inventoryHistoryPage,
      ),
    ]);
    return {
      list,
      useSoon,
      cook,
      history,
      accessLost: accessLost as InventoryReadAccess,
    };
  } finally {
    clearTimeout(timer);
    options.signal.removeEventListener("abort", abort);
  }
}
