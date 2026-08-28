import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { planMealPlannerImport, type MealPlannerImportPlan } from './meal-planner'

const SOURCE_APP = 'meal-planner'
type Summary = { created: Record<string, number>; reused: Record<string, number>; skipped: Array<{ sourceModel: string; sourceId: string; reason: string }> }
const increment = (bucket: Record<string, number>, model: string) => { bucket[model] = (bucket[model] ?? 0) + 1 }

export async function importMealPlanner(input: unknown, options: {
  familyId: string
  startedBy: string
  sourceUserToTargetUser: Readonly<Record<string, string>>
  dryRun?: boolean
}): Promise<{ plan: MealPlannerImportPlan; summary: Summary; jobId: string | null }> {
  const plan = planMealPlannerImport(input, options.sourceUserToTargetUser)
  const summary: Summary = { created: {}, reused: {}, skipped: [...plan.skippedRecords] }
  if (options.dryRun !== false) return { plan, summary, jobId: null }
  if (!prisma) throw new Error('Database is not configured')

  const job = await prisma.importJob.create({ data: {
    family_id: options.familyId, source_app: SOURCE_APP, source_version: plan.sourceVersion,
    status: 'running', dry_run: false, started_by: options.startedBy,
  } })
  try {
    await prisma.$transaction(async (tx) => {
      const prior = await tx.importedRecord.findMany({ where: { family_id: options.familyId, source_app: SOURCE_APP } })
      const mappings = new Map(prior.map((record) => [`${record.source_model}:${record.source_id}`, record.target_id]))
      const existing = (model: string, id: string) => mappings.get(`${model}:${id}`)
      const track = async (sourceModel: string, sourceId: string, targetModel: string, targetId: string) => {
        await tx.importedRecord.create({ data: { family_id: options.familyId, import_job_id: job.id, source_app: SOURCE_APP,
          source_model: sourceModel, source_id: sourceId, target_model: targetModel, target_id: targetId } })
        mappings.set(`${sourceModel}:${sourceId}`, targetId)
      }
      const skip = (sourceModel: string, sourceId: string, reason: string) => summary.skipped.push({ sourceModel, sourceId, reason })

      for (const source of plan.ingredients) {
        if (existing('Ingredient', source.sourceId)) { increment(summary.reused, 'Ingredient'); continue }
        const target = await tx.ingredient.upsert({
          where: { family_id_name: { family_id: options.familyId, name: source.name } },
          update: {}, create: { family_id: options.familyId, name: source.name, unit: source.unit },
        })
        await track('Ingredient', source.sourceId, 'Ingredient', target.id); increment(summary.created, 'Ingredient')
      }
      for (const source of plan.recipes) {
        if (existing('Recipe', source.sourceId)) { increment(summary.reused, 'Recipe'); continue }
        const target = await tx.recipe.create({ data: { family_id: options.familyId, title: source.title,
          description: source.description, instructions: source.instructions, prep_time: source.prepTime,
          cook_time: source.cookTime, servings: source.servings, image_url: source.imageUrl,
          created_by: source.createdBy, created_at: source.createdAt } })
        await track('Recipe', source.sourceId, 'Recipe', target.id); increment(summary.created, 'Recipe')
      }
      for (const source of plan.recipeIngredients) {
        if (existing('RecipeIngredient', source.sourceId)) { increment(summary.reused, 'RecipeIngredient'); continue }
        const recipeId = existing('Recipe', source.sourceRecipeId), ingredientId = existing('Ingredient', source.sourceIngredientId)
        if (!recipeId || !ingredientId) { skip('RecipeIngredient', source.sourceId, 'Recipe or ingredient was not imported'); continue }
        const target = await tx.recipeIngredient.upsert({ where: { recipe_id_ingredient_id: { recipe_id: recipeId, ingredient_id: ingredientId } },
          update: {}, create: { recipe_id: recipeId, ingredient_id: ingredientId, amount: source.amount, unit: source.unit, note: source.note } })
        await track('RecipeIngredient', source.sourceId, 'RecipeIngredient', target.id); increment(summary.created, 'RecipeIngredient')
      }
      for (const source of plan.mealPlans) {
        if (existing('MealPlan', source.sourceId)) { increment(summary.reused, 'MealPlan'); continue }
        const target = await tx.mealPlan.create({ data: { family_id: options.familyId, name: source.name,
          start_date: source.startDate, end_date: source.endDate, created_by: source.createdBy, created_at: source.createdAt } })
        await track('MealPlan', source.sourceId, 'MealPlan', target.id); increment(summary.created, 'MealPlan')
      }
      for (const source of plan.mealPlanEntries) {
        if (existing('MealPlanEntry', source.sourceId)) { increment(summary.reused, 'MealPlanEntry'); continue }
        const mealPlanId = existing('MealPlan', source.sourceMealPlanId), recipeId = existing('Recipe', source.sourceRecipeId)
        if (!mealPlanId || !recipeId) { skip('MealPlanEntry', source.sourceId, 'Meal plan or recipe was not imported'); continue }
        const target = await tx.mealPlanEntry.upsert({ where: { meal_plan_id_date_meal_type: {
          meal_plan_id: mealPlanId, date: source.date, meal_type: source.mealType } }, update: {},
          create: { meal_plan_id: mealPlanId, recipe_id: recipeId, date: source.date, meal_type: source.mealType, servings: source.servings } })
        await track('MealPlanEntry', source.sourceId, 'MealPlanEntry', target.id); increment(summary.created, 'MealPlanEntry')
      }
      for (const source of plan.shoppingLists) {
        if (existing('ShoppingList', source.sourceId)) { increment(summary.reused, 'ShoppingList'); continue }
        const target = await tx.shoppingList.create({ data: { family_id: options.familyId, name: source.name,
          created_by: source.createdBy, created_at: source.createdAt } })
        await track('ShoppingList', source.sourceId, 'ShoppingList', target.id); increment(summary.created, 'ShoppingList')
      }
      for (const source of plan.shoppingItems) {
        if (existing('ShoppingItem', source.sourceId)) { increment(summary.reused, 'ShoppingItem'); continue }
        const shoppingListId = existing('ShoppingList', source.sourceShoppingListId)
        if (!shoppingListId) { skip('ShoppingItem', source.sourceId, 'Shopping list was not imported'); continue }
        const target = await tx.shoppingItem.create({ data: { shopping_list_id: shoppingListId,
          ingredient_name: source.ingredientName, amount: source.amount, unit: source.unit,
          category: source.category, checked: source.checked, recipe_id: source.sourceRecipeId ? existing('Recipe', source.sourceRecipeId) ?? null : null } })
        await track('ShoppingItem', source.sourceId, 'ShoppingItem', target.id); increment(summary.created, 'ShoppingItem')
      }
      await tx.importJob.update({ where: { id: job.id }, data: { status: 'completed', completed_at: new Date(), summary: summary as Prisma.InputJsonValue } })
    }, { timeout: 60_000 })
  } catch (error) {
    await prisma.importJob.update({ where: { id: job.id }, data: { status: 'failed', completed_at: new Date(),
      error: error instanceof Error ? error.message : 'Unknown import failure' } })
    throw error
  }
  return { plan, summary, jobId: job.id }
}
