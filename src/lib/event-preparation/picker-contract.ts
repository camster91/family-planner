/** Paged discovery is not the exact reviewed source set or mutation authority. */
import { z } from "zod";
import { memberIdentityIdSchema as id } from "@/lib/member-subject-contract";
import { responsibilitySubject } from "@/lib/responsibility";
import { parseDateOnly } from "@/lib/dates";
import { isValidTimeZone } from "@/lib/calendar-import/timezone";
export const preparationPickerQuery = z
  .object({
    eventId: id,
    timeZone: z.string().max(100).refine(isValidTimeZone),
    memberProtocol: z.literal("2"),
    kind: z.enum(["tasks", "accounts", "profiles", "routines"]),
    search: z.string().trim().max(100).default(""),
    after: id.optional(),
  })
  .strict();
export type PreparationPickerQuery = z.infer<typeof preparationPickerQuery>;
export const preparationPickerReply = z
  .object({
    owner: z.object({ userId: id, familyId: id }).strict(),
    eventId: id,
    kind: preparationPickerQuery.shape.kind,
    search: z.string().max(100),
    after: id.nullable(),
    next: id.nullable(),
    items: z
      .array(
        z.discriminatedUnion("kind", [
          z
            .object({
              kind: z.literal("task"),
              id,
              title: z.string().max(200),
              dueDay: z
                .string()
                .refine((value) => parseDateOnly(value) !== null),
              subjectName: z.string().max(200),
            })
            .strict(),
          z
            .object({
              kind: z.literal("person"),
              id,
              subject: responsibilitySubject,
              name: z.string().max(200),
            })
            .strict(),
          z
            .object({
              kind: z.literal("routine"),
              id,
              label: z.string().max(40),
            })
            .strict(),
        ]),
      )
      .max(20),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (
      (value.next !== null && value.next === value.after) ||
      new Set(value.items.map((item) => item.id)).size !== value.items.length ||
      value.items.some((item) =>
        value.kind === "tasks"
          ? item.kind !== "task"
          : value.kind === "routines"
            ? item.kind !== "routine"
            : item.kind !== "person" ||
              (value.kind === "accounts"
                ? item.subject.kind !== "account" ||
                  item.subject.accountId !== item.id
                : item.subject.kind !== "profile" ||
                  item.subject.memberId !== item.id),
      )
    )
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Inconsistent preparation picker page",
      });
  });
export type PreparationPickerReply = z.infer<typeof preparationPickerReply>;
