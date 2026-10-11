import { z } from "zod";

const ASSISTANT_TODAY_PROTOCOL = "herewoven.assistant-today.v1" as const;

const boundedDate = z.string().datetime({ offset: true }).max(64);
const boundedText = z.string().max(512);

const eventSchema = z
  .object({
    title: boundedText,
    localStart: boundedText,
    localEnd: boundedText,
    isTask: z.boolean(),
    source: z.string().max(128).nullable(),
  })
  .strict();

const choreSchema = z
  .object({
    title: boundedText,
    dueDay: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    status: z.enum(["open", "in_progress", "done", "overdue", "unknown"]),
    assignee: boundedText,
  })
  .strict();

const dinnerSchema = z
  .object({
    title: boundedText.nullable(),
    cook: boundedText.nullable(),
    prepMinutes: z
      .number()
      .int()
      .min(0)
      .max(24 * 60)
      .nullable(),
  })
  .strict();

const grocerySchema = z
  .object({
    item: boundedText,
    quantity: z.number().finite().min(0).max(100_000),
    list: boundedText,
  })
  .strict();

const useSoonSchema = z
  .object({
    item: boundedText,
    place: boundedText,
    expiresOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    dateKind: z.enum(["best_before", "use_by"]),
    status: z.enum(["expired", "today", "soon"]),
    label: boundedText,
  })
  .strict();

const weatherSchema = z
  .object({
    unit: z.enum(["C", "F"]),
    current: z
      .object({
        temperature: z.number().finite().min(-150).max(150),
        summary: boundedText,
        icon: z.string().max(64),
        isDay: z.boolean(),
      })
      .strict(),
    days: z
      .array(
        z
          .object({
            day: boundedText,
            high: z.number().finite().min(-150).max(150),
            low: z.number().finite().min(-150).max(150),
            summary: boundedText,
            icon: z.string().max(64),
            precipitationChance: z.number().finite().min(0).max(100).nullable(),
          })
          .strict(),
      )
      .max(7),
    fetchedAt: boundedDate,
  })
  .strict();

/**
 * The only shape allowed to cross from the server broker into the provider
 * transport. There are deliberately no record IDs, names, emails, URLs, or
 * arbitrary feature/configuration blobs in this schema.
 */
export const assistantTodayContextSchema = z
  .object({
    protocol: z.literal(ASSISTANT_TODAY_PROTOCOL),
    generatedAt: boundedDate,
    expiresAt: boundedDate,
    viewer: z
      .object({
        role: z.enum(["parent", "teen"]),
        localDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        timeZone: z.string().min(1).max(100),
      })
      .strict(),
    today: z
      .object({
        events: z.array(eventSchema).max(20),
        chores: z.array(choreSchema).max(30),
        dinner: dinnerSchema.nullable(),
        groceries: z.array(grocerySchema).max(20),
        useSoon: z.array(useSoonSchema).max(20),
        weather: weatherSchema.nullable(),
        unavailable: z
          .array(z.enum(["dinner", "groceries", "useSoon", "weather"]))
          .max(4),
      })
      .strict(),
  })
  .strict()
  .superRefine((value, ctx) => {
    const generatedAt = Date.parse(value.generatedAt);
    const expiresAt = Date.parse(value.expiresAt);
    if (!Number.isFinite(generatedAt) || !Number.isFinite(expiresAt)) return;
    if (expiresAt <= generatedAt) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["expiresAt"],
        message: "Today context must expire after it is generated",
      });
    }
  });

export type AssistantTodayTransportContext = z.infer<
  typeof assistantTodayContextSchema
>;
