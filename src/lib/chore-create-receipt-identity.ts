/** Stored create pointer admission. Missing legacy birth identity stays unknown. */
export function isChoreBirthGeneration(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value);
}
export function readChoreCreateReceiptIdentity(value: unknown): { choreId: string; choreGeneration: string } | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  return typeof row.choreId === "string" && row.choreId.length > 0 && row.choreId.length <= 128 && isChoreBirthGeneration(row.choreGeneration)
    ? { choreId: row.choreId, choreGeneration: row.choreGeneration } : null;
}
