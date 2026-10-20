import { NextRequest } from "next/server";
import {
  FOOD_PHOTO_PROTOCOL,
  FOOD_PHOTO_MODES,
  type FoodPhotoMode,
} from "@/lib/food-photo-contract";
import { authenticateWithFamily } from "@/lib/api-auth";
import { featureGate } from "@/lib/feature-gate-server";
import { refusePairedDevice } from "@/lib/device-route";
import { sniffImageType } from "@/lib/image-sniff";
import { checkRateLimit } from "@/lib/rate-limit-db";
import { log } from "@/lib/logger";
import { inventoryError, inventoryJson } from "@/lib/inventory-http";
import {
  INVENTORY_SCAN_FAMILY_PER_HOUR,
  INVENTORY_SCAN_FORBIDDEN_MESSAGE,
  INVENTORY_SCAN_FORM_OVERHEAD,
  INVENTORY_SCAN_MAX_BYTES,
  INVENTORY_SCAN_MIME_TYPES,
  INVENTORY_SCAN_USER_PER_HOUR,
  InventoryScanError,
  canScanInventory,
  isFoodDocumentCaptureConfigured,
  resolveInventoryScanConfig,
  scanFridgePhoto,
  type InventoryScanMime,
} from "@/lib/inventory-scan";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const MAX_MB = INVENTORY_SCAN_MAX_BYTES / 1024 / 1024;

function retryAfter(ms: number): Record<string, string> {
  return { "Retry-After": String(Math.max(1, Math.ceil(ms / 1000))) };
}

class FoodUploadTooLarge extends Error {}
/** Bound bytes before multipart parsing, including browsers without Content-Length. */
async function readFoodForm(request: NextRequest): Promise<FormData> {
  if (!request.body) return request.formData();
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0,
    expired = false;
  const deadline = setTimeout(() => {
    expired = true;
    void reader.cancel().catch(() => undefined);
  }, 20000);
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      if (
        part.value.byteLength >
        INVENTORY_SCAN_MAX_BYTES + INVENTORY_SCAN_FORM_OVERHEAD - size
      ) {
        await reader.cancel().catch(() => undefined);
        throw new FoodUploadTooLarge();
      }
      chunks.push(part.value);
      size += part.value.byteLength;
    }
    if (expired) throw new Error("Upload timed out");
  } finally {
    clearTimeout(deadline);
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new Request(request.url, {
    method: "POST",
    headers: request.headers,
    body: bytes,
  }).formData();
}

/**
 * POST /api/inventory/scan (#265). Multipart body with one `image` field
 * (JPEG, PNG or WebP by magic bytes, at most 8 MB). Returns suggestions only:
 * `{ items: [{ name, amount, unit, location, confidence }], dropped }`.
 * Nothing is written; the page saves reviewed items with versioned inventory intake.
 * Optional document modes require their own off-by-default approval gate and
 * known protocol/original person context. Old responses cannot confirm a new mode.
 *
 * Order: paired device refused (403) → person auth (401) → kill switch (404
 * when no provider key is configured) → `featureGate('inventory')` (403) →
 * parent only (403) → bounded size/type checks (411/413/415/400) → rate limits (429:
 * per user and per household per hour, household per UTC day) → provider.
 * Validation runs before the limits so a wrong file does not use up quota;
 * only a request that reaches the provider is counted against the daily cap.
 *
 * Privacy: the image stays in memory for this request only. Logs carry the
 * byte size, type, item count, duration and upstream status, never the image,
 * any model text or a user/household id.
 */
