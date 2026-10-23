import { z } from "zod";
import { publicRecipeUrl } from "@/lib/recipe-discovery";
const id = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/);
export function canonicalRecipeSource(raw: string): string | null {
  const valid = publicRecipeUrl(raw.trim());
  if (!valid) return null;
  const url = new URL(valid);
  for (const key of [...url.searchParams.keys()])
    if (/^utm_/i.test(key) || ["fbclid", "gclid"].includes(key.toLowerCase()))
      url.searchParams.delete(key);
  url.searchParams.sort();
  return url.toString();
}
export function legacyRecipeSource(description: string | null | undefined) {
  const match = /^Source: (https:\/\/[^\n]+)(?:\n|$)/.exec(description ?? "");
  return match ? canonicalRecipeSource(match[1]) : null;
}
export const recipeSourceField = z
  .string()
  .max(1500)
  .transform(canonicalRecipeSource)
  .refine(
    (value): value is string => value !== null,
    "Use a public HTTPS source link",
  );
export const collectionName = z
  .string()
  .max(120)
  .transform((value) => value.normalize("NFC").trim().replace(/\s+/g, " "))
  .pipe(z.string().min(1).max(60));
export const collectionMutation = z.discriminatedUnion("action", [
  z.object({ action: z.literal("create"), name: collectionName }).strict(),
  z
    .object({
      action: z.literal("rename"),
      id,
      revision: z.number().int().nonnegative(),
      name: collectionName,
    })
    .strict(),
  z
    .object({
      action: z.literal("delete"),
      id,
      revision: z.number().int().nonnegative(),
    })
    .strict(),
]);
export const recipeCurationMutation = z
  .object({
    revision: z.number().int().nonnegative(),
    favorite: z.boolean(),
    collectionIds: z
      .array(id)
      .max(8)
      .refine((ids) => new Set(ids).size === ids.length),
  })
  .strict();
export const recipeCollection = z
  .object({ id, name: z.string(), revision: z.number().int().nonnegative() })
  .strict();
export const collectionResponse = z
  .object({ collections: z.array(recipeCollection).max(100) })
  .strict();
export const recipeCurationResponse = z
  .object({
    id,
    revision: z.number().int().nonnegative(),
    favorite: z.boolean(),
    collectionIds: z.array(id).max(100),
  })
  .strict();
