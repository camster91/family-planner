/**
 * Zod-free browser check for an event-preparation location. Mirrors
 * `preparationLocationSchema` (preparation-location-contract.ts), which stays
 * the server/composition contract; parity is tested.
 */
import {
  SHAPE_FAILURE,
  isStringLength,
  shapeSuccess,
  strictRecord,
  type ShapeResult,
} from "@/lib/browser-shape";
import { isMemberIdentityId } from "@/lib/member-identity-id";
import { isValidTimeZone } from "@/lib/calendar-import/timezone";

export type PreparationLocation = { eventId: string; timeZone: string };

export function parsePreparationLocation(
  value: unknown,
): ShapeResult<PreparationLocation> {
  const record = strictRecord(value, ["eventId", "timeZone"]);
  if (!record) return SHAPE_FAILURE;
  const { eventId, timeZone } = record;
  if (
    !isMemberIdentityId(eventId) ||
    !isStringLength(timeZone, 0, 100) ||
    !isValidTimeZone(timeZone)
  )
    return SHAPE_FAILURE;
  return shapeSuccess({ eventId, timeZone });
}
