import { preparationReadScope } from "@/lib/event-preparation/read-contract";
import { scheduleReviewScope } from "@/lib/calendar-planning/conflict-review";
import { responsibilityTarget } from "@/lib/responsibility";
import { z } from "zod";
import { parseDateOnly } from "@/lib/dates";
import {
  WEEKLY_RESET_PROTOCOL,
  weeklyResetScope,
  weeklyResetStep,
} from "@/lib/weekly-reset";
const LIMIT = 8;
const day = z.string().refine((value) => parseDateOnly(value) !== null);
const when = z.union([day, z.string().datetime()]);
export const weeklyResetSummaryQuery = weeklyResetScope
  .extend({ step: weeklyResetStep })
  .strict();
const summaryRow = z
  .object({
    responsibility: responsibilityTarget.optional(),
    scheduleReview: scheduleReviewScope.optional(),
    preparation: preparationReadScope
      .pick({ eventId: true, timeZone: true })
      .optional(),
    title: z.string().max(480),
    when: when.nullable(),
    end: when.nullable().optional(),
    owner: z.enum(["you", "assigned", "unassigned", "unknown"]).optional(),
    ownerName: z.string().max(480).optional(),
    subjectKind: z.enum(["account", "profile"]).optional(),
    sourceTitle: z.string().max(480).optional(),
    href: z
      .string()
      .regex(/^\/dashboard\/meals\/recipes\/[^/?#]+$/)
      .optional(),
    quantity: z.number().int().nonnegative().optional(),
    prepared: z.boolean().optional(),
    eaten: z.number().int().nonnegative().optional(),
    remaining: z.number().int().nonnegative().optional(),
    nextPrep: day.nullable().optional(),
    dateKind: z.enum(["best_before", "use_by"]).optional(),
  })
  .strict();
export const weeklyResetSummary = z
  .object({
    protocol: z.literal(WEEKLY_RESET_PROTOCOL),
    owner: z.object({ userId: z.string(), familyId: z.string() }).strict(),
    scope: weeklyResetScope,
    step: weeklyResetStep,
    generatedAt: z.string().datetime(),
    groups: z
      .array(
        z
          .object({
            kind: z.enum([
              "events",
              "chores",
              "pickups",
              "handoffs",
              "meals",
              "prep",
              "food",
              "groceries",
              "gaps",
            ]),
            rows: z.array(summaryRow).max(LIMIT),
            more: z.boolean(),
            total: z.number().int().nonnegative().optional(),
            incomplete: z.boolean().optional(),
            compared: z.number().int().min(0).max(8).optional(),
          })
          .strict(),
      )
      .max(3),
    notes: z
      .array(
        z.enum([
          "storedScheduleOnly",
          "acceptanceAndBackupUnknown",
          "profileChoresInChores",
          "boundedPreview",
          "groceryGapsNotAssessed",
          "prepRequiresVerifiedEmail",
          "currentFoodSnapshot",
          "storedChoresOnly",
          "ingredientPresenceOnly",
          "recipeGapsIncomplete",
        ]),
      )
      .max(10),
  })
  .strict();
export type WeeklyResetSummary = z.infer<typeof weeklyResetSummary>;
