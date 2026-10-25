/** Canonical creator handover/nullable references; caller holds user then all household locks. */
export const HOUSEHOLD_HANDOVER_COLUMNS: ReadonlyArray<readonly [string, string]> = [
  ['chore', 'created_by'],
  ['event', 'created_by'],
  ['list', 'created_by'],
  ['listItem', 'added_by'],
  ['reward', 'created_by'],
  ['transaction', 'user_id'],
  ['budgetCategory', 'created_by'],
  ['project', 'created_by'],
  ['familyMeal', 'created_by'],
  ['pinnedNote', 'created_by'],
  ['familyLocation', 'user_id'],
  ['pickup', 'created_by'],
  ['allowance', 'from_user_id'],
  ['handoff', 'created_by'],
  ['sickDay', 'created_by'],
  ['medication', 'created_by'],
  ['calendarSubscription', 'created_by'],
  ['importJob', 'started_by'],
  ['recipe', 'created_by'],
  ['mealPlan', 'created_by'],
  ['shoppingList', 'created_by'],
  ['habit', 'created_by'],
  ['familyGoal', 'created_by'],
  // RoutineStack.created_by records the original actor, not transferable ownership.
  // Ordinary membership changes preserve it; User erasure uses its SetNull FK.
]

/** Nullable references to a leaving member: cleared. Shared with member removal. */
export const HOUSEHOLD_CLEARED_REFERENCES: ReadonlyArray<readonly [string, string]> = [
  ['listItem', 'checked_by'],
  ['reward', 'claimed_by'],
  ['reward', 'approved_by'],
  ['projectTask', 'assigned_to'],
  ['familyMeal', 'cook_id'],
  ['mealBatch', 'cook_id'],
  ['anniversary', 'person_id'],
  ['anniversary', 'created_by'],
  ['emergencyContact', 'person_id'],
  ['pickup', 'assigned_to'],
  ['wishlistItem', 'status_changed_by'],
  ['choreAssignment', 'completed_by'],
  ['choreAssignment', 'approved_by'],
  ['rewardRedemption', 'approved_by'],
  ['inventoryItem', 'added_by'],
  ['inventoryAdjustment', 'actor_id'],
  ['inventoryAdjustment', 'undone_by'],
  ['grocerySectionPreference', 'updated_by'],
  ['deviceAuditEvent', 'actor_user_id'],
  ['auditLog', 'actor_user_id'],
]


type Tx = Record<string, any>;
/** Two child tables derive ownership through their canonical parent. */
export function householdContentScope(model: string, familyId: string): Record<string, unknown> {
  if (model === "listItem") return { list: { family_id: familyId } };
  if (model === "projectTask") return { project: { family_id: familyId } };
  return { family_id: familyId };
}
/** Household ownership discovery reads identifiers only, never private content. */
export async function accountContentHouseholds(tx: Tx, userId: string): Promise<string[]> {
  const columns = new Map<string, Set<string>>();
  for (const [model, column] of [...HOUSEHOLD_HANDOVER_COLUMNS, ...HOUSEHOLD_CLEARED_REFERENCES, ["routineStack", "created_by"], ["upload", "uploaded_by"]]) {
    const fields = columns.get(model) ?? new Set<string>();
    fields.add(column); columns.set(model, fields);
  }
  const families = new Set<string>();
  for (const [model, fields] of columns) {
    const relation = model === "listItem" ? "list" : model === "projectTask" ? "project" : null;
    const rows = await tx[model].findMany({
      where: { OR: [...fields].map(column => ({ [column]: userId })) },
      select: relation ? { [relation]: { select: { family_id: true } } } : { family_id: true },
      distinct: [relation ? `${relation}_id` : "family_id"],
    });
    for (const row of rows) {
      const familyId = relation ? row[relation]?.family_id : row.family_id;
      if (typeof familyId !== "string" || !familyId) throw new Error("Household content ownership unavailable");
      families.add(familyId);
    }
  }
  return [...families].sort();
}
/** Personal subjects follow their existing User Cascade policy, not creator handover. */
function retainedOwnerWhere(model: string, column: string, familyId: string, userId: string) {
  const where: Record<string, unknown> = { ...householdContentScope(model, familyId), [column]: userId };
  if (model === "chore") where.OR = [{ assigned_to: null }, { assigned_to: { not: userId } }];
  if (model === "allowance") where.to_user_id = { not: userId };
  if (model === "sickDay" || model === "medication") where.person_id = { not: userId };
  return where;
}
export async function needsHouseholdContentSuccessor(tx: Tx, familyId: string, userId: string): Promise<boolean> {
  for (const [model, column] of HOUSEHOLD_HANDOVER_COLUMNS)
    if (await tx[model].findFirst({ where: retainedOwnerWhere(model, column, familyId, userId), select: { id: true } })) return true;
  return false;
}
export async function handOverRetainedContentInTx(tx: Tx, familyId: string, userId: string, successorId: string) {
  // This assertion is repeated inside the locked transaction; a caller cannot
  // use the function to transfer former-household records to a foreign actor.
  if (successorId === userId || !(await tx.user.findFirst({ where: { id: successorId, family_id: familyId }, select: { id: true } })))
    throw new Error("Household content successor unavailable");
  for (const [model, column] of HOUSEHOLD_HANDOVER_COLUMNS)
    await tx[model].updateMany({ where: retainedOwnerWhere(model, column, familyId, userId), data: { [column]: successorId } });
}
export async function clearHouseholdContentReferencesInTx(tx: Tx, familyId: string, userId: string) {
  for (const [model, column] of HOUSEHOLD_CLEARED_REFERENCES)
    await tx[model].updateMany({ where: { ...householdContentScope(model, familyId), [column]: userId }, data: { [column]: null } });
}
