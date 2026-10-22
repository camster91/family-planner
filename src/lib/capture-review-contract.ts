/** Shared normalized proposals only: no provider raw output, photo or prompt.
 * These are review drafts, never authorization or a canonical write payload. */
import { z } from "zod";
const title = z.string().trim().min(1).max(200);
const optionalText = (max: number) =>
  z
    .string()
    .max(max)
    .nullish()
    .transform((value) => value ?? undefined);
const instant = z
  .string()
  .max(80)
  .refine(
    (value) =>
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})?$/.test(
        value,
      ) && Number.isFinite(Date.parse(value)),
  )
  .nullish()
  .transform((value) => value ?? undefined);
const eventFields = {
  title,
  start_time: instant,
  end_time: instant,
  location: optionalText(500),
  event_type: z
    .enum(["school", "sports", "appointment", "family", "work", "other"])
    .optional(),
};
export const captureEventReview = z.object(eventFields).strict();
export const captureTextReview = z
  .object({
    ...eventFields,
    kind: z.enum(["event", "task", "listitem"]),
    list_name: optionalText(200),
    confidence: z.enum(["high", "medium", "low"]).default("low"),
    note: optionalText(2000),
  })
  .strict();
export const capturePhotoReview = z
  .object({
    events: z.array(captureEventReview).max(20),
    confidence: z.enum(["high", "medium", "low"]).default("low"),
    note: z
      .string()
      .max(2000)
      .nullish()
      .transform((value) => value ?? undefined),
  })
  .strict();
export type CaptureTextReview = z.infer<typeof captureTextReview>;
export type CaptureEventReview = z.infer<typeof captureEventReview>;
export type CapturePhotoReview = z.infer<typeof capturePhotoReview>;
