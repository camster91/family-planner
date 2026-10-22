/** Private, local editable documents and separately frozen canonical requests.
 * No prompts, photos, provider responses, inferred actors or domain records.
 */
import { z } from "zod";
import { queueOwnerSchema } from "@/lib/queue-owner-contract";
import { createRecipeSchema } from "@/lib/recipe-input-contract";
import { createEventSchema } from "@/lib/validations";
import { captureGrocerySchema } from "@/lib/capture-grocery-contract";

export const REVIEW_DOCUMENT_CONTRACT = "herewoven.review-document.v1";
export const REVIEW_DOCUMENT_MAX_BYTES = 3 * 1024 * 1024;
export const REVIEW_DOCUMENT_BODY_BYTES = 1024 * 1024;
export const REVIEW_EDIT_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const REVIEW_SUBMISSION_TTL_MS = 24 * 60 * 60 * 1000;
const id = z.string().min(1).max(128);
const key = z.string().regex(/^[A-Za-z0-9_-]{16,128}$/);
const time = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
export const reviewDocumentDomain = z.enum(["capture", "recipe"]);
const provenance = z
  .object({
    source: z.enum(["manual", "text-review", "photo-review", "recipe-link"]),
    sourceUrl: z.string().max(1500).nullable(),
    confidence: z.enum(["high", "medium", "low", "unknown"]),
    unknowns: z.array(z.string().max(200)).max(20),
    evaluatedAt: time.nullable(),
  })
  .strict();
// Do not coerce/trim unfinished inputs. "", "1.", "1/2" and invalid dates
// survive reload exactly; canonical schemas validate only a deliberate freeze.
const partialCaptureRow = z
  .object({
    clientId: id,
    kind: z.enum(["event", "task", "listitem"]),
    title: z.string().max(500),
    startTime: z.string().max(80),
    endTime: z.string().max(80),
    location: z.string().max(500),
    eventType: z.string().max(80),
    listName: z.string().max(200),
    quantity: z.string().max(80),
  })
  .strict();
export const captureEditableDocument = z
  .object({
    domain: z.literal("capture"),
    rows: z
      .array(partialCaptureRow)
      .max(20)
      .refine(
        (rows) => new Set(rows.map((row) => row.clientId)).size === rows.length,
      ),
    note: z.string().max(2000),
  })
  .strict();
export const recipeEditableDocument = z
  .object({
    domain: z.literal("recipe"),
    title: z.string().max(200),
    description: z.string().max(2000),
    instructions: z.string().max(20000),
    servings: z.string().max(80),
    prep: z.string().max(80),
    cook: z.string().max(80),
    sourceUrl: z.string().max(1500).nullable(),
    sourceCopy: z.boolean(),
    lines: z
      .array(
        z
          .object({
            clientId: id,
            name: z.string().max(200),
            amount: z.string().max(80),
            unit: z.string().max(32),
            note: z.string().max(200),
            ingredientId: id.nullable(),
            originalName: z.string().max(200).nullable(),
          })
          .strict(),
      )
      .max(100)
      .refine(
        (rows) => new Set(rows.map((row) => row.clientId)).size === rows.length,
      ),
  })
  .strict();
export const reviewEditableDocument = z.discriminatedUnion("domain", [
  captureEditableDocument,
  recipeEditableDocument,
]);
const exactRequest = z
  .object({
    key,
    action: z.enum(["event.create", "capture.grocery.add", "recipe.create"]),
    body: z.string().min(1).max(REVIEW_DOCUMENT_BODY_BYTES),
  })
  .strict()
  .superRefine((request, ctx) => {
    try {
      const value: unknown = JSON.parse(request.body);
      const schema =
        request.action === "event.create"
          ? createEventSchema.strict()
          : request.action === "capture.grocery.add"
            ? captureGrocerySchema.strict()
            : createRecipeSchema.extend({
                creation_protocol: z.literal("herewoven.recipe-create.v1"),
              });
      if (
        !schema.safeParse(value).success ||
        new TextEncoder().encode(request.body).byteLength >
          REVIEW_DOCUMENT_BODY_BYTES
      )
        throw new Error("invalid");
    } catch {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Invalid frozen request",
      });
    }
  });
