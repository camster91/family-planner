/** Native shared-device authority. Device tokens never become person sessions.
 * Every classification is witnessed with its touches/rotation/revocation. */
import { randomUUID } from "node:crypto";
import { hashToken } from "@/lib/tokens";
import { writeD1DeviceAudit } from "@/lib/device-audit";
import {
  DEVICE_ROW_SELECT,
  ACCESS_TTL_MS,
  REFRESH_TTL_MS,
  REFRESH_REUSE_GRACE_MS,
  ROTATED_SESSION_RETENTION_MS,
  LAST_SEEN_THROTTLE_MS,
  ELEVATION_MAX_MS,
  CLEARED_ELEVATION,
  generateDeviceToken,
  elevationHeaderMatches,
  elevationEndReason,
  type DeviceAuthResult,
  type DeviceCookieValues,
  type IssuedDeviceTokens,
  type DeviceActor,
  type DeviceRow,
  type RefreshResult,
  type ElevationResult,
} from "@/lib/device-session";
import { log } from "@/lib/logger";
import { getD1Database, type D1Store, type D1Statement } from "./database";
import { captureD1Reads } from "./read-witness";
import type { D1ReadClient, NativeD1 } from "./read-client";
import { isD1WriteConflict, d1WriteCheck } from "./write-check";
const invalid = {
  ok: false,
  status: 401,
  code: "DEVICE_SESSION_INVALID",
} as const;
const expired = {
  ok: false,
  status: 401,
  code: "DEVICE_ACCESS_EXPIRED",
} as const;
const revoked = { ok: false, status: 401, code: "DEVICE_REVOKED" } as const;
const unavailable = {
  ok: false,
  status: 503,
  code: "SERVICE_UNAVAILABLE",
} as const;
const clearedSql = Object.keys(CLEARED_ELEVATION)
  .map((key) => `"${key}"=NULL`)
  .join(",");
