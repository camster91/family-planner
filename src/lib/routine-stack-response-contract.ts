import { z } from "zod";
/** Browser-safe compact receipt validation, shared with read-only inspection. */
export const compactResponseSchema = z
  .object({
    stack_id: z.string().min(1),
    version: z.number().int(),
    steps: z.array(
      z.tuple([z.string().min(1), z.number().int(), z.number().int()]),
    ),
    assignments: z.array(
      z.tuple([z.string().min(1).nullable(), z.string().nullable()]),
    ),
    members: z.array(z.tuple([z.string().min(1), z.string()])),
    fingerprint: z.string(),
  })
  .strict();

