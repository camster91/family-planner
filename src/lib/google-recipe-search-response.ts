/** Native Interactions REST response boundary (Api-Revision 2026-05-20).
 * Provider text is display data, never recipe fields or executable instructions.
 */
import { z } from "zod";
import { reportedTokenCount } from "./ai-usage-contract";
const object = z.record(z.string(), z.unknown());
const url = z
  .string()
  .max(4096)
  .url()
  .refine((value) => {
    const parsed = new URL(value);
    return parsed.protocol === "https:" && !parsed.username && !parsed.password;
  });
const annotation = z.object({
  type: z.literal("url_citation"),
  url,
  title: z.string().max(500),
  start_index: z.number().int().min(0),
  end_index: z.number().int().min(1),
});
const text = z
  .object({
    type: z.literal("text"),
    text: z.string().min(1).max(24000),
    annotations: z.array(annotation).max(100).default([]),
  })
  .refine((value) =>
    value.annotations.every(
      (a) => a.start_index < a.end_index && a.end_index <= value.text.length,
    ),
  );
const response = z.object({
  status: z.literal("completed"),
  steps: z.array(object).max(100),
});
export type GroundedRecipeText = z.infer<typeof text>;
export const googleRecipeDiscoverySchema = z
  .object({
    blocks: z.array(text).min(1).max(24),
    // Untrusted provider HTML: only an isolated sandbox may render this.
    suggestions: z.array(z.string().min(1).max(64000)).min(1).max(8),
  })
  .strict()
  .refine((value) => value.blocks.some((b) => b.annotations.length));
export type GoogleRecipeDiscovery = z.infer<typeof googleRecipeDiscoverySchema>;

export function parseGoogleRecipeDiscovery(
  value: unknown,
): GoogleRecipeDiscovery {
  const parsed = response.parse(value);
  const blocks: GroundedRecipeText[] = [],
    suggestions: string[] = [];
  let searched = false;
  for (const step of parsed.steps) {
    if (step.type === "google_search_call") searched = true;
    if (step.type === "model_output") {
      const content = z.array(text).max(24).parse(step.content);
      blocks.push(...content);
    }
    if (step.type === "google_search_result") {
      const results = z
        .array(z.object({ search_suggestions: z.string().min(1).max(64000) }))
        .min(1)
        .max(8)
        .parse(step.result);
      suggestions.push(...results.map((r) => r.search_suggestions));
    }
  }
  if (
    !searched ||
    !blocks.length ||
    !suggestions.length ||
    !blocks.some((b) => b.annotations.length) ||
    blocks.length > 24 ||
    suggestions.length > 8
  )
    throw new Error("Grounded recipe results unavailable");
  // Thought signatures, raw queries and arbitrary tool content do not cross to UI.
  return { blocks, suggestions };
}

/** Read usage even if display validation fails so a paid response is accounted for. */
export function readGoogleRecipeUsage(value: unknown) {
  const root = object.safeParse(value);
  const usage = object.safeParse(root.success ? root.data.usage : null);
  const u = usage.success ? usage.data : {};
  const input = reportedTokenCount(u.total_input_tokens);
  const output = reportedTokenCount(u.total_output_tokens);
  const thought = reportedTokenCount(u.total_thought_tokens);
  const combined =
    output === null || thought === null
      ? null
      : reportedTokenCount(output + thought);
  // Complete steps only. Missing/truncated search metadata must not become zero.
  const parsed = response.safeParse(value);
  const completeSteps =
    parsed.success && parsed.data.steps.some((s) => s.type === "model_output");
  let queries: number | null = completeSteps ? 0 : null;
  let grounded: boolean | null = completeSteps ? false : null;
  if (parsed.success)
    for (const step of parsed.data.steps) {
      if (step.type === "google_search_call") {
        grounded = true;
        const args = z
          .object({
            queries: z.array(z.string().min(1).max(1000)).min(1).max(100),
          })
          .safeParse(step.arguments);
        queries =
          args.success && queries !== null
            ? queries + args.data.queries.length
            : null;
      }
      if (
        step.type === "google_search_result" &&
        !parsed.data.steps.some((s) => s.type === "google_search_call")
      ) {
        queries = null;
        grounded = true;
      }
    }
  return {
    inputTokens: input,
    outputTokens: combined,
    searchQueries: queries,
    grounded,
  };
}
