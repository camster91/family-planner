import { DEVICE_LIST_SELECT, serializeDevice } from "@/lib/device-admin";
import {
  elevationHeaderMatches,
  elevationEndReason,
  type ElevatedParentActor,
} from "@/lib/device-session";
import { auditSummary, prepareD1AuditLog } from "@/lib/household-audit";
import {
  writeD1DeviceAudit,
  type RevokeReason,
  type DeviceAuditInput,
} from "@/lib/device-audit";
import type { DeviceErrorCode } from "@/lib/device-http";
import { getD1Database, type D1Store, type D1Statement } from "./database";
import { captureD1Reads } from "./read-witness";
import type { NativeD1 } from "./read-client";
import { isD1WriteConflict } from "./write-check";
import {
  requireD1DeviceManager,
  type DeviceManagerActor,
} from "./device-manager";
import {
  readD1DeviceActor,
  prepareD1DeviceRevocation,
} from "./device-sessions";
export type DeviceManagementOwner =
  | { kind: "person"; actor: DeviceManagerActor }
  | { kind: "device"; actor: ElevatedParentActor; header: string | null };
export type DeviceManagementCommand =
  | { kind: "rename"; id: string; label: string }
  | { kind: "revoke"; id: string; reason: RevokeReason };
const failure = (status: number, code: DeviceErrorCode, message?: string) => ({
  status,
  code,
  message,
  body: undefined,
});
export async function manageD1Device(
  owner: DeviceManagementOwner,
  command: DeviceManagementCommand,
  now: Date,
  database?: D1Store,
) {
  const store = database ?? (await getD1Database()),
    session = store.withSession("first-primary");
  if (!Number.isFinite(now.getTime()))
    throw new Error("Invalid device management clock");
  for (let attempt = 0; attempt < 16; attempt++) {
    const captured = await captureD1Reads(
      async (db) => {
        const actor = owner.actor;
        let parentId: string;
        if (owner.kind === "person") {
          await requireD1DeviceManager(db, owner.actor);
          parentId = owner.actor.userId;
        } else {
          const access = await readD1DeviceActor(
            db,
            { ...owner.actor, kind: "device" },
            now,
          );
          if (!access.ok)
            return { denied: failure(access.status, access.code) };
          if (command.id !== owner.actor.deviceId)
            return { denied: failure(404, "NOT_FOUND") };
          if (!elevationHeaderMatches(access.device, owner.header))
            return { denied: failure(403, "ELEVATION_REQUIRED") };
          const parent = access.device.elevated_user_id
            ? await db.user.findUnique({
                where: { id: access.device.elevated_user_id },
                select: {
                  id: true,
                  family_id: true,
                  role: true,
                  token_version: true,
                },
              })
            : null;
          if (
            elevationEndReason(access.device, now) ||
            !parent ||
            parent.id !== owner.actor.parentId ||
            parent.family_id !== actor.familyId ||
            parent.role !== "parent" ||
            parent.token_version !== access.device.elevated_token_version
          )
            return { denied: failure(403, "ELEVATION_EXPIRED") };
          parentId = parent.id;
        }
        const row = await db.householdDevice.findFirst({
          where: { id: command.id, family_id: actor.familyId },
          select: DEVICE_LIST_SELECT,
        });
        if (!row) return { denied: failure(404, "NOT_FOUND") };
        if (command.kind === "rename" && row.revoked_at)
          return {
            denied: failure(
              400,
              "VALIDATION_ERROR",
              "A removed tablet cannot be renamed.",
            ),
          };
        const live =
          command.kind === "rename"
            ? await db.deviceSession.findFirst({
                where: {
                  device_id: row.id,
                  family_id: actor.familyId,
                  revoked_at: null,
                  rotated_at: null,
                  refresh_expires_at: { gt: now },
                },
                select: { id: true },
              })
            : null;
        return { row, parentId, live };
      },
      store as unknown as NativeD1,
    );
    try {
      if (captured.value.denied) {
        await session.batch(captured.checks(session));
        return captured.value.denied;
      }
      const { row, parentId, live } = captured.value,
        base = {
          familyId: owner.actor.familyId,
          actorUserId: parentId,
          actorKind: owner.kind,
          targetType: "device" as const,
          targetId: row.id,
        },
        auditBase = {
          familyId: owner.actor.familyId,
          deviceId: row.id,
          actorUserId: parentId,
          at: now,
        },
        effects: D1Statement[] = [],
        security: DeviceAuditInput[] = [];
      if (command.kind === "rename") {
        effects.push(
          session
            .prepare(
              "UPDATE HouseholdDevice SET label=?3,updated_at=?4 WHERE id=?1 AND family_id=?2 AND revoked_at IS NULL",
            )
            .bind(row.id, owner.actor.familyId, command.label, now.getTime()),
        );
        if (row.label !== command.label)
          effects.push(
            ...prepareD1AuditLog(
              session,
              {
                ...base,
                action: "device.renamed",
                summary: auditSummary.deviceRenamed(row.label, command.label),
              },
              now,
            ),
          );
        security.push(
          owner.kind === "person"
            ? { ...auditBase, type: "device.renamed", metadata: {} }
            : {
                ...auditBase,
                type: "device.elevated_action",
                metadata: {
                  action: "rename_device",
                  targetType: "device",
                  targetId: row.id,
                },
              },
        );
      } else if (!row.revoked_at) {
        effects.push(
          ...prepareD1DeviceRevocation(
            session,
            row.id,
            owner.actor.familyId,
            parentId,
            command.reason,
            now,
          ),
          ...prepareD1AuditLog(
            session,
            {
              ...base,
              action: "device.removed",
              summary: auditSummary.deviceRemoved(row.label, command.reason),
            },
            now,
          ),
        );
        if (owner.kind === "device")
          security.push({
            ...auditBase,
            type: "device.elevated_action",
            metadata: {
              action: "revoke_device",
              targetType: "device",
              targetId: row.id,
            },
          });
        security.push({
          ...auditBase,
          type: "device.revoked",
          metadata: { reason: command.reason },
        });
      }
      await session.batch([...captured.checks(session), ...effects]);
      for (const audit of security) await writeD1DeviceAudit(session, audit);
      const after =
        command.kind === "rename"
          ? { ...row, label: command.label }
          : row.revoked_at
            ? row
            : { ...row, revoked_at: now, revoke_reason: command.reason };
      return {
        status: 200,
        body: { device: serializeDevice(after, !!live) },
        code: undefined,
        message: undefined,
      };
    } catch (cause) {
      if (!isD1WriteConflict(cause)) throw cause;
    }
  }
  return failure(409, "SERVICE_UNAVAILABLE");
}
export async function readD1DeviceEvents(
  actor: DeviceManagerActor,
  id: string,
  rawCursor: string | null,
  database?: D1Store,
) {
  const store = database ?? (await getD1Database()),
    session = store.withSession("first-primary");
  for (let attempt = 0; attempt < 12; attempt++) {
    const captured = await captureD1Reads(
      async (db) => {
        await requireD1DeviceManager(db, actor);
        if (
          !(await db.householdDevice.findFirst({
            where: { id, family_id: actor.familyId },
            select: { id: true },
          }))
        )
          return failure(404, "NOT_FOUND");
        let cursor: { createdAt: Date; id: string } | null = null;
        if (rawCursor) {
          const [iso, entryId] = Buffer.from(rawCursor, "base64url")
              .toString("utf8")
              .split("|"),
            createdAt = new Date(iso ?? "");
          if (!entryId || !Number.isFinite(createdAt.getTime()))
            return failure(400, "VALIDATION_ERROR", "Invalid cursor.");
          cursor = { createdAt, id: entryId };
        }
        const rows = await db.deviceAuditEvent.findMany({
          where: {
            family_id: actor.familyId,
            device_id: id,
            ...(cursor
              ? {
                  OR: [
                    { created_at: { lt: cursor.createdAt } },
                    { created_at: cursor.createdAt, id: { lt: cursor.id } },
                  ],
                }
              : {}),
          },
          select: {
            id: true,
            type: true,
            metadata: true,
            created_at: true,
            actor_user_id: true,
          },
          orderBy: [{ created_at: "desc" }, { id: "desc" }],
          take: 51,
        });
        const page = rows.slice(0, 50),
          ids = [
            ...new Set(
              page.flatMap((row) =>
                row.actor_user_id ? [row.actor_user_id] : [],
              ),
            ),
          ],
          users = ids.length
            ? await db.user.findMany({
                where: { family_id: actor.familyId, id: { in: ids } },
                select: { id: true, name: true },
              })
            : [],
          names = new Map(users.map((row) => [row.id, row.name])),
          last = page[page.length - 1];
        return {
          status: 200,
          body: {
            events: page.map((row) => ({
              type: row.type,
              actorName: row.actor_user_id
                ? (names.get(row.actor_user_id) ?? null)
                : null,
              createdAt: row.created_at.toISOString(),
              metadata: row.metadata ?? {},
            })),
            nextCursor:
              rows.length > 50 && last
                ? Buffer.from(
                    `${last.created_at.toISOString()}|${last.id}`,
                  ).toString("base64url")
                : null,
          },
          code: undefined,
          message: undefined,
        };
      },
      store as unknown as NativeD1,
    );
    try {
      await session.batch(captured.checks(session));
      return captured.value;
    } catch (cause) {
      if (!isD1WriteConflict(cause)) throw cause;
    }
  }
  return failure(503, "SERVICE_UNAVAILABLE");
}
