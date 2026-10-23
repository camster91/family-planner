/** Shared target shape only; a selected target never confers authority. */
import { z } from "zod/mini";
import { memberIdentityIdSchema as id } from "@/lib/member-identity-schema";
export type ResponsibilityTarget = {
  kind: "chore" | "pickup" | "handoff";
  id: string;
};
const responsibilityTargetMini = z.strictObject({
  kind: z.enum(["chore", "pickup", "handoff"]),
  id,
});
export const responsibilityTarget = responsibilityTargetMini;
