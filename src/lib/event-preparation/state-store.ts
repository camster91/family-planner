/** Internal scoped metadata adapter. No generated delegate, authorization,
 * status writer or task creation here. Caller owns transaction/lock order. */
import { createHash } from "node:crypto";
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { memberIdentityIdSchema as id } from "@/lib/member-subject-contract";
import {
  preparationCue,
  EventPreparationError,
  type PreparationCue,
} from "./contract";
type Reader = Pick<Prisma.TransactionClient, "$queryRaw">;
export type PreparationState = {
  id: string;
  revision: number;
  reviewedEventSourceToken: string;
  links: {
    id: string;
    choreId: string;
    position: number;
    cue: PreparationCue | null;
  }[];
};
type PlanRow = { id: string; revision: number; reviewed_event_source: string };
type LinkRow = {
  id: string;
  chore_id: string;
  position: number;
  cue_anchor: string | null;
  cue_direction: string | null;
  cue_minutes: number | null;
};
/** Plain preflight is only for collecting identity/chore lock IDs. Read again
 * after sorted source Chores, selected Event, plan and ordered links are locked. */
export async function readPreparationStateInTx(
  tx: Reader,
  familyId: string,
  eventId: string,
  lock = false,
): Promise<PreparationState | null> {
  id.parse(familyId);
  id.parse(eventId);
  const plans = lock
    ? await tx.$queryRaw<
        PlanRow[]
      >`SELECT "id", "revision", "reviewed_event_source" FROM "EventPreparation" WHERE "family_id"=${familyId} AND "event_id"=${eventId} FOR UPDATE`
    : await tx.$queryRaw<
        PlanRow[]
      >`SELECT "id", "revision", "reviewed_event_source" FROM "EventPreparation" WHERE "family_id"=${familyId} AND "event_id"=${eventId}`;
  if (!plans.length) return null;
  if (
    plans.length !== 1 ||
    !id.safeParse(plans[0].id).success ||
    !Number.isInteger(plans[0].revision) ||
    plans[0].revision < 0 ||
    plans[0].revision >= 2147483647 ||
    !/^[a-f0-9]{64}$/.test(plans[0].reviewed_event_source)
  )
    throw new EventPreparationError("UNAVAILABLE");
  const plan = plans[0];
  const rows = lock
    ? await tx.$queryRaw<
        LinkRow[]
      >`SELECT "id", "chore_id", "position", "cue_anchor", "cue_direction", "cue_minutes" FROM "EventPreparationStep" WHERE "family_id"=${familyId} AND "preparation_id"=${plan.id} ORDER BY "position", "id" LIMIT 100 FOR UPDATE`
    : await tx.$queryRaw<
        LinkRow[]
      >`SELECT "id", "chore_id", "position", "cue_anchor", "cue_direction", "cue_minutes" FROM "EventPreparationStep" WHERE "family_id"=${familyId} AND "preparation_id"=${plan.id} ORDER BY "position", "id" LIMIT 100`;
  if (
    rows.length > 99 ||
    new Set(rows.map((row) => row.chore_id)).size !== rows.length ||
    new Set(rows.map((row) => row.position)).size !== rows.length
  )
    throw new EventPreparationError("UNAVAILABLE");
  const links = rows.map((row) => {
    if (
      !id.safeParse(row.id).success ||
      !id.safeParse(row.chore_id).success ||
      !z.number().int().min(1).max(99).safeParse(row.position).success
    )
      throw new EventPreparationError("UNAVAILABLE");
    const none =
      row.cue_anchor === null &&
      row.cue_direction === null &&
      row.cue_minutes === null;
    const cue = none
      ? null
      : preparationCue.safeParse({
          anchor: row.cue_anchor,
          direction: row.cue_direction,
          minutes: row.cue_minutes,
        });
    if (cue && !cue.success) throw new EventPreparationError("UNAVAILABLE");
    return {
      id: row.id,
      choreId: row.chore_id,
      position: row.position,
      cue: cue?.success ? cue.data : null,
    };
  });
  return {
    id: plan.id,
    revision: plan.revision,
    reviewedEventSourceToken: plan.reviewed_event_source,
    links,
  };
}
/** Binds link IDs as well as membership/cues/order; not just visible content. */
export function preparationStateToken(state: PreparationState | null) {
  return createHash("sha256")
    .update(
      JSON.stringify(
        state
          ? [
              state.id,
              state.revision,
              state.reviewedEventSourceToken,
              state.links.map((row) => [
                row.id,
                row.choreId,
                row.position,
                row.cue
                  ? [row.cue.anchor, row.cue.direction, row.cue.minutes]
                  : null,
              ]),
            ]
          : null,
      ),
    )
    .digest("hex");
}
