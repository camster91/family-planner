import { importBudgetApp } from './persist-budget-app'
import { importChoreChamps } from './persist-chore-champs'
import { importMealPlanner } from './persist-meal-planner'

export const FAMILY_IMPORT_SOURCES = ['chore-champs', 'meal-planner', 'budget-app'] as const
export type FamilyImportSource = typeof FAMILY_IMPORT_SOURCES[number]

export function isFamilyImportSource(value: string): value is FamilyImportSource {
  return FAMILY_IMPORT_SOURCES.includes(value as FamilyImportSource)
}

export async function runFamilyImport(options: {
  source: FamilyImportSource
  data: unknown
  familyId: string
  startedBy: string
  identityMap?: Readonly<Record<string, string>>
  dryRun?: boolean
}) {
  const common = {
    familyId: options.familyId,
    startedBy: options.startedBy,
    dryRun: options.dryRun,
  }

  switch (options.source) {
    case 'chore-champs':
      return importChoreChamps(options.data, {
        ...common,
        kidToUserId: options.identityMap ?? {},
      })
    case 'meal-planner':
      return importMealPlanner(options.data, {
        ...common,
        sourceUserToTargetUser: options.identityMap ?? {},
      })
    case 'budget-app':
      return importBudgetApp(options.data, common)
  }
}
