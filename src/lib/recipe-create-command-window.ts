/** Browser-safe bound-command age, independent of parsing historical receipts. */
export const RECIPE_CREATE_COMMAND_MAX_AGE_MS = 24 * 60 * 60 * 1000;
type Command = { creation_owner?: unknown; creation_issued_at?: unknown };
export function recipeCreateCommandTimeRefusal(command: Command, now = Date.now()) {
  if (command.creation_owner === undefined && command.creation_issued_at === undefined) return null;
  const issued = command.creation_issued_at;
  if (command.creation_owner === undefined || typeof issued !== "number" || !Number.isSafeInteger(issued) || issued < 0 ||
      !Number.isSafeInteger(now) || now < issued)
    return { status: 409, body: { error: { code: "RECIPE_COMMAND_TIME_UNCONFIRMED" } } };
  return now - issued >= RECIPE_CREATE_COMMAND_MAX_AGE_MS
    ? { status: 410, body: { error: { code: "RECIPE_COMMAND_EXPIRED" } } } : null;
}
