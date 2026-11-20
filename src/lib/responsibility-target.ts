/** Shared target shape only; a selected target never confers authority. */
import { z } from "zod/mini";
import { memberIdentityIdSchema as id } from "@/lib/member-identity-schema";
import type { ResponsibilityTarget } from "@/lib/responsibility-target-shape";
export type { ResponsibilityTarget };
const responsibilityTargetMini = z.strictObject({
  kind: z.enum(["chore", "pickup", "handoff"]),
  id,
});
export const responsibilityTarget = responsibilityTargetMini;
