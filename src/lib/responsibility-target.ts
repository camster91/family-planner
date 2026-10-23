/** Shared target shape only; a selected target never confers authority. */
import { z } from "zod";
import { memberIdentityIdSchema as id } from "@/lib/member-subject-contract";
export const responsibilityTarget = z
  .object({ kind: z.enum(["chore", "pickup", "handoff"]), id })
  .strict();
export type ResponsibilityTarget = z.infer<typeof responsibilityTarget>;
