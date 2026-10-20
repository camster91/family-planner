/** Server-only optional product read. No household data, photo, cookies or provider writes. */
import { z } from "zod";
import { safeFetch } from "@/lib/safe-fetch";
import { normalizeFoodBarcode } from "@/lib/food-barcode";
export const foodProductLicenseApproved = (env = process.env) =>
  env.FOOD_PRODUCT_DATA_REUSE_APPROVED === "approved";
export function foodProductLookupConfig(
  env = process.env,
): { contact: string } | null {
  const contact = env.FOOD_PRODUCT_LOOKUP_CONTACT?.trim();
  return env.FOOD_PRODUCT_LOOKUP_ENABLED === "1" &&
    foodProductLicenseApproved(env) &&
    contact &&
    /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/.test(
      contact,
    ) &&
    contact.length <= 200
    ? { contact }
    : null;
}
export function foodProductSourceUrl(gtin: string) {
  return `https://world.openfoodfacts.org/product/${gtin}`;
}
export function safeFoodImage(raw: unknown): string | null {
  if (typeof raw !== "string" || raw.length > 1000) return null;
  try {
    const url = new URL(raw);
    return url.protocol === "https:" &&
      url.hostname === "images.openfoodfacts.org" &&
      !url.port &&
      !url.username &&
      !url.password
      ? url.toString()
      : null;
  } catch {
    return null;
  }
}
const responseSchema = z.object({
  status: z.enum(["success", "success_with_errors"]),
  product: z.object({
    code: z.string().max(20),
    product_name: z.string().max(2000).optional(),
    brands: z.string().max(2000).optional(),
    quantity: z.string().max(2000).optional(),
    product_type: z.string().optional(),
    image_front_small_url: z.string().max(2000).optional(),
  }),
});
const clean = (text: string | undefined, max: number) =>
  text
    ?.normalize("NFC")
    .replace(
      /[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2060-\u206f<>]/g,
      " ",
    )
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max) || null;
export async function lookupPublicFoodProduct(
  gtin: string,
  config: { contact: string },
) {
  if (!foodProductLookupConfig()) throw new Error("Product source disabled");
  const identity = normalizeFoodBarcode(gtin, "gtin_14");
  if (!identity || identity.restricted) return null;
  const controller = new AbortController();
  const deadline = setTimeout(() => controller.abort(), 6000);
  try {
    const response = await safeFetch(
      `https://world.openfoodfacts.org/api/v3/product/${gtin}?product_type=food&fields=code,product_name,brands,quantity,product_type,image_front_small_url`,
      {
        method: "GET",
        redirect: "manual",
        signal: controller.signal,
        headers: {
          Accept: "application/json",
          "User-Agent": `herewoven/1.0 (${config.contact})`,
        },
      },
    );
    if (response.status === 404) return null;
    if (!response.ok) throw new Error("Product source unavailable");
    const declared = Number(response.headers.get("content-length"));
    if (declared > 128 * 1024) throw new Error("Product response too large");
    const reader = response.body?.getReader();
    if (!reader) throw new Error("Product body unavailable");
    const decoder = new TextDecoder();
    let size = 0,
      text = "";
    try {
      while (true) {
        const part = await reader.read();
        if (part.done) break;
        size += part.value.byteLength;
        if (size > 128 * 1024) {
          await reader.cancel();
          throw new Error("Product response too large");
        }
        text += decoder.decode(part.value, { stream: true });
      }
      text += decoder.decode();
    } finally {
      reader.releaseLock();
    }
    const data = responseSchema.parse(JSON.parse(text));
    const code = data.product.code;
    const returned = normalizeFoodBarcode(
      code,
      code.length === 8 ? "ean_8" : "auto",
    );
    if (
      returned?.gtin !== gtin ||
      (data.product.product_type && data.product.product_type !== "food")
    )
      return null;
    const name = clean(data.product.product_name, 200);
    if (!name) return null;
    return {
      barcode: gtin,
      name,
      brand: clean(data.product.brands, 120),
      package_size: clean(data.product.quantity, 80),
      origin: "open-food-facts" as const,
      revision: null,
      source_url: foodProductSourceUrl(gtin),
      image_url: safeFoodImage(data.product.image_front_small_url),
    };
  } finally {
    clearTimeout(deadline);
  }
}
