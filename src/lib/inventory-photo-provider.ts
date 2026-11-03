/** Server-owned photo provider selection. Never fall back to another provider
 * after sending a private photo; household settings take precedence. */
import { resolveCaptureConfig, type CaptureConfig } from "./capture";
import { decryptSecret } from "./secret-box";
import { prisma } from "./prisma";
import { storageBackend } from "./storage-backend";
import { withD1ReadClient } from "./cloudflare/read-client";
import { inventoryScanDailyLimit, resolveInventoryScanConfig, type InventoryScanConfig } from "./inventory-scan";

export type InventoryPhotoProvider =
  | { kind: "household"; config: CaptureConfig; dailyLimit: number }
  | { kind: "deployment"; config: InventoryScanConfig; dailyLimit: number };

export async function readInventoryPhotoProvider(familyId: string): Promise<InventoryPhotoProvider | null> {
  if (process.env.FAMILY_AI_PROVIDER_DISABLED === "1") return null;
  const query = { where: { id: familyId }, select: {
    capture_ai_key_enc: true, capture_ai_base_url: true, capture_ai_model: true,
  } } as const;
  const row = storageBackend() === "d1"
    ? await withD1ReadClient(db => db.family.findUnique(query))
    : await prisma!.family.findUnique(query);
  // A deployment capture key does not implicitly authorize inventory photos.
  if (row?.capture_ai_key_enc) {
    if (!decryptSecret(row.capture_ai_key_enc)) return null;
    const config = resolveCaptureConfig(row);
    if (config) {
      try {
        const url = new URL(config.baseUrl);
        if (url.protocol !== "https:" || url.username || url.password) return null;
      } catch { return null; }
      return { kind: "household", config, dailyLimit: inventoryScanDailyLimit() };
    }
    return null;
  }
  const config = resolveInventoryScanConfig();
  return config ? { kind: "deployment", config, dailyLimit: config.dailyLimit } : null;
}

export function foodDocumentsAllowed(provider: InventoryPhotoProvider | null) {
  return !!provider && process.env.INVENTORY_CAPTURE_DOCUMENTS_ENABLED === "1";
}
