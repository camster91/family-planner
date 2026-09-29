import { NextRequest } from "next/server";
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

/**
 * POST /api/inventory/scan (#265). Multipart body with one `image` field
 * (JPEG, PNG or WebP by magic bytes, at most 8 MB). Returns suggestions only:
 * `{ items: [{ name, amount, unit, location, confidence }], dropped }`.
 * Nothing is written; the page adds the reviewed items with POST /api/inventory.
 *
 * Order: paired device refused (403) → person auth (401) → kill switch (404
 * when no provider key is configured) → `featureGate('inventory')` (403) →
 * parent only (403) → size/type checks (411/413/415/400) → rate limits (429:
 * per user and per household per hour, household per UTC day) → provider.
 * Validation runs before the limits so a wrong file does not use up quota;
 * only a request that reaches the provider is counted against the daily cap.
 *
 * Privacy: the image stays in memory for this request only. Logs carry the
 * user id, byte size, type, item count, duration and upstream status, never
 * the image or any model text.
 */
export async function POST(request: NextRequest) {
  const started = Date.now();
  try {
    const deviceRefusal = await refusePairedDevice(request);
    if (deviceRefusal) return deviceRefusal;

    const [auth, error] = await authenticateWithFamily(request);
    if (error) return error;

    const config = resolveInventoryScanConfig();
    if (!config)
      return inventoryError(
        404,
        "INVENTORY_SCAN_DISABLED",
        "Fridge scan is not available.",
      );

    const gate = await featureGate(auth.user.family_id, "inventory");
    if (gate) return gate;

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
    if (!Number.isFinite(declared) || declared < 0) {
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
      form = await request.formData();
    } catch {
      return inventoryError(
        400,
        "INVALID_FORM",
        'Send the photo as multipart/form-data with an "image" field.',
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
      );
      log.info("inventory.scan", {
        userId,
        bytes: bytes.length,
        type: sniffed.mime,
        items: result.items.length,
        dropped: result.dropped,
        ms: Date.now() - started,
      });
      return inventoryJson({ items: result.items, dropped: result.dropped });
    } catch (err) {
      if (err instanceof InventoryScanError) {
        log.warn("inventory.scan.failed", {
          userId,
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
