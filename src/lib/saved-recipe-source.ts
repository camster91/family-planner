import { createHash } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { storageBackend } from "@/lib/storage-backend";
import { getD1Database } from "@/lib/cloudflare/database";
import {
  canonicalRecipeSource,
  legacyRecipeSource,
} from "@/lib/recipe-curation-contract";

const select = {
  id: true,
  title: true,
  prep_time: true,
  cook_time: true,
  servings: true,
  source_url: true,
  description: true,
} as const;
type SavedSource = {
  id: string;
  title: string;
  prep_time: number | null;
  cook_time: number | null;
  servings: number | null;
  source_url: string | null;
  description: string | null;
};
/** Bounded, household-scoped reuse hint. The meal write revalidates the recipe. */
export async function findSavedRecipeSource(
  familyId: string,
  raw: string,
): Promise<Omit<SavedSource, "description"> | null> {
  const source = canonicalRecipeSource(raw);
  if (!source) return null;
  const key = createHash("sha256").update(source).digest("hex");
  let known: SavedSource | null;
  let legacy: SavedSource[] = [];
  if (storageBackend() === "d1") {
    const db = (await getD1Database()).withSession("first-primary");
    const columns =
      "id,title,prep_time,cook_time,servings,source_url,description";
    known = await db
      .prepare(
        `SELECT ${columns} FROM Recipe WHERE family_id=?1 AND source_key=?2 ORDER BY created_at,id LIMIT 1`,
      )
      .bind(familyId, key)
      .first<SavedSource>();
    if (!known)
      legacy = (
        await db
          .prepare(
            `SELECT ${columns} FROM Recipe WHERE family_id=?1 AND source_key IS NULL AND description LIKE 'Source: https://%' ORDER BY id LIMIT 2001`,
          )
          .bind(familyId)
          .all<SavedSource>()
      ).results;
  } else {
    known = await prisma!.recipe.findFirst({
      where: { family_id: familyId, source_key: key },
      orderBy: [{ created_at: "asc" }, { id: "asc" }],
      select,
    });
    if (!known)
      legacy = await prisma!.recipe.findMany({
        where: {
          family_id: familyId,
          source_key: null,
          description: { startsWith: "Source: https://" },
        },
        orderBy: { id: "asc" },
        take: 2001,
        select,
      });
  }
  const found =
    known ??
    legacy.find((row) => legacyRecipeSource(row.description) === source);
  if (!found) {
    if (legacy.length > 2000)
      throw new Error("Saved recipe source check incomplete");
    return null;
  }
  const { description: _description, ...summary } = found;
  return { ...summary, source_url: source };
}
