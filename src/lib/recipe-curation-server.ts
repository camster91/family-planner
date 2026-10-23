import type { PrismaClient } from "@prisma/client";
import type { z } from "zod";
import { recipeWriteAuthority } from "@/lib/recipe-write";
import type {
  collectionMutation,
  recipeCurationMutation,
} from "@/lib/recipe-curation-contract";
type Db = Pick<PrismaClient, "$transaction">;
type Actor = Parameters<typeof recipeWriteAuthority>[1];
const fail = (status: number, code: string) => ({
  status,
  body: { error: { code } },
});
export async function mutateCollection(
  db: Db,
  actor: Actor,
  input: z.infer<typeof collectionMutation>,
) {
  return db.$transaction(async (tx) => {
    const refusal = await recipeWriteAuthority(tx, actor);
    if (refusal) return refusal;
    if (input.action === "create") {
      const name_key = input.name.toLocaleLowerCase("en-US");
      const existing = await tx.recipeCollection.findFirst({
        where: { family_id: actor.familyId, name_key },
        select: { id: true, name: true, revision: true },
      });
      if (existing) return { status: 200, body: { collection: existing } };
      if (
        (await tx.recipeCollection.count({
          where: { family_id: actor.familyId },
        })) >= 100
      )
        return fail(409, "COLLECTION_LIMIT");
      const collection = await tx.recipeCollection.create({
        data: { family_id: actor.familyId, name: input.name, name_key },
        select: { id: true, name: true, revision: true },
      });
      return { status: 201, body: { collection } };
    }
    const current = await tx.recipeCollection.findFirst({
      where: { id: input.id, family_id: actor.familyId },
      select: { id: true, name: true, revision: true },
    });
    if (!current) return fail(404, "NOT_FOUND");
    if (current.revision !== input.revision)
      return fail(409, "REVISION_CONFLICT");
    if (input.action === "delete") {
      await tx.recipeCollection.delete({ where: { id: current.id } });
      return { status: 200, body: { deleted: true } };
    }
    const name_key = input.name.toLocaleLowerCase("en-US");
    const duplicate = await tx.recipeCollection.findFirst({
      where: { family_id: actor.familyId, name_key, id: { not: current.id } },
      select: { id: true },
    });
    if (duplicate) return fail(409, "COLLECTION_NAME_EXISTS");
    const collection = await tx.recipeCollection.update({
      where: { id: current.id },
      data: { name: input.name, name_key, revision: { increment: 1 } },
      select: { id: true, name: true, revision: true },
    });
    return { status: 200, body: { collection } };
  });
}
export async function curateRecipe(
  db: Db,
  actor: Actor,
  id: string,
  input: z.infer<typeof recipeCurationMutation>,
) {
  return db.$transaction(async (tx) => {
    const refusal = await recipeWriteAuthority(tx, actor);
    if (refusal) return refusal;
    await tx.$queryRaw`SELECT "id" FROM "Recipe" WHERE "id" = ${id} AND "family_id" = ${actor.familyId} FOR UPDATE`;
    const recipe = await tx.recipe.findFirst({
      where: { id, family_id: actor.familyId },
      select: { id: true, favorite: true, revision: true },
    });
    if (!recipe) return fail(404, "NOT_FOUND");
    const collections = await tx.recipeCollection.findMany({
      where: { id: { in: input.collectionIds }, family_id: actor.familyId },
      select: { id: true },
    });
    if (collections.length !== input.collectionIds.length)
      return fail(404, "COLLECTION_UNAVAILABLE");
    const entries = await tx.recipeCollectionEntry.findMany({
      where: { recipe_id: id, family_id: actor.familyId },
      select: { collection_id: true },
    });
    const same =
      recipe.favorite === input.favorite &&
      entries.length === input.collectionIds.length &&
      entries.every((entry) =>
        input.collectionIds.includes(entry.collection_id),
      );
    if (same)
      return {
        status: 200,
        body: {
          id,
          favorite: recipe.favorite,
          revision: recipe.revision,
          collectionIds: input.collectionIds,
        },
      };
    if (recipe.revision !== input.revision)
      return fail(409, "REVISION_CONFLICT");
    const updated = await tx.recipe.update({
      where: { id },
      data: { favorite: input.favorite, revision: { increment: 1 } },
      select: { revision: true },
    });
    await tx.recipeCollectionEntry.deleteMany({
      where: { recipe_id: id, family_id: actor.familyId },
    });
    if (input.collectionIds.length)
      await tx.recipeCollectionEntry.createMany({
        data: input.collectionIds.map((collection_id) => ({
          recipe_id: id,
          collection_id,
          family_id: actor.familyId,
        })),
      });
    return {
      status: 200,
      body: {
        id,
        favorite: input.favorite,
        revision: updated.revision,
        collectionIds: input.collectionIds,
      },
    };
  });
}
