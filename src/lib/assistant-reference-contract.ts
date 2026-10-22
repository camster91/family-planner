/** Browser-safe citations. Provider output never supplies labels or URLs. */
import { z } from "zod";
import { assistantReplySchema } from "./assistant-actions";
export const ASSISTANT_REFERENCES_PROTOCOL =
  "herewoven.assistant-references.v1" as const;
export const ASSISTANT_TARGET_PROOF_HEADER = "X-Assistant-Target-Proof";
export const assistantDeleteKind = z.enum([
  "event_delete",
  "chore_delete",
  "list_delete",
]);
export const assistantDeletePreviewSchema = z
  .object({
    id: z.string().min(1).max(128),
    title: z.string().min(1).max(512),
    detail: z.string().optional(),
    context: z.string().max(2000).optional(),
    itemCount: z.number().int().min(0).max(500).optional(),
    proof: z.string().min(1).max(4096),
  })
  .strict();
export const ASSISTANT_SOURCE_PROOF_HEADER = "X-Assistant-Source-Proof";
export const ASSISTANT_CONFIRMATION_PROTOCOL =
  "herewoven.assistant-confirmation.v1" as const;
export const assistantConfirmationKind = z.enum([
  "event_create",
  "chore_create",
  "list_create",
  "note_create",
  "grocery_add",
  "event_delete",
  "chore_delete",
  "list_delete",
]);
export type AssistantConfirmationKind = z.infer<
  typeof assistantConfirmationKind
>;
export const assistantReferenceId = z.string().regex(/^asr1_[a-f0-9]{64}$/);
export const assistantEvidence = z
  .object({
    ref: assistantReferenceId,
    kind: z.enum(["event", "chore", "dinner", "grocery", "inventory"]),
    label: z
      .string()
      .min(1)
      .max(512)
      .refine((value) => value.trim().length > 0),
    observedAt: z.string().datetime(),
    href: z
      .string()
      .max(500)
      .refine((value) =>
        /^\/dashboard\/(calendar\/edit\?id=[A-Za-z0-9_-]+|chores\/edit\?id=[A-Za-z0-9_-]+|lists\/[A-Za-z0-9_-]+|meals|inventory)$/.test(
          value,
        ),
      ),
  })
  .strict();
export const assistantResponseSchema = assistantReplySchema
  .extend({
    evidence: z.array(assistantEvidence).max(8).optional(),
    sourceProof: z.string().min(1).max(4096).optional(),
  })
  .strict();
export const referencedAssistantReply = assistantReplySchema
  .extend({
    basis: z.enum(["context", "clarification", "general"]),
    references: z.array(assistantReferenceId).max(8),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (
      (value.basis === "context" && !value.references.length) ||
      (value.basis !== "context" && value.references.length) ||
      new Set(value.references).size !== value.references.length
    )
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Invalid evidence basis",
      });
  });
export type AssistantEvidence = z.infer<typeof assistantEvidence>;
