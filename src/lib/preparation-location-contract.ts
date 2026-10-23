import { z } from "zod/mini";
import type { infer as ZodInfer } from "zod/mini";
import { memberIdentityIdSchema } from "@/lib/member-identity-schema";
import { isValidTimeZone } from "@/lib/calendar-import/timezone";

export const preparationLocationSchema = z.strictObject({
  eventId: memberIdentityIdSchema,
  timeZone: z.string().check(z.maxLength(100), z.refine(isValidTimeZone)),
});

export type PreparationLocation = ZodInfer<typeof preparationLocationSchema>;
