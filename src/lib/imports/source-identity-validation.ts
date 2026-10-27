/** Export identity checks only; no ownership proof, deduplication or persistence. */
import { z } from "zod";
/**
 * Called after shape validation and before planners build maps/sets. IDs remain
 * exact and model-scoped. Report at most one collision per collection to bound
 * error amplification; any collision refuses the whole export, including equal
 * duplicate payloads. Separate valid exports can still reuse accepted mappings.
 */
export function rejectDuplicateSourceIds(
  collections: Readonly<Record<string, readonly { id: string }[]>>,
  context: z.RefinementCtx,
): void {
  for (const [field, rows] of Object.entries(collections)) {
    const seen = new Set<string>();
    for (let index = 0; index < rows.length; index++) {
      if (seen.has(rows[index].id)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: [field, index, "id"],
          message: "Duplicate source ID in this collection",
          params: { sourceIdentity: "duplicate" },
        });
        break;
      }
      seen.add(rows[index].id);
    }
  }
}

/** Bounded content-minimal diagnostics; never include source ID/payload values. */
export const duplicateSourceRows = z
  .array(
    z
      .object({
        collection: z.string().regex(/^[A-Za-z][A-Za-z0-9]{0,39}$/),
        rowIndex: z
          .number()
          .int()
          .min(0)
          .max(Number.MAX_SAFE_INTEGER - 1),
      })
      .strict(),
  )
  .max(32);
export type DuplicateSourceRow = z.infer<typeof duplicateSourceRows>[number];
export function sourceDuplicateDiagnostics(
  error: z.ZodError,
): DuplicateSourceRow[] {
  const rows = error.issues
    .filter(
      (issue) =>
        issue.code === z.ZodIssueCode.custom &&
        issue.params?.sourceIdentity === "duplicate" &&
        issue.path.length === 3 &&
        issue.path[2] === "id",
    )
    .slice(0, 32)
    .map((issue) => ({ collection: issue.path[0], rowIndex: issue.path[1] }));
  const parsed = duplicateSourceRows.safeParse(rows);
  return parsed.success ? parsed.data : [];
}
