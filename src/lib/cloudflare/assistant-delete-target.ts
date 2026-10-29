import {
  AssistantSourceRefused,
  type AssistantProofActor,
  type AssistantSourceGuard,
} from "@/lib/assistant-source-proof";
import {
  readDeleteTargetProof,
  issueDeleteTargetProof,
  deleteTargetSnapshotCurrent,
  type DeleteSnapshot,
  type DeleteTargetGuard,
  type DeleteKind,
} from "@/lib/assistant-delete-target";
import { assistantDeletePreviewSchema } from "@/lib/assistant-reference-contract";
import { canonicalRequestJson } from "@/lib/idempotency-request-json";
import { normalizeFeatures, isFeatureEnabled } from "@/lib/features";
import {
  EVENT_READ_ONLY_CODE,
  EVENT_READ_ONLY_MESSAGE,
} from "@/lib/calendar-import/source";
import { getD1Database, type D1Store } from "./database";
import { captureD1Reads } from "./read-witness";
import type { D1ReadClient, NativeD1 } from "./read-client";
import { d1AssistantSourceChecks } from "./assistant-source";
import { readD1ChoreDeleteEligibility } from "./chore-delete-policy";
import { d1WriteCheck } from "./write-check";

/** Full target and affected child sets, bounded identically to PostgreSQL.
 * Convert SDK dates to explicit JSON strings before fingerprinting; Date objects
 * must never silently canonicalize to {}. Private rows stay server-side.
 */
export async function readD1EventDeleteSnapshot(
  db: D1ReadClient,
  familyId: string,
  eventId: string,
): Promise<DeleteSnapshot | null> {
  const row = await db.event.findFirst({
    where: { id: eventId, family_id: familyId },
  });
  if (!row) return null;
  const [plans, steps, links, foreign] = await Promise.all([
    db.eventPreparation.findMany({
      where: { event_id: eventId, family_id: familyId },
      orderBy: { id: "asc" },
      take: 501,
    }),
    db.eventPreparationStep.findMany({
      where: {
        family_id: familyId,
        preparation: { event_id: eventId, family_id: familyId },
      },
      orderBy: { id: "asc" },
      take: 501,
    }),
    db.calendarEventLink.findMany({
      where: { event_id: eventId, family_id: familyId },
      orderBy: { id: "asc" },
      take: 501,
    }),
    db.calendarEventLink.findFirst({
      where: { event_id: eventId, family_id: { not: familyId } },
      select: { id: true },
    }),
  ]);
  if (foreign || [plans, steps, links].some((rows) => rows.length > 500))
    throw new AssistantSourceRefused();
  const snapshot: DeleteSnapshot = JSON.parse(
    JSON.stringify({ row, children: [plans, steps, links] }),
  );
  if (
    new TextEncoder().encode(canonicalRequestJson(snapshot)).length > 1_048_576
  )
    throw new AssistantSourceRefused();
  return snapshot;
}

/** Chore cascades retain the parent preparation revision, matching PostgreSQL's
 * explicit no-DELETE-version rule. Exact child membership is the delete proof.
 */
export async function readD1ChoreDeleteSnapshot(
  db: D1ReadClient,
  familyId: string,
  id: string,
): Promise<DeleteSnapshot | null> {
  const row = await db.chore.findFirst({ where: { id, family_id: familyId } });
  if (!row) return null;
  const [assignments, steps, responsibilities, foreign] = await Promise.all([
    db.choreAssignment.findMany({
      where: { chore_id: id, family_id: familyId },
      orderBy: { id: "asc" },
      take: 501,
    }),
    db.eventPreparationStep.findMany({
      where: { chore_id: id, family_id: familyId },
      orderBy: { id: "asc" },
      take: 501,
    }),
    db.responsibilityState.findMany({
      where: { chore_id: id, family_id: familyId },
      orderBy: { id: "asc" },
      take: 501,
    }),
    db.choreAssignment.findFirst({
      where: { chore_id: id, family_id: { not: familyId } },
      select: { id: true },
    }),
  ]);
  if (
    foreign ||
    row.member_subject_erased ||
    [assignments, steps, responsibilities].some((rows) => rows.length > 500)
  )
    throw new AssistantSourceRefused();
  const snapshot: DeleteSnapshot = JSON.parse(
    JSON.stringify({ row, children: [assignments, steps, responsibilities] }),
  );
  if (
    new TextEncoder().encode(canonicalRequestJson(snapshot)).length > 1_048_576
  )
    throw new AssistantSourceRefused();
  return snapshot;
}
export async function readD1ListDeleteSnapshot(
  db: D1ReadClient,
  familyId: string,
  id: string,
): Promise<DeleteSnapshot | null> {
  const row = await db.list.findFirst({ where: { id, family_id: familyId } });
  if (!row) return null;
  const items = await db.listItem.findMany({
    where: { list_id: id },
    orderBy: { id: "asc" },
    take: 501,
  });
  const trips = await db.groceryShoppingSession.findMany({
    where: { list_id: id, family_id: familyId },
    orderBy: { id: "asc" },
    take: 501,
  });
  const foreign = await db.groceryShoppingSession.findFirst({
    where: { list_id: id, family_id: { not: familyId } },
    select: { id: true },
  });
  if (foreign || items.length > 500 || trips.length > 500)
    throw new AssistantSourceRefused();
  const snapshot: DeleteSnapshot = JSON.parse(
    JSON.stringify({ row, children: [items, trips] }),
  );
  if (
    new TextEncoder().encode(canonicalRequestJson(snapshot)).length > 1_048_576
  )
    throw new AssistantSourceRefused();
  return snapshot;
}
const snapshotFor = (
  db: D1ReadClient,
  familyId: string,
  kind: DeleteKind,
  id: string,
) =>
  kind === "event_delete"
    ? readD1EventDeleteSnapshot(db, familyId, id)
    : kind === "chore_delete"
      ? readD1ChoreDeleteSnapshot(db, familyId, id)
      : readD1ListDeleteSnapshot(db, familyId, id);

