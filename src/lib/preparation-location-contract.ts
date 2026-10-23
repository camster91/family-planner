import { object, string } from "zod/v4";
import type { infer as ZodInfer } from "zod/v4";
import { memberIdentityIdSchema } from "@/lib/member-identity-schema";
import { isValidTimeZone } from "@/lib/calendar-import/timezone";

export const preparationLocationSchema = object({
  eventId: memberIdentityIdSchema,
  timeZone: string().max(100).refine(isValidTimeZone),
}).strict();

export type PreparationLocation = ZodInfer<typeof preparationLocationSchema>;
