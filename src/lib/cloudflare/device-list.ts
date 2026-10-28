import {
  DEVICE_LIST_SELECT,
  REMOVED_DEVICE_VISIBLE_MS,
  serializeDevice,
} from "@/lib/device-admin";
import { AUDIT_RETENTION_MS } from "@/lib/device-audit";
import { PAIRING_RETENTION_MS } from "@/lib/device-pairing";
import { log } from "@/lib/logger";
import { getD1Database, type D1Store } from "./database";
import { captureD1Reads } from "./read-witness";
import type { NativeD1 } from "./read-client";
import { isD1WriteConflict } from "./write-check";
import {
  requireD1DeviceManager,
  type DeviceManagerActor,
} from "./device-manager";
export async function readD1DeviceList(
  actor: DeviceManagerActor,
  now: Date,
  database?: D1Store,
) {
  const store = database ?? (await getD1Database()),
    session = store.withSession("first-primary");
  if (!Number.isFinite(now.getTime()))
    throw new Error("Invalid device list clock");
  const auth = `EXISTS(SELECT 1 FROM User WHERE id=?3 AND family_id=?1 AND role='parent' AND token_version=?4)`;
  // Foreground retention remains best effort and its own current-parent checks
  // guard every deletion. No scheduler or other household's retention is added.
  try {
    await session.batch([
      session
        .prepare(
          `DELETE FROM DevicePairing WHERE family_id=?1 AND expires_at<?2 AND ${auth}`,
        )
        .bind(
          actor.familyId,
          now.getTime() - PAIRING_RETENTION_MS,
          actor.userId,
          actor.generation,
        ),
      session
        .prepare(
          `DELETE FROM DeviceAuditEvent WHERE family_id=?1 AND created_at<?2 AND ${auth}`,
        )
        .bind(
          actor.familyId,
          now.getTime() - AUDIT_RETENTION_MS,
          actor.userId,
          actor.generation,
        ),
    ]);
  } catch (error) {
    log.warn("device.list_retention_failed", {
      name: error instanceof Error ? error.name : "Unknown",
    });
  }
  for (let attempt = 0; attempt < 12; attempt++) {
    const capture = await captureD1Reads(
      async (db) => {
        await requireD1DeviceManager(db, actor);
        const rows = await db.householdDevice.findMany({
          where: {
            family_id: actor.familyId,
            OR: [
              { revoked_at: null },
              {
                revoked_at: {
                  gt: new Date(now.getTime() - REMOVED_DEVICE_VISIBLE_MS),
                },
              },
            ],
          },
          select: DEVICE_LIST_SELECT,
          orderBy: [{ paired_at: "desc" }, { id: "asc" }],
        });
        const sessions = rows.length
          ? await db.deviceSession.findMany({
              where: {
                family_id: actor.familyId,
                revoked_at: null,
                rotated_at: null,
                refresh_expires_at: { gt: now },
              },
              select: { device_id: true },
            })
          : [];
        const live = new Set(sessions.map((row) => row.device_id));
        return {
          devices: rows.map((row) => serializeDevice(row, live.has(row.id))),
        };
      },
      store as unknown as NativeD1,
    );
    try {
      await session.batch(capture.checks(session));
      return capture.value;
    } catch (cause) {
      if (!isD1WriteConflict(cause)) throw cause;
    }
  }
  throw new Error("Device list changed too many times");
}
