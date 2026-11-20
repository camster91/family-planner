/**
 * Zod-free browser check for the shared responsibility target. Mirrors
 * `responsibilityTarget` (responsibility-target.ts), which stays the
 * server/composition contract; parity is tested.
 */
import {
  SHAPE_FAILURE,
  isOneOf,
  shapeSuccess,
  strictRecord,
  type ShapeResult,
} from "@/lib/browser-shape";
import { isMemberIdentityId } from "@/lib/member-identity-id";

export type ResponsibilityTarget = {
  kind: "chore" | "pickup" | "handoff";
  id: string;
};

const KINDS = ["chore", "pickup", "handoff"] as const;

export function parseResponsibilityTarget(
  value: unknown,
): ShapeResult<ResponsibilityTarget> {
  const record = strictRecord(value, ["kind", "id"]);
  if (!record) return SHAPE_FAILURE;
  const { kind, id } = record;
  if (!isOneOf(kind, KINDS) || !isMemberIdentityId(id)) return SHAPE_FAILURE;
  return shapeSuccess({ kind, id });
}
