/** Explicit selected-source scope, independent from UI picker pagination. */
import { z } from "zod";
import {
  memberIdentityIdSchema as id,
  memberProtocolSchema,
} from "@/lib/member-subject-contract";
import { responsibilitySubject } from "@/lib/responsibility";
import { isValidTimeZone } from "@/lib/calendar-import/timezone";
import { parseDateOnly } from "@/lib/dates";
import type { PreparationCommand } from "./contract";
export const preparationReadScope = z
  .object({
    eventId: id,
    timeZone: z.string().max(100).refine(isValidTimeZone),
    memberProtocol: memberProtocolSchema,
    choreIds: z.array(id).max(300),
    subjects: z.array(responsibilitySubject).max(100),
    routine: z
      .object({
        stackId: id,
        occurrenceDay: z
          .string()
          .refine((value) => parseDateOnly(value) !== null),
      })
      .strict()
      .nullable(),
  })
  .strict();
export type PreparationReadScope = z.infer<typeof preparationReadScope>;
export function scopeForPreparationCommand(
  command: PreparationCommand,
): PreparationReadScope {
  return {
    eventId: command.eventId,
    timeZone: command.timeZone,
    memberProtocol: command.memberProtocol,
    choreIds:
      command.action === "set-plan"
        ? command.steps.flatMap((step) =>
            step.kind === "existing" ? [step.choreId] : [],
          )
        : [],
    subjects:
      command.action === "reuse-routine"
        ? command.steps.map((step) => step.subject)
        : command.steps.flatMap((step) =>
            step.kind === "new" ? [step.subject] : [],
          ),
    routine:
      command.action === "reuse-routine"
        ? { stackId: command.stackId, occurrenceDay: command.occurrenceDay }
        : null,
  };
}
