/** Canonical profile-chore input validation; browser-safe, no database runtime. */
import { z } from "zod";
import { updateChoreSchema } from "@/lib/validations";
import { normalizedWeekdays } from "@/lib/chore-weekdays";
import { memberIdentityIdSchema } from "@/lib/member-subject-contract";

export const profileChoreCreateSchema = z
  .object({
    protocol: z.literal(2),
    selection: z.object({ memberId: memberIdentityIdSchema }).strict(),
    title: z.string().trim().min(1).max(200),
    description: z.string().max(1000).trim().nullable().optional(),
    points: z.number().int().min(0).max(1000).default(10),
    due_date: z
      .string()
      .refine((value) => !Number.isNaN(Date.parse(value)), "Invalid date"),
    difficulty: z.enum(["easy", "medium", "hard"]).default("medium"),
    frequency: z.enum(["once", "daily", "weekly", "monthly"]).default("once"),
    weekly_days: z.array(z.number().int().min(0).max(6)).max(7).default([]),
    photo_url: z.string().max(500).nullable().optional(),
    icon: updateChoreSchema.shape.icon,
    routine: updateChoreSchema.shape.routine,
    routine_order: updateChoreSchema.shape.routine_order,
  })
  .strict()
  .superRefine((value, context) => {
    const days = [...new Set(value.weekly_days)].sort((a, b) => a - b);
    if (value.frequency === "weekly" && days.length === 0) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["weekly_days"],
        message: "Select at least one weekday for a weekly profile chore.",
      });
    }
    if (value.frequency !== "weekly" && days.length > 0) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["weekly_days"],
        message: "Weekdays are only valid for weekly profile chores.",
      });
    }
  })
  .transform((value) => ({
    ...value,
    weekly_days: normalizedWeekdays(value.weekly_days),
  }));

export type ProfileChoreCreateInput = z.infer<typeof profileChoreCreateSchema>;
