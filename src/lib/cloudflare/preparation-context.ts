/** One primary read projects parent relationships and routine provenance together.
 * The current actor/household/generation is checked in that same SQL snapshot.
 * No shared-device or child caller receives these parent relationships.
 */
import { memberIdentityIdSchema } from "../member-subject-contract";
import { isFeatureEnabled, normalizeFeatures } from "../features";
import { isProfileChoreEnabled } from "../profile-chore-gates";
import {
  preparationCopyFactId,
  preparationOriginFact,
  PREPARATION_COPY_ACTION,
} from "../event-preparation/origin";
import type { PreparationRoutineOrigins } from "../event-preparation/origin-contract";
import { getD1Database, type D1Store } from "./database";

export async function readD1ParentPreparationContext(
  input: {
    userId: string;
    familyId: string;
    role: string;
    tokenVersion?: number;
    choreIds: string[];
  },
  database?: D1Store,
) {
  const backlinks: Record<string, string> = {};
  const origins: PreparationRoutineOrigins = {};
  if (input.role !== "parent") return { backlinks, origins };
  const ids = [...new Set(input.choreIds)]
    .filter((id) => memberIdentityIdSchema.safeParse(id).success)
    .slice(0, 300);
  if (!ids.length) return { backlinks, origins };
  const wanted = ids.map((id) => ({
    id,
    fact: preparationCopyFactId(input.familyId, id),
  }));
  const rows = await (database ?? (await getD1Database()))
    .withSession("first-primary")
    .prepare(
      `WITH selected AS (
      SELECT json_extract(value,'$.id') AS id,json_extract(value,'$.fact') AS fact FROM json_each(?1)
    ), facts AS (
      SELECT c.id,f.features,e.id AS event_id,a.created_at AS copied_at,
        CASE WHEN length(a.metadata)<=4096 AND json_valid(a.metadata) THEN a.metadata ELSE NULL END AS metadata
      FROM selected w JOIN "Chore" c ON c.id=w.id AND c.family_id=?2
      JOIN "User" u ON u.id=?3 AND u.family_id=c.family_id AND u.role='parent'
        AND (?4 IS NULL OR u.token_version=?4)
      JOIN "Family" f ON f.id=c.family_id
      LEFT JOIN "EventPreparationStep" p ON p.chore_id=c.id AND p.family_id=c.family_id
      LEFT JOIN "EventPreparation" plan ON plan.id=p.preparation_id AND plan.family_id=c.family_id
      LEFT JOIN "Event" e ON e.id=plan.event_id AND e.family_id=c.family_id
      LEFT JOIN "Activity" a ON a.id=w.fact AND a.family_id=c.family_id AND a.type=?5 AND a.subject_member_erased=0
      WHERE c.is_template=0 AND c.member_subject_erased=0 AND (?6 OR c.assigned_to IS NOT NULL)
    ) SELECT facts.*,r.id AS stack_id,r.label,s.id AS source_id
      FROM facts LEFT JOIN "RoutineStack" r ON r.id=json_extract(facts.metadata,'$.routineCopy.stackId') AND r.family_id=?2
      LEFT JOIN "Chore" s ON s.id=json_extract(facts.metadata,'$.routineCopy.sourceChoreId') AND s.family_id=?2
        AND s.routine_stack_id=r.id AND s.member_subject_erased=0 AND s.is_template=0
        AND strftime('%Y-%m-%d',s.due_date/1000,'unixepoch')=json_extract(facts.metadata,'$.routineCopy.occurrenceDay')
        AND (?6 OR s.assigned_to IS NOT NULL)
      ORDER BY facts.id LIMIT 300`,
    )
    .bind(
      JSON.stringify(wanted),
      input.familyId,
      input.userId,
      input.tokenVersion ?? null,
      PREPARATION_COPY_ACTION,
      isProfileChoreEnabled() ? 1 : 0,
    )
    .all<{
      id: string;
      features: string | null;
      event_id: string | null;
      metadata: string | null;
      copied_at: number | null;
      stack_id: string | null;
      label: string | null;
      source_id: string | null;
    }>();
  for (const row of rows.results) {
    let features;
    try {
      features = normalizeFeatures(
        row.features ? JSON.parse(row.features) : null,
      );
    } catch {
      continue;
    }
    if (
      !isFeatureEnabled(features, "calendar") ||
      !isFeatureEnabled(features, "chores")
    )
      continue;
    if (memberIdentityIdSchema.safeParse(row.event_id).success)
      backlinks[row.id] = row.event_id!;
    if (!row.metadata || row.copied_at === null) continue;
    try {
      const fact = preparationOriginFact.parse(JSON.parse(row.metadata));
      if (
        fact.target.id !== row.id ||
        fact.routineCopy.sourceChoreId === row.id
      )
        continue;
      const copiedAt = new Date(row.copied_at).toISOString();
      origins[row.id] =
        row.stack_id === fact.routineCopy.stackId &&
        row.source_id === fact.routineCopy.sourceChoreId &&
        row.label !== null
          ? {
              state: "available",
              ...fact.routineCopy,
              label: row.label.slice(0, 200),
              copiedAt,
            }
          : { state: "unavailable", copiedAt };
    } catch {
      /* Invalid facts never become links or invented provenance. */
    }
  }
  return { backlinks, origins };
}
