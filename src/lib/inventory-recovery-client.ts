/** Bounded negotiation/review reads; never sends stock writes or saves media. */
import {
  inventoryRecoveryContext,
  type InventoryRecoveryContext,
  type InventoryRecoveryEntry,
  INVENTORY_RECOVERY_OWNER_HEADER,
} from "@/lib/inventory-recovery-contract";
import {
  inventoryRecoveryReview,
  INVENTORY_RECOVERY_REVIEW_CONTRACT,
  type InventoryRecoveryReview,
} from "@/lib/inventory-recovery-review-contract";

export const INVENTORY_RECOVERY_REQUEST_MS = 10000;
const MAX_BYTES = 32768;
/** Even old native fetch bridges ignoring AbortSignal cannot hold the caller forever. */
async function requestJson(
  path: string,
  init: RequestInit,
  external?: AbortSignal,
): Promise<unknown> {
  const controller = new AbortController();
  let timeout: ReturnType<typeof setTimeout> | undefined;
  let listener: (() => void) | undefined;
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  const cancelled = new Promise<never>((_resolve, reject) => {
    listener = () => {
      controller.abort();
      void reader?.cancel().catch(() => undefined);
      reject(new Error("Inventory recovery unavailable"));
    };
    timeout = setTimeout(listener, INVENTORY_RECOVERY_REQUEST_MS);
    external?.addEventListener("abort", listener, { once: true });
    if (external?.aborted) listener();
  });
  const run = async () => {
    if (controller.signal.aborted)
      throw new Error("Inventory recovery unavailable");
    const response = await fetch(path, {
      ...init,
      cache: "no-store",
      credentials: "same-origin",
      signal: controller.signal,
    });
    if (controller.signal.aborted || !response.ok)
      throw new Error("Inventory recovery unavailable");
    if (Number(response.headers.get("content-length")) > MAX_BYTES) {
      void response.body?.cancel().catch(() => undefined);
      throw new Error("Inventory recovery response too large");
    }
    reader = response.body?.getReader();
    if (!reader) {
      const body: unknown = await response.json();
      const serialized = JSON.stringify(body);
      if (
        typeof serialized !== "string" ||
        new Blob([serialized]).size > MAX_BYTES
      )
        throw new Error("Inventory recovery response too large");
      return body;
    }
    const decoder = new TextDecoder();
    let bytes = 0,
      text = "";
    try {
      while (true) {
        const part = await reader.read();
        if (controller.signal.aborted)
          throw new Error("Inventory recovery unavailable");
        if (part.done) break;
        bytes += part.value.byteLength;
        if (bytes > MAX_BYTES) {
          void reader.cancel().catch(() => undefined);
          throw new Error("Inventory recovery response too large");
        }
        text += decoder.decode(part.value, { stream: true });
      }
      return JSON.parse(text + decoder.decode());
    } finally {
      reader.releaseLock();
    }
  };
  try {
    return await Promise.race([run(), cancelled]);
  } finally {
    clearTimeout(timeout);
    if (listener) external?.removeEventListener("abort", listener);
  }
}
export async function readInventoryRecoveryContext(
  signal?: AbortSignal,
): Promise<InventoryRecoveryContext> {
  return inventoryRecoveryContext.parse(
    await requestJson("/api/inventory/recovery", {}, signal),
  );
}
export async function readInventoryRecoveryReview(
  entry: InventoryRecoveryEntry,
  context: InventoryRecoveryContext,
  signal?: AbortSignal,
): Promise<InventoryRecoveryReview> {
  if (!context.owner) throw new Error("Inventory recovery unavailable");
  const reply = inventoryRecoveryReview.parse(
    await requestJson(
      "/api/inventory/recovery/review",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          [INVENTORY_RECOVERY_OWNER_HEADER]: context.owner.scope,
        },
        body: JSON.stringify({
          contract: INVENTORY_RECOVERY_REVIEW_CONTRACT,
          entry,
        }),
      },
      signal,
    ),
  );
  if (
    reply.ownerScope !== context.owner.scope ||
    reply.entry.key !== entry.key ||
    reply.entry.kind !== entry.kind ||
    reply.entry.body !== entry.body
  )
    throw new Error("Inventory recovery review changed");
  return reply;
}
