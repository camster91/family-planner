/** Client-safe transport. No target notes, addresses, tokens or display-role authority. */
import { z } from "zod";
import {
  RESPONSIBILITY_PROTOCOL,
  responsibilityTarget,
  responsibilitySubject,
  type ResponsibilityCommand,
} from "@/lib/responsibility";
const id = z.string().min(1).max(128);
export const RESPONSIBILITY_ACTION = "responsibility.intent.v1";
export const responsibilityQuery = responsibilityTarget;
const named = z
  .object({ subject: responsibilitySubject, name: z.string().max(400) })
  .strict();
const proof = z
  .object({
    decision: z.enum(["accepted", "declined"]),
    method: z.enum(["self", "parent-recorded"]),
    at: z.string().datetime(),
    byAccountId: id,
    byName: z.string().max(400),
  })
  .strict();
const slot = z.object({ member: named, statement: proof.nullable() }).strict();
export const responsibilityView = z
  .object({
    protocol: z.literal(RESPONSIBILITY_PROTOCOL),
    owner: z.object({ userId: id, familyId: id }).strict(),
    target: responsibilityTarget,
    title: z.string().max(480),
    href: z.enum([
      "/dashboard/chores",
      "/dashboard/today",
      "/dashboard/pickups",
      "/dashboard/handoff",
    ]),
    sourceToken: z.string().regex(/^[a-f0-9]{64}$/),
    revision: z.number().int().nonnegative(),
    active: z.boolean(),
    writesEnabled: z.boolean(),
    role: z.enum(["parent", "teen", "child"]),
    primary: slot.nullable(),
    backup: slot.nullable(),
    sourceChanged: z.boolean(),
    choices: z.array(named).max(50),
    moreChoices: z.boolean(),
  })
  .strict();
export type ResponsibilityView = z.infer<typeof responsibilityView>;
export const responsibilityReceipt = z
  .object({
    receipt: z
      .object({
        protocol: z.literal(RESPONSIBILITY_PROTOCOL),
        userId: id,
        familyId: id,
        target: responsibilityTarget,
        requestKey: z.string().regex(/^[A-Za-z0-9_-]{16,128}$/),
        action: z.enum([
          "set-backup",
          "set-coordinator",
          "state-intent",
          "clear-statement",
        ]),
        sourceToken: z.string().regex(/^[a-f0-9]{64}$/),
        revision: z.number().int().nonnegative(),
      })
      .strict(),
  })
  .strict();
export function responsibilityReceiptMatches(
  value: unknown,
  command: ResponsibilityCommand,
  key: string,
) {
  const parsed = responsibilityReceipt.safeParse(value);
  if (!parsed.success) return false;
  const p = parsed.data.receipt;
  return (
    p.userId === command.userId &&
    p.familyId === command.familyId &&
    p.target.kind === command.target.kind &&
    p.target.id === command.target.id &&
    p.requestKey === key &&
    p.action === command.action &&
    p.sourceToken === command.sourceToken &&
    [command.expectedRevision, command.expectedRevision + 1].includes(
      p.revision,
    )
  );
}
