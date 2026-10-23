/** Editable canonical chore form state. No authenticated actor or provider data.
 * Partial numbers/dates stay strings until a parent deliberately reviews them.
 */
import { z } from "zod";
import { createChoreSchema } from "@/lib/validations";
import { profileChoreCreateSchema } from "@/lib/profile-chore-create-contract";

export const captureChoreDraft = z
  .object({
    title: z.string().max(500),
    description: z.string().max(1000),
    points: z.string().max(80),
    assignment: z
      .object({ kind: z.enum(["account", "profile"]), id: z.string().max(128) })
      .strict(),
    dueDate: z.string().max(80),
    weeklyStart: z.string().max(80),
    difficulty: z.enum(["easy", "medium", "hard"]),
    frequency: z.enum(["once", "daily", "weekly", "monthly"]),
    weeklyDays: z.array(z.number().int().min(0).max(6)).max(7),
    photoUrl: z
      .string()
      .regex(/^\/api\/files\/chores\/[a-f0-9]{16}\.(jpg|jpeg|png|webp|heic)$/i)
      .nullable(),
    icon: z.string().max(80).nullable(),
    routine: z.string().max(40),
    routineOrder: z.string().max(80),
    takeTurns: z.boolean(),
    rotation: z.array(z.string().min(1).max(128)).max(50),
  })
  .strict();
export type CaptureChoreDraft = z.infer<typeof captureChoreDraft>;
export const captureChoreReview = z
  .object({
    draft: captureChoreDraft,
    reviewed: z
      .object({
        action: z.enum(["chore.create", "chore.profile.create"]),
        body: z.string().min(1).max(16384),
      })
      .strict()
      .nullable(),
  })
  .strict();

export function parseReviewedChore(
  action: "chore.create" | "chore.profile.create",
  body: unknown,
) {
  return action === "chore.create"
    ? createChoreSchema.parse(body)
    : profileChoreCreateSchema.parse(body);
}