export async function POST(request: NextRequest) {
  const started = Date.now();
  try {
    const deviceRefusal = await refusePairedDevice(request);
    if (deviceRefusal) {
      deviceRefusal.headers.set("Cache-Control", "private, no-store");
      return deviceRefusal;
    }

    const [auth, error] = await authenticateWithFamily(request);
    if (error) {
      error.headers.set("Cache-Control", "private, no-store");
      return error;
    }

    const config = resolveInventoryScanConfig();
    if (!config)
      return inventoryError(
        404,
        "INVENTORY_SCAN_DISABLED",
        "Fridge scan is not available.",
      );

    const gate = await featureGate(auth.user.family_id, "inventory");
    if (gate) {
      gate.headers.set("Cache-Control", "private, no-store");
      return gate;
    }

    if (!canScanInventory(auth.user.role)) {
      return inventoryError(
        403,
        "INVENTORY_SCAN_FORBIDDEN",
        INVENTORY_SCAN_FORBIDDEN_MESSAGE,
      );
    }

    // Bound the body before reading it: formData() buffers the whole request.
    const lengthHeader = request.headers.get("content-length");
    const declared = lengthHeader === null ? NaN : Number(lengthHeader);
    if (lengthHeader !== null && (!Number.isFinite(declared) || declared < 0)) {
      return inventoryError(
        411,
        "LENGTH_REQUIRED",
        "Send the photo as a normal file upload.",
      );
    }
    if (declared > INVENTORY_SCAN_MAX_BYTES + INVENTORY_SCAN_FORM_OVERHEAD) {
      return inventoryError(
        413,
        "IMAGE_TOO_LARGE",
        `That photo is too large. The limit is ${MAX_MB} MB.`,
      );
    }
    const contentType = request.headers.get("content-type") ?? "";
    if (!contentType.toLowerCase().startsWith("multipart/form-data")) {
      return inventoryError(
        400,
        "INVALID_FORM",
        'Send the photo as multipart/form-data with an "image" field.',
      );
    }

    let form: FormData;
    try {
      form = await readFoodForm(request);
    } catch (error) {
      if (error instanceof FoodUploadTooLarge)
        return inventoryError(
          413,
          "IMAGE_TOO_LARGE",
          `That photo is too large. The limit is ${MAX_MB} MB.`,
        );
      return inventoryError(
        400,
        "INVALID_FORM",
        'Send the photo as multipart/form-data with an "image" field.',
      );
    }
    const rawMode = form.get("capture_mode");
    const mode = rawMode === null ? "fridge" : rawMode;
    const documentMode = mode !== "fridge";
    const allowed = documentMode
      ? [
          "image",
          "capture_mode",
          "protocol",
          "expected_user_id",
          "expected_family_id",
        ]
      : ["image"];
    if (
      [...form.keys()].some(
        (key) => !allowed.includes(key) || form.getAll(key).length !== 1,
      ) ||
      (documentMode &&
        (!(FOOD_PHOTO_MODES as readonly unknown[]).includes(mode) ||
          form.get("protocol") !== FOOD_PHOTO_PROTOCOL))
    ) {
      return inventoryError(
        400,
        "INVALID_FORM",
        "Choose a supported food-photo capture mode.",
      );
    }
    if (documentMode && !isFoodDocumentCaptureConfigured()) {
      return inventoryError(
        404,
        "INVENTORY_SCAN_DISABLED",
        "Document capture is not available. Add food by hand.",
      );
    }
    if (
      documentMode &&
      (form.get("expected_user_id") !== auth.user.id ||
        form.get("expected_family_id") !== auth.user.family_id)
    ) {
      return inventoryError(
        403,
        "INVENTORY_SCAN_FORBIDDEN",
        "Your account or household changed. Reopen food capture.",
      );
    }
    const file = form.get("image");
    if (
      !file ||
      typeof file === "string" ||
      typeof (file as Blob).arrayBuffer !== "function"
    ) {
      return inventoryError(400, "INVALID_FORM", "Choose a photo to scan.");
    }
    const blob = file as Blob;
    if (blob.size === 0)
      return inventoryError(400, "INVALID_FORM", "That photo is empty.");
    if (blob.size > INVENTORY_SCAN_MAX_BYTES) {
      return inventoryError(
        413,
        "IMAGE_TOO_LARGE",
        `That photo is too large. The limit is ${MAX_MB} MB.`,
      );
    }

    const bytes = new Uint8Array(await blob.arrayBuffer());
    // Type from magic bytes, never the client-declared MIME.
    const sniffed = sniffImageType(bytes);
    if (
      !sniffed ||
      !(INVENTORY_SCAN_MIME_TYPES as readonly string[]).includes(sniffed.mime)
    ) {
      return inventoryError(
        415,
        "UNSUPPORTED_IMAGE_TYPE",
        "Use a JPEG, PNG or WebP photo.",
      );
    }

    const userId = auth.user.id;
    const familyId = auth.user.family_id;
    const perUser = await checkRateLimit(
      `inventory-scan:user:${userId}`,
      INVENTORY_SCAN_USER_PER_HOUR,
      HOUR_MS,
    );
    if (!perUser.allowed) {
      return inventoryError(
        429,
        "RATE_LIMITED",
        "Too many scans this hour. Try again later.",
        retryAfter(perUser.retryAfterMs),
      );
    }
    const perFamily = await checkRateLimit(
      `inventory-scan:family:${familyId}`,
      INVENTORY_SCAN_FAMILY_PER_HOUR,
      HOUR_MS,
    );
    if (!perFamily.allowed) {
      return inventoryError(
        429,
        "RATE_LIMITED",
        "Your household has scanned a lot this hour. Try again later.",
        retryAfter(perFamily.retryAfterMs),
      );
    }
    // Spend guard: per household per UTC calendar day, from INVENTORY_SCAN_DAILY_LIMIT.
    const day = new Date().toISOString().slice(0, 10);
    const endOfDay = Date.parse(`${day}T00:00:00Z`) + DAY_MS;
    const daily =
      config.dailyLimit === 0
        ? { allowed: false, retryAfterMs: endOfDay - Date.now() }
        : await checkRateLimit(
            `inventory-scan:day:${familyId}:${day}`,
            config.dailyLimit,
            DAY_MS,
          );
    if (!daily.allowed) {
      return inventoryError(
        429,
        "SCAN_DAILY_LIMIT",
        "Your household has used today's fridge scans. Add items by hand, or scan again tomorrow.",
        retryAfter(Math.max(endOfDay - Date.now(), 1000)),
      );
    }

    try {
      const result = await scanFridgePhoto(
        { bytes, mime: sniffed.mime as InventoryScanMime },
        config,
        fetch,
        mode as FoodPhotoMode | "fridge",
      );
      // A slow provider read cannot outlive a revoked role/session/household.
      const [fresh, refusal] = await authenticateWithFamily(request);
      if (refusal) {
        refusal.headers.set("Cache-Control", "private, no-store");
        return refusal;
      }
      if (
        fresh.user.id !== auth.user.id ||
        fresh.user.family_id !== auth.user.family_id ||
        !canScanInventory(fresh.user.role) ||
        (documentMode && !isFoodDocumentCaptureConfigured())
      ) {
        return inventoryError(
          403,
          "INVENTORY_SCAN_FORBIDDEN",
          "Food capture access changed. Reopen capture.",
        );
      }
      const currentGate = await featureGate(fresh.user.family_id, "inventory");
      if (currentGate) {
        currentGate.headers.set("Cache-Control", "private, no-store");
        return currentGate;
      }
      log.info("inventory.scan", {
        bytes: bytes.length,
        type: sniffed.mime,
        items: result.items.length,
        dropped: result.dropped,
        ms: Date.now() - started,
      });
      return inventoryJson({
        ...(documentMode
          ? { protocol: FOOD_PHOTO_PROTOCOL, capture_mode: mode }
          : {}),
        items: result.items,
        dropped: result.dropped,
      });
    } catch (err) {
      if (err instanceof InventoryScanError) {
        log.warn("inventory.scan.failed", {
          code: err.code,
          upstreamStatus: err.upstreamStatus,
          bytes: bytes.length,
          ms: Date.now() - started,
        });
        return inventoryError(502, err.code, err.message);
      }
      throw err;
    }
  } catch (err) {
    // Name only: an error message could carry request details.
    log.warn("inventory.scan.error", {
      name: err instanceof Error ? err.name : "unknown",
    });
    return inventoryError(500, "INTERNAL_ERROR", "Internal server error");
  }
}