/** Constructed guards still bind signature/owner/kind/id before any receipt
 * replay. New effects must additionally compare these captured native reads
 * inside the deletion/cascade/receipt batch. No emulated transaction or lock.
 */
export function d1EventDeleteTargetChecks(
  database: D1Store,
  actor: AssistantProofActor,
  id: string,
  guard: DeleteTargetGuard,
) {
  return d1DeleteTargetChecks(database, actor, "event_delete", id, guard);
}
export async function d1DeleteTargetChecks(
  database: D1Store,
  actor: AssistantProofActor,
  kind: DeleteKind,
  eventId: string,
  guard: DeleteTargetGuard,
) {
  if (!guard.d1 || guard.d1.kind !== kind || guard.d1.targetId !== eventId)
    throw new AssistantSourceRefused();
  const payload = readDeleteTargetProof(guard.d1.token, actor, kind, eventId);
  try {
    guard.assertCurrent();
    const capture = await captureD1Reads(
      (db) => snapshotFor(db, actor.familyId, kind, eventId),
      database as unknown as NativeD1,
    );
    if (!capture.value || !deleteTargetSnapshotCurrent(payload, capture.value))
      throw new AssistantSourceRefused();
    return {
      checks(db: Pick<D1Store, "prepare">) {
        guard.assertCurrent();
        return [
          ...capture.checks(db),
          d1WriteCheck(
            db,
            `(CAST(strftime('%s','now') AS INTEGER)*1000 + CAST(substr(strftime('%f','now'),4,3) AS INTEGER)) >= ?1
          AND (CAST(strftime('%s','now') AS INTEGER)*1000 + CAST(substr(strftime('%f','now'),4,3) AS INTEGER)) < ?2`,
            [payload.issuedAt, payload.expiresAt],
          ),
        ];
      },
    };
  } catch {
    throw new AssistantSourceRefused();
  }
}

/** Exact target review remains a user-selected, read-only action. Source and
 * target reads are validated together in one native batch before issuing the
 * content-free keyed proof; canonical deletion must verify it again later.
 */
export function reviewD1EventDeleteTarget(
  actor: AssistantProofActor,
  eventId: string,
  sourceGuard: AssistantSourceGuard,
  database?: D1Store,
) {
  return reviewD1DeleteTarget(
    actor,
    "event_delete",
    eventId,
    sourceGuard,
    database,
  );
}
export async function reviewD1DeleteTarget(
  actor: AssistantProofActor,
  kind: DeleteKind,
  eventId: string,
  sourceGuard: AssistantSourceGuard,
  database?: D1Store,
) {
  const store = database ?? (await getD1Database());
  const source = await d1AssistantSourceChecks(store, actor, kind, sourceGuard);
  const capture = await captureD1Reads(
    async (db) => {
      const current = await db.user.findUnique({
        where: { id: actor.userId },
        select: { family_id: true, role: true, token_version: true },
      });
      if (
        !current ||
        current.family_id !== actor.familyId ||
        current.role !== actor.role ||
        current.token_version !== actor.generation
      )
        throw new AssistantSourceRefused();
      if (
        !["parent", "teen", "child"].includes(current.role) ||
        (kind !== "chore_delete" && current.role !== "parent")
      )
        return {
          status: 403,
          body: { error: "Only parents can perform this action" },
        };
      const family = await db.family.findUnique({
        where: { id: actor.familyId },
        select: { features: true },
      });
      if (!family)
        return { status: 404, body: { error: "Household not found" } };
      if (
        !isFeatureEnabled(
          normalizeFeatures(family.features),
          kind === "event_delete"
            ? "calendar"
            : kind === "chore_delete"
              ? "chores"
              : "lists",
        )
      )
        return {
          status: 403,
          body: { error: "This feature is turned off for your family" },
        };
      const snapshot = await snapshotFor(db, actor.familyId, kind, eventId);
      if (!snapshot) throw new AssistantSourceRefused();
      if (kind === "chore_delete") {
        const denied = await readD1ChoreDeleteEligibility(db, actor, eventId);
        if (denied) return denied;
      }
      if (kind === "event_delete" && snapshot.row.source_subscription_id)
        return {
          status: 409,
          body: { error: EVENT_READ_ONLY_MESSAGE, code: EVENT_READ_ONLY_CODE },
        };
      return { snapshot };
    },
    store as unknown as NativeD1,
  );
  const session = store.withSession("first-primary");
  try {
    await session.batch([
      ...source.checks(session),
      ...capture.checks(session),
    ]);
  } catch {
    throw new AssistantSourceRefused();
  }
  if ("status" in capture.value) return capture.value;
  const snapshot = capture.value.snapshot;
  const target = assistantDeletePreviewSchema.parse({
    id: eventId,
    title: kind === "list_delete" ? snapshot.row.name : snapshot.row.title,
    ...(typeof snapshot.row[
      kind === "event_delete" ? "start_time" : "due_date"
    ] === "string"
      ? {
          detail:
            snapshot.row[kind === "event_delete" ? "start_time" : "due_date"],
        }
      : {}),
    proof: issueDeleteTargetProof(actor, kind, eventId, snapshot),
  });
  return { status: 200, body: { target } };
}
