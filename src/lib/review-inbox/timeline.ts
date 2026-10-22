/** Current-parent timeline over existing canonical Activity/AuditLog records.
 * No historical title/description/summary is trusted as current visibility. */
import type { PrismaClient } from "@prisma/client";
import { z } from "zod";
import { lockUser, lockHousehold } from "@/lib/household-lock";
import { FEATURES, normalizeFeatures, isFeatureEnabled } from "@/lib/features";
import { isProfileChoreEnabled } from "@/lib/profile-chore-gates";
import { AUDIT_ACTIONS } from "@/lib/household-audit-contract";
import {
  COORDINATION_ACTIONS,
  timelineAction,
  timelinePage,
  timelineQuery,
  timelineTarget,
  type TimelinePage,
  type TimelineTarget,
} from "./timeline-contract";
const cursorSchema = z
  .object({
    at: z.string().datetime(),
    id: z.string().regex(/^[A-Za-z0-9_-]{1,128}$/),
    stream: z.enum(["activity", "audit"]),
    source: timelineQuery.shape.source,
  })
  .strict();
type Cursor = z.infer<typeof cursorSchema>;
type Actor = { userId: string; familyId: string; tokenVersion: number };
export class TimelineAccessError extends Error {
  constructor(readonly status: 401 | 403) {
    super("Timeline unavailable");
  }
}
export function decodeTimelineCursor(
  raw: string | undefined,
  source: string,
): Cursor | null {
  if (!raw) return null;
  try {
    if (!/^[A-Za-z0-9_-]+$/.test(raw) || raw.length > 400) throw new Error();
    const result = cursorSchema.parse(
      JSON.parse(Buffer.from(raw, "base64url").toString("utf8")),
    );
    if (
      result.source !== source ||
      new Date(result.at).toISOString() !== result.at
    )
      throw new Error();
    return result;
  } catch {
    throw new Error("INVALID_TIMELINE_CURSOR");
  }
}
function before(cursor: Cursor | null, stream: Cursor["stream"]) {
  if (!cursor) return {};
  const at = new Date(cursor.at);
  if (stream !== cursor.stream)
    return { created_at: stream < cursor.stream ? { lte: at } : { lt: at } };
  return {
    OR: [{ created_at: { lt: at } }, { created_at: at, id: { lt: cursor.id } }],
  };
}
type Candidate = {
  id: string;
  stream: Cursor["stream"];
  action: string;
  at: Date;
  actor: { name: string; family_id: string | null } | null;
  tablet: boolean;
  metadata: string | null;
  featureKey: string | null;
};
function reference(
  row: Candidate,
): Exclude<TimelineTarget, { kind: "settings" }> | null {
  if (!row.metadata || row.metadata.length > 4096) return null;
  try {
    const data = JSON.parse(row.metadata);
    const raw =
      data?.timeline === 1
        ? data.target
        : row.action === "event_created"
          ? { kind: "event", id: data?.eventId }
          : ["chore_completed", "chore_verified", "chore_rejected"].includes(
                row.action,
              )
            ? { kind: "chore", id: data?.choreId }
            : null;
    const parsed = timelineTarget.safeParse(raw);
    // Never let activity metadata impersonate settings or another domain.
    const allowed =
      row.action === "recipe_created"
        ? ["recipe"]
        : row.action === "responsibility_changed"
          ? ["chore", "pickup", "handoff"]
          : [
                "event_created",
                "preparation_changed",
                "schedule_changed",
              ].includes(row.action)
            ? ["event"]
            : ["chore"];
    return parsed.success &&
      parsed.data.kind !== "settings" &&
      allowed.includes(parsed.data.kind)
      ? parsed.data
      : null;
  } catch {
    return null;
  }
}
function origin(row: Candidate): TimelinePage["entries"][number]["origin"] {
  if (row.stream === "audit") return "settings";
  return row.action === "preparation_changed"
    ? "preparation"
    : row.action === "schedule_changed"
      ? "schedule"
      : row.action === "responsibility_changed"
        ? "responsibility"
        : row.action === "recipe_created"
          ? "recipes"
          : "app";
}
export async function readChangeTimeline(
  db: Pick<PrismaClient, "$transaction">,
  actor: Actor,
  raw: z.input<typeof timelineQuery>,
  now = new Date(),
): Promise<TimelinePage> {
  const query = timelineQuery.parse(raw),
    cursor = decodeTimelineCursor(query.cursor, query.source);
  return db.$transaction(async (tx) => {
    await lockUser(tx, actor.userId);
    await lockHousehold(tx, actor.familyId);
    const user = await tx.user.findUnique({
      where: { id: actor.userId },
      select: { family_id: true, role: true, token_version: true },
    });
    if (!user || user.token_version !== actor.tokenVersion)
      throw new TimelineAccessError(401);
    if (user.family_id !== actor.familyId || user.role !== "parent")
      throw new TimelineAccessError(403);
    const family = await tx.family.findUnique({
      where: { id: actor.familyId },
      select: { features: true },
    });
    if (!family) throw new TimelineAccessError(403);
    const features = normalizeFeatures(family.features),
      cutoff = new Date(now.getTime() - 365 * 86400000);
    const activity =
      query.source === "settings"
        ? []
        : await tx.activity.findMany({
            where: {
              family_id: actor.familyId,
              subject_member_erased: false,
              type: { in: [...COORDINATION_ACTIONS] },
              AND: [
                { created_at: { gte: cutoff } },
                before(cursor, "activity"),
              ],
            },
            select: {
              id: true,
              type: true,
              metadata: true,
              created_at: true,
              user: { select: { name: true, family_id: true } },
            },
            orderBy: [{ created_at: "desc" }, { id: "desc" }],
            take: 21,
          });
    const audit =
      query.source === "coordination"
        ? []
        : await tx.auditLog.findMany({
            where: {
              family_id: actor.familyId,
              action: { in: [...AUDIT_ACTIONS] },
              AND: [{ created_at: { gte: cutoff } }, before(cursor, "audit")],
            },
            select: {
              id: true,
              action: true,
              actor_kind: true,
              target_type: true,
              target_id: true,
              created_at: true,
              actor: { select: { name: true, family_id: true } },
            },
            orderBy: [{ created_at: "desc" }, { id: "desc" }],
            take: 21,
          });
    const candidates: Candidate[] = [
      ...activity.map((row) => ({
        id: row.id,
        stream: "activity" as const,
        action: row.type,
        at: row.created_at,
        actor: row.user,
        tablet: false,
        metadata: row.metadata,
        featureKey: null,
      })),
      ...audit.map((row) => ({
        id: row.id,
        stream: "audit" as const,
        action: row.action,
        at: row.created_at,
        actor: row.actor,
        tablet: row.actor_kind === "device",
        metadata: null,
        featureKey:
          row.target_type === "feature" &&
          FEATURES.some((feature) => feature.key === row.target_id)
            ? row.target_id
            : null,
      })),
    ].sort(
      (a, b) =>
        b.at.getTime() - a.at.getTime() ||
        (a.stream === b.stream ? 0 : a.stream < b.stream ? 1 : -1),
    );
    const page = candidates.slice(0, 20),
      references = page.map(reference);
    const ids = (kind: string) => [
      ...new Set(
        references
          .filter((target) => target?.kind === kind)
          .map((target) => target!.id),
      ),
    ];
    const current = new Map<
      string,
      { title: string | null; target: TimelineTarget }
    >();
    if (isFeatureEnabled(features, "calendar") && ids("event").length) {
      for (const row of await tx.event.findMany({
        where: { family_id: actor.familyId, id: { in: ids("event") } },
        select: { id: true, title: true },
      }))
        current.set(`event:${row.id}`, {
          title: row.title,
          target: { kind: "event", id: row.id },
        });
    }
    if (isFeatureEnabled(features, "chores") && ids("chore").length) {
      for (const row of await tx.chore.findMany({
        where: {
          family_id: actor.familyId,
          id: { in: ids("chore") },
          member_subject_erased: false,
          ...(!isProfileChoreEnabled() ? { assigned_to: { not: null } } : {}),
        },
        select: { id: true, title: true },
      }))
        current.set(`chore:${row.id}`, {
          title: row.title,
          target: { kind: "chore", id: row.id },
        });
    }
    if (isFeatureEnabled(features, "meals") && ids("recipe").length) {
      for (const row of await tx.recipe.findMany({
        where: { family_id: actor.familyId, id: { in: ids("recipe") } },
        select: { id: true, title: true },
      }))
        current.set(`recipe:${row.id}`, {
          title: row.title,
          target: { kind: "recipe", id: row.id },
        });
    }
    if (isFeatureEnabled(features, "handoff") && ids("handoff").length) {
      for (const row of await tx.handoff.findMany({
        where: { family_id: actor.familyId, id: { in: ids("handoff") } },
        select: { id: true },
      }))
        current.set(`handoff:${row.id}`, {
          title: null,
          target: { kind: "handoff", id: row.id },
        });
    }
    if (isFeatureEnabled(features, "pickups") && ids("pickup").length) {
      for (const row of await tx.pickup.findMany({
        where: { family_id: actor.familyId, id: { in: ids("pickup") } },
        select: { id: true, title: true },
      }))
        current.set(`pickup:${row.id}`, {
          title: row.title,
          target: { kind: "pickup", id: row.id },
        });
    }
    const entries: TimelinePage["entries"] = [];
    for (const [index, row] of page.entries()) {
      const action = timelineAction.parse(row.action),
        target = references[index];
      const feature =
        row.action === "recipe_created"
          ? "meals"
          : [
                "event_created",
                "preparation_changed",
                "schedule_changed",
              ].includes(row.action)
            ? "calendar"
            : target?.kind === "handoff"
              ? "handoff"
              : target?.kind === "pickup"
                ? "pickups"
                : "chores";
      if (row.stream === "activity" && !isFeatureEnabled(features, feature))
        continue;
      const visible = target
        ? current.get(`${target.kind}:${target.id}`)
        : null;
      let actorKind: "person" | "tablet" | "unknown" = row.tablet
        ? "tablet"
        : "person";
      if (row.action === "chore_completed") {
        actorKind = "unknown";
        try {
          const data =
            row.metadata && row.metadata.length <= 4096
              ? JSON.parse(row.metadata)
              : null;
          if (
            data?.timeline === 1 &&
            ["person", "device"].includes(data.actorKind)
          )
            actorKind = data.actorKind === "device" ? "tablet" : "person";
        } catch {
          /* Older activity can name a subject rather than an actor. */
        }
      }
      entries.push({
        id: `${row.stream}:${row.id}`,
        action,
        at: row.at.toISOString(),
        actor: {
          name:
            actorKind === "person" && row.actor?.family_id === actor.familyId
              ? row.actor.name.slice(0, 80)
              : null,
          kind: actorKind,
        },
        origin: origin(row),
        featureKey: row.featureKey,
        target:
          row.stream === "audit"
            ? { kind: "settings" }
            : (visible?.target ?? null),
        title: visible?.title?.slice(0, 200) ?? null,
        current:
          row.stream === "audit" || visible
            ? "available"
            : target
              ? "unavailable"
              : "unknown",
      });
    }
    const last = page[page.length - 1];
    return timelinePage.parse({
      owner: {
        userId: actor.userId,
        familyId: actor.familyId,
        generation: actor.tokenVersion,
      },
      source: query.source,
      entries,
      nextCursor:
        candidates.length > 20 && last
          ? Buffer.from(
              JSON.stringify({
                at: last.at.toISOString(),
                id: last.id,
                stream: last.stream,
                source: query.source,
              }),
            ).toString("base64url")
          : null,
    });
  });
}