function validClock(now: Date) {
  if (!Number.isFinite(now.getTime())) throw new Error("Invalid device clock");
}
async function device(db: D1ReadClient, id: string) {
  return db.householdDevice.findUnique({
    where: { id },
    select: DEVICE_ROW_SELECT,
  });
}
export async function readD1DeviceActor(
  db: D1ReadClient,
  actor: DeviceActor,
  now: Date,
) {
  const session = await db.deviceSession.findFirst({
    where: {
      id: actor.sessionId,
      device_id: actor.deviceId,
      family_id: actor.familyId,
    },
    select: { access_expires_at: true, rotated_at: true, revoked_at: true },
  });
  const row = await device(db, actor.deviceId);
  if (!row || row.family_id !== actor.familyId || !session) return invalid;
  if (row.revoked_at) return revoked;
  if (session.revoked_at) return invalid;
  if (session.rotated_at || session.access_expires_at <= now) return expired;
  return {
    ok: true,
    actor: { ...actor, label: row.label },
    device: row,
  } as const;
}
export function prepareD1DeviceSession(
  session: Pick<D1Store, "prepare">,
  deviceId: string,
  familyId: string,
  now: Date,
): { tokens: IssuedDeviceTokens; statements: D1Statement[] } {
  validClock(now);
  const tokens = {
    sessionId: randomUUID(),
    accessToken: generateDeviceToken("a"),
    refreshToken: generateDeviceToken("r"),
    accessExpiresAt: new Date(now.getTime() + ACCESS_TTL_MS),
    refreshExpiresAt: new Date(now.getTime() + REFRESH_TTL_MS),
  };
  return {
    tokens,
    statements: [
      session
        .prepare(
          `INSERT INTO DeviceSession(id,device_id,family_id,access_token_hash,access_expires_at,refresh_token_hash,refresh_expires_at,created_at)
 SELECT ?1,id,family_id,?4,?5,?6,?7,?8 FROM HouseholdDevice WHERE id=?2 AND family_id=?3 AND revoked_at IS NULL`,
        )
        .bind(
          tokens.sessionId,
          deviceId,
          familyId,
          hashToken(tokens.accessToken),
          tokens.accessExpiresAt.getTime(),
          hashToken(tokens.refreshToken),
          tokens.refreshExpiresAt.getTime(),
          now.getTime(),
        ),
      d1WriteCheck(session, "changes()=1"),
    ],
  };
}
export function prepareD1DeviceRevocation(
  session: Pick<D1Store, "prepare">,
  deviceId: string,
  familyId: string,
  by: string | null,
  reason: string,
  now: Date,
) {
  return [
    session
      .prepare(
        `UPDATE HouseholdDevice SET revoked_at=?3,revoked_by=?4,revoke_reason=?5,${clearedSql},updated_at=?3 WHERE id=?1 AND family_id=?2 AND revoked_at IS NULL`,
      )
      .bind(deviceId, familyId, now.getTime(), by, reason),
    d1WriteCheck(session, "changes()=1"),
    session
      .prepare(
        "UPDATE DeviceSession SET revoked_at=?3 WHERE device_id=?1 AND family_id=?2 AND revoked_at IS NULL",
      )
      .bind(deviceId, familyId, now.getTime()),
  ];
}
export async function resolveD1DeviceAccess(
  cookies: DeviceCookieValues,
  now: Date,
  database?: D1Store,
): Promise<DeviceAuthResult> {
  if (!cookies.access) return cookies.refresh ? expired : invalid;
  try {
    validClock(now);
    const store = database ?? (await getD1Database()),
      session = store.withSession("first-primary");
    for (let attempt = 0; attempt < 12; attempt++) {
      const captured = await captureD1Reads(
        async (db) => {
          const row = await db.deviceSession.findUnique({
            where: { access_token_hash: hashToken(cookies.access!) },
            select: {
              id: true,
              device_id: true,
              family_id: true,
              access_expires_at: true,
              revoked_at: true,
              rotated_at: true,
              first_used_at: true,
            },
          });
          if (!row) return { reply: invalid };
          const target = await device(db, row.device_id);
          if (!target) return { reply: invalid };
          if (target.revoked_at) return { reply: revoked };
          if (row.revoked_at || row.family_id !== target.family_id)
            return { reply: invalid };
          if (row.rotated_at || row.access_expires_at <= now)
            return { reply: expired };
          return {
            row,
            target,
            reply: {
              ok: true,
              device: target,
              actor: {
                kind: "device",
                deviceId: target.id,
                familyId: target.family_id,
                sessionId: row.id,
                label: target.label,
              },
            } as DeviceAuthResult,
          };
        },
        store as unknown as NativeD1,
      );
      try {
        const effects = [];
        if (captured.value.row && captured.value.target) {
          const { row, target } = captured.value;
          if (!row.first_used_at)
            effects.push(
              session
                .prepare(
                  "UPDATE DeviceSession SET first_used_at=?2 WHERE id=?1 AND first_used_at IS NULL",
                )
                .bind(row.id, now.getTime()),
            );
          if (
            now.getTime() - (target.last_seen_at?.getTime() ?? 0) >=
            LAST_SEEN_THROTTLE_MS
          )
            effects.push(
              session
                .prepare(
                  "UPDATE HouseholdDevice SET last_seen_at=?2,updated_at=?2 WHERE id=?1 AND revoked_at IS NULL",
                )
                .bind(target.id, now.getTime()),
            );
        }
        await session.batch([...captured.checks(session), ...effects]);
        return captured.value.reply;
      } catch (cause) {
        if (!isD1WriteConflict(cause)) throw cause;
      }
    }
    return unavailable;
  } catch (error) {
    log.error("device.resolve_failed", error, {});
    return unavailable;
  }
}
export async function findD1RefreshDeviceId(
  token: string,
  database?: D1Store,
): Promise<string | null> {
  return (
    (
      await (database ?? (await getD1Database()))
        .withSession("first-primary")
        .prepare(
          "SELECT device_id FROM DeviceSession WHERE refresh_token_hash=?1",
        )
        .bind(hashToken(token))
        .first<{ device_id: string }>()
    )?.device_id ?? null
  );
}
export async function refreshD1DeviceSession(
  token: string,
  now: Date,
  database?: D1Store,
): Promise<RefreshResult> {
  validClock(now);
  const store = database ?? (await getD1Database()),
    session = store.withSession("first-primary");
  for (let attempt = 0; attempt < 16; attempt++) {
    const captured = await captureD1Reads(
      async (db) => {
        const row = await db.deviceSession.findUnique({
          where: { refresh_token_hash: hashToken(token) },
        });
        if (!row)
          return {
            reply: {
              ok: false,
              code: "DEVICE_SESSION_INVALID",
            } as RefreshResult,
          };
        const target = await device(db, row.device_id);
        if (!target)
          return {
            reply: {
              ok: false,
              code: "DEVICE_SESSION_INVALID",
            } as RefreshResult,
          };
        if (target.revoked_at)
          return {
            reply: {
              ok: false,
              code: "DEVICE_REVOKED",
              deviceId: target.id,
            } as RefreshResult,
          };
        if (
          row.revoked_at ||
          row.family_id !== target.family_id ||
          row.refresh_expires_at <= now
        )
          return {
            reply: {
              ok: false,
              code: "DEVICE_SESSION_INVALID",
              deviceId: target.id,
            } as RefreshResult,
          };
        if (!row.rotated_at) return { row, target, mode: "rotated" as const };
        const successor = row.replaced_by_id
          ? await db.deviceSession.findUnique({
              where: { id: row.replaced_by_id },
              select: {
                id: true,
                device_id: true,
                family_id: true,
                first_used_at: true,
                revoked_at: true,
              },
            })
          : null;
        if (
          now.getTime() - row.rotated_at.getTime() < REFRESH_REUSE_GRACE_MS &&
          successor &&
          successor.device_id === target.id &&
          successor.family_id === target.family_id &&
          !successor.first_used_at &&
          !successor.revoked_at
        )
          return { row, target, successor, mode: "grace_reissued" as const };
        return { row, target, mode: "reuse" as const };
      },
      store as unknown as NativeD1,
    );
    try {
      if (captured.value.reply) {
        await session.batch(captured.checks(session));
        return captured.value.reply;
      }
      const { row, target, mode } = captured.value,
        checks = captured.checks(session),
        effects = [];
      if (mode === "reuse") {
        await session.batch([
          ...checks,
          ...prepareD1DeviceRevocation(
            session,
            target.id,
            target.family_id,
            null,
            "token_reuse",
            now,
          ),
        ]);
        await writeD1DeviceAudit(session, {
          familyId: target.family_id,
          deviceId: target.id,
          type: "device.revoked",
          metadata: { reason: "token_reuse" },
          at: now,
        });
        await writeD1DeviceAudit(session, {
          familyId: target.family_id,
          deviceId: target.id,
          type: "device.token_reuse_detected",
          metadata: { sessionId: row.id },
          at: now,
        });
        log.warn("device.token_reuse_detected");
        return {
          ok: false,
          code: "DEVICE_REVOKED",
          deviceId: target.id,
          reuseDetected: true,
        };
      }
      const issued = prepareD1DeviceSession(
        session,
        target.id,
        target.family_id,
        now,
      );
      if (mode === "rotated")
        effects.push(
          session
            .prepare(
              "UPDATE DeviceSession SET rotated_at=?2,first_used_at=COALESCE(first_used_at,?2) WHERE id=?1 AND rotated_at IS NULL AND revoked_at IS NULL",
            )
            .bind(row.id, now.getTime()),
        );
      else
        effects.push(
          session
            .prepare(
              "UPDATE DeviceSession SET revoked_at=?2 WHERE id=?1 AND first_used_at IS NULL AND revoked_at IS NULL",
            )
            .bind(captured.value.successor!.id, now.getTime()),
        );
      effects.push(
        d1WriteCheck(session, "changes()=1"),
        ...issued.statements,
        session
          .prepare("UPDATE DeviceSession SET replaced_by_id=?2 WHERE id=?1")
          .bind(row.id, issued.tokens.sessionId),
      );
      await session.batch([...checks, ...effects]);
      // Preserve opportunistic housekeeping as best effort; never fail a rotation
      // after the new credential has committed merely because retention fails.
      try {
        await session.batch([
          session
            .prepare(
              "UPDATE HouseholdDevice SET last_seen_at=?2,updated_at=?2 WHERE id=?1 AND revoked_at IS NULL",
            )
            .bind(target.id, now.getTime()),
          session
            .prepare(
              "DELETE FROM DeviceSession WHERE device_id=?1 AND rotated_at<?2",
            )
            .bind(target.id, now.getTime() - ROTATED_SESSION_RETENTION_MS),
        ]);
      } catch (error) {
        log.warn("device.refresh_housekeeping_failed", {
          name: error instanceof Error ? error.name : "Unknown",
        });
      }
      return {
        ok: true,
        tokens: issued.tokens,
        deviceId: target.id,
        familyId: target.family_id,
        path: mode,
      };
    } catch (cause) {
      if (!isD1WriteConflict(cause)) throw cause;
    }
  }
  return { ok: false, code: "DEVICE_SESSION_INVALID" };
}
export async function clearD1Elevation(
  deviceId: string,
  expectedHash: string,
  database?: D1Store,
): Promise<boolean> {
  const session = (database ?? (await getD1Database())).withSession(
    "first-primary",
  );
  const result = await session.batch<{ n: number }>([
    session
      .prepare(
        `UPDATE HouseholdDevice SET ${clearedSql},updated_at=?3 WHERE id=?1 AND elevation_token_hash=?2`,
      )
      .bind(deviceId, expectedHash, Date.now()),
    session.prepare("SELECT changes() AS n"),
  ]);
  return result[1].results[0]?.n === 1;
}
export async function resolveD1Elevation(
  resolved: { actor: DeviceActor; device: DeviceRow },
  header: string | null | undefined,
  now: Date,
  database?: D1Store,
): Promise<ElevationResult> {
  validClock(now);
  const store = database ?? (await getD1Database()),
    session = store.withSession("first-primary");
  for (let attempt = 0; attempt < 12; attempt++) {
    const captured = await captureD1Reads(
      async (db) => {
        const access = await readD1DeviceActor(db, resolved.actor, now);
        if (!access.ok || !elevationHeaderMatches(access.device, header))
          return {
            reply: {
              ok: false,
              status: 403,
              code: "ELEVATION_REQUIRED",
            } as ElevationResult,
          };
        const target = access.device,
          timedOut = elevationEndReason(target, now);
        if (timedOut) return { target, reason: timedOut };
        const parent = target.elevated_user_id
          ? await db.user.findUnique({
              where: { id: target.elevated_user_id },
              select: {
                id: true,
                name: true,
                family_id: true,
                role: true,
                token_version: true,
              },
            })
          : null;
        if (
          !parent ||
          parent.role !== "parent" ||
          parent.family_id !== target.family_id ||
          parent.token_version !== target.elevated_token_version
        )
          return { target, reason: "credential_changed" as const };
        return {
          target,
          reply: {
            ok: true,
            actor: {
              ...access.actor,
              kind: "device_elevated_parent",
              parentId: parent.id,
              parentName: parent.name,
            },
          } as ElevationResult,
        };
      },
      store as unknown as NativeD1,
    );
    try {
      const { target } = captured.value,
        effects = [];
      if (target)
        effects.push(
          session
            .prepare(
              captured.value.reason
                ? `UPDATE HouseholdDevice SET ${clearedSql},updated_at=?3 WHERE id=?1 AND elevation_token_hash=?2`
                : "UPDATE HouseholdDevice SET elevation_last_used_at=?3,updated_at=?3 WHERE id=?1 AND elevation_token_hash=?2",
            )
            .bind(target.id, target.elevation_token_hash, now.getTime()),
        );
      await session.batch([...captured.checks(session), ...effects]);
      if (captured.value.reason && target) {
        await writeD1DeviceAudit(session, {
          familyId: target.family_id,
          deviceId: target.id,
          actorUserId: target.elevated_user_id,
          type: "device.elevation_ended",
          metadata: { reason: captured.value.reason },
          at: now,
        });
        return { ok: false, status: 403, code: "ELEVATION_EXPIRED" };
      }
      return captured.value.reply!;
    } catch (cause) {
      if (!isD1WriteConflict(cause)) throw cause;
    }
  }
  return { ok: false, status: 403, code: "ELEVATION_REQUIRED" };
}
export async function startD1Elevation(
  args: {
    deviceId: string;
    parentId: string;
    tokenVersion: number;
    method: "pin" | "password";
    now: Date;
  },
  database?: D1Store,
): Promise<{ token: string; expiresAt: Date } | null> {
  validClock(args.now);
  const store = database ?? (await getD1Database()),
    session = store.withSession("first-primary");
  for (let attempt = 0; attempt < 12; attempt++) {
    const captured = await captureD1Reads(
      async (db) => {
        const target = await device(db, args.deviceId),
          parent = await db.user.findUnique({
            where: { id: args.parentId },
            select: {
              id: true,
              family_id: true,
              role: true,
              token_version: true,
            },
          });
        return {
          target,
          allowed:
            !!target &&
            !target.revoked_at &&
            !!parent &&
            parent.family_id === target.family_id &&
            parent.role === "parent" &&
            parent.token_version === args.tokenVersion,
        };
      },
      store as unknown as NativeD1,
    );
    try {
      const token = generateDeviceToken("e"),
        expiresAt = new Date(args.now.getTime() + ELEVATION_MAX_MS),
        effects = captured.value.allowed
          ? [
              session
                .prepare(
                  "UPDATE HouseholdDevice SET elevation_token_hash=?2,elevated_user_id=?3,elevated_token_version=?4,elevation_method=?5,elevation_started_at=?6,elevation_last_used_at=?6,elevation_expires_at=?7,updated_at=?6 WHERE id=?1 AND revoked_at IS NULL",
                )
                .bind(
                  args.deviceId,
                  hashToken(token),
                  args.parentId,
                  args.tokenVersion,
                  args.method,
                  args.now.getTime(),
                  expiresAt.getTime(),
                ),
              d1WriteCheck(session, "changes()=1"),
            ]
          : [];
      await session.batch([...captured.checks(session), ...effects]);
      return captured.value.allowed ? { token, expiresAt } : null;
    } catch (cause) {
      if (!isD1WriteConflict(cause)) throw cause;
    }
  }
  return null;
}