const base = {
  userId: id,
  familyId: id,
  createdAt: time,
  updatedAt: time,
  expiresAt: time,
  provenance,
  draft: reviewEditableDocument,
};
export const reviewDocumentPayload = z
  .discriminatedUnion("phase", [
    z.object({ ...base, phase: z.literal("editing") }).strict(),
    z
      .object({
        ...base,
        phase: z.literal("submitted"),
        frozenAt: time,
        requests: z.array(exactRequest).min(1).max(20),
      })
      .strict(),
  ])
  .superRefine((document, ctx) => {
    let valid =
      document.updatedAt >= document.createdAt &&
      document.expiresAt >= document.updatedAt;
    if (document.phase === "editing") {
      valid =
        valid && document.expiresAt - document.createdAt <= REVIEW_EDIT_TTL_MS;
    } else {
      valid =
        valid &&
        document.frozenAt === document.updatedAt &&
        document.expiresAt - document.frozenAt <= REVIEW_SUBMISSION_TTL_MS &&
        new Set(document.requests.map((request) => request.key)).size ===
          document.requests.length &&
        (document.draft.domain === "recipe"
          ? document.requests.length === 1 &&
            document.requests[0].action === "recipe.create"
          : document.requests.every(
              (request) => request.action !== "recipe.create",
            ));
    }
    if (!valid)
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Invalid document lifecycle",
      });
  });
export const reviewDocumentEntry = z
  .object({
    kind: z.enum(["editable-review-document", "submitted-review-document"]),
    key,
    body: z.string().min(1).max(REVIEW_DOCUMENT_BODY_BYTES),
  })
  .strict()
  .superRefine((entry, ctx) => {
    try {
      const parsed = reviewDocumentPayload.safeParse(JSON.parse(entry.body));
      if (
        !parsed.success ||
        new TextEncoder().encode(entry.body).byteLength >
          REVIEW_DOCUMENT_BODY_BYTES ||
        (entry.kind === "editable-review-document") !==
          (parsed.data.phase === "editing")
      )
        throw new Error("invalid");
    } catch {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Invalid review document",
      });
    }
  });
export const reviewDocumentJournal = z
  .object({
    contract: z.literal(REVIEW_DOCUMENT_CONTRACT),
    entries: z.array(reviewDocumentEntry).max(1),
  })
  .strict();
export const reviewDocumentContext = z
  .object({
    contract: z.literal(REVIEW_DOCUMENT_CONTRACT),
    userId: id,
    familyId: id,
    domain: reviewDocumentDomain,
    role: z.enum(["parent", "teen"]),
    enabled: z.boolean(),
    adopted: z.boolean(),
    owner: queueOwnerSchema
      .refine((owner) => owner.kind === "person")
      .nullable(),
  })
  .strict()
  .refine(
    (value) =>
      (!value.enabled || (value.adopted && value.owner !== null)) &&
      (!value.owner || value.owner.ownerId === value.userId),
  );
export type ReviewDocumentEntry = z.infer<typeof reviewDocumentEntry>;
export type ReviewDocumentContext = z.infer<typeof reviewDocumentContext>;
export type ReviewDocumentPayload = z.infer<typeof reviewDocumentPayload>;
export type ReviewEditableDocument = z.infer<typeof reviewEditableDocument>;
export type ReviewExactRequest = z.infer<typeof exactRequest>;

export type RecipeEditableDocument = z.infer<typeof recipeEditableDocument>;

/** Shared journal/discovery ownership rule. Display fields never establish identity. */
export function reviewDocumentEntryMatchesContext(
  entry: ReviewDocumentEntry,
  context: ReviewDocumentContext,
): boolean {
  try {
    const parsed = reviewDocumentPayload.safeParse(JSON.parse(entry.body));
    return (
      parsed.success &&
      context.adopted &&
      parsed.data.userId === context.userId &&
      parsed.data.familyId === context.familyId &&
      parsed.data.draft.domain === context.domain
    );
  } catch {
    return false;
  }
}
