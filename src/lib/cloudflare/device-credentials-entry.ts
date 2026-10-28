import { hashPassword, verifyPassword, DUMMY_HASH } from "@/lib/auth";
import { isAcceptablePin, isValidPinFormat } from "@/lib/elevation-pin";
import {
  loginAccountKey,
  LOGIN_ACCOUNT_FAILURE_LIMIT,
  LOGIN_FAILURE_WINDOW_MS,
} from "@/lib/login-lockout";
import {
  generateDeviceToken,
  ELEVATION_MAX_MS,
  ELEVATION_IDLE_MS,
  type DeviceActor,
} from "@/lib/device-session";
import { hashToken } from "@/lib/tokens";
import { writeD1DeviceAudit, type DeviceAuditInput } from "@/lib/device-audit";
import type { DeviceErrorCode } from "@/lib/device-http";
import { getD1Database, type D1Store, type D1Statement } from "./database";
import { captureD1Reads } from "./read-witness";
import type { NativeD1, D1ReadClient } from "./read-client";
import { isD1WriteConflict } from "./write-check";
import { readD1DeviceActor } from "./device-sessions";
import {
  requireD1DeviceManager,
  type DeviceManagerActor,
} from "./device-manager";
import { prepareD1RateLimitIncrement } from "./rate-limit";
export type DeviceCredentialResult = {
  status: number;
  code?: DeviceErrorCode;
  retryAfterSeconds?: number;
  body?: {
    elevationToken: string;
    expiresAt: string;
    idleTimeoutSeconds: number;
    member: { id: string; name: string };
  };
};
const denied = (
  status: number,
  code: DeviceErrorCode,
  retryAfterMs?: number,
): DeviceCredentialResult => ({
  status,
  code,
  ...(retryAfterMs !== undefined
    ? { retryAfterSeconds: Math.max(1, Math.ceil(retryAfterMs / 1000)) }
    : {}),
});
const MIN = 60000;
async function counter(
  db: D1ReadClient,
  key: string,
  max: number,
  windowMs: number,
  now: Date,
) {
  const row = await db.rateLimitEntry.findUnique({
      where: { key },
      select: { count: true, resetAt: true },
    }),
    used = row && row.resetAt > now ? row.count : 0;
  return {
    key,
    max,
    windowMs,
    used,
    blocked: used >= max,
    retryMs: row ? Math.max(0, row.resetAt.getTime() - now.getTime()) : 0,
  };
}
/** Bcrypt proof, failure-only limits, target membership and the device generation
 * all describe the same witnessed state at the native mutation boundary. */
export async function enterD1DeviceElevation(
  actor: DeviceActor,
  input: { userId: string; method: "pin" | "password"; secret: string },
  now: Date,
  database?: D1Store,
): Promise<DeviceCredentialResult> {
  if (!Number.isFinite(now.getTime()))
    throw new Error("Invalid elevation clock");
  const store = database ?? (await getD1Database()),
    session = store.withSession("first-primary"),
    proofs = new Map<string, boolean>();
  for (let attempt = 0; attempt < 16; attempt++) {
    const captured = await captureD1Reads(
      async (db) => {
        const access = await readD1DeviceActor(db, actor, now);
        if (!access.ok) return { reply: denied(access.status, access.code) };
        const pairKey = `device-elev-fail:${actor.deviceId}:${input.userId}`,
          deviceKey = `device-elev-fail:${actor.deviceId}`;
        const deviceCounters = await Promise.all([
          counter(db, pairKey, 5, 15 * MIN, now),
          counter(db, deviceKey, 10, 15 * MIN, now),
        ]);
        const blocked = deviceCounters.find((row) => row.blocked);
        if (blocked)
          return { reply: denied(429, "RATE_LIMITED", blocked.retryMs) };
        const user = await db.user.findFirst({
            where: {
              id: input.userId,
              family_id: actor.familyId,
              role: "parent",
            },
            select: {
              id: true,
              name: true,
              email: true,
              role: true,
              family_id: true,
              token_version: true,
              password: true,
            },
          }),
          target =
            user?.family_id === actor.familyId && user.role === "parent"
              ? user
              : null;
        const extra = [];
        let credentialHash: string | null = null,
          pin = null;
        if (target) {
          const account = await counter(
            db,
            `device-elev-fail-acct:${target.id}`,
            10,
            60 * MIN,
            now,
          );
          extra.push(account);
          if (input.method === "pin") {
            pin = await db.parentElevationPin.findUnique({
              where: { user_id: target.id },
              select: {
                user_id: true,
                family_id: true,
                pin_hash: true,
                locked_until: true,
              },
            });
            if (pin?.family_id === actor.familyId) {
              if (pin.locked_until && pin.locked_until > now)
                return {
                  reply: denied(
                    423,
                    "ELEVATION_LOCKED",
                    pin.locked_until.getTime() - now.getTime(),
                  ),
                };
              credentialHash = pin.pin_hash;
            }
            if (account.blocked)
              return {
                reply: denied(423, "ELEVATION_LOCKED", account.retryMs),
              };
          } else {
            const login = await counter(
              db,
              loginAccountKey(target.email),
              LOGIN_ACCOUNT_FAILURE_LIMIT,
              LOGIN_FAILURE_WINDOW_MS,
              now,
            );
            extra.push(login);
            if (login.blocked)
              return { reply: denied(429, "RATE_LIMITED", login.retryMs) };
            credentialHash = target.password;
          }
        }
        const observedHash = credentialHash ?? DUMMY_HASH;
        if (!proofs.has(observedHash))
          proofs.set(
            observedHash,
            await verifyPassword(input.secret, observedHash),
          );
        const valid =
          !!target &&
          !!credentialHash &&
          (input.method === "password" || isValidPinFormat(input.secret)) &&
          proofs.get(observedHash) === true;
        const stalePin = pin && pin.family_id !== actor.familyId ? pin : null;
        return {
          access,
          target,
          valid,
          deviceCounters,
          extra,
          stalePin,
          pairKey,
        };
      },
      store as unknown as NativeD1,
    );
    try {
      if (captured.value.reply) {
        await session.batch(captured.checks(session));
        return captured.value.reply;
      }
      const plan = captured.value,
        effects: D1Statement[] = [],
        audits: DeviceAuditInput[] = [];
      if (plan.stalePin)
        effects.push(
          session
            .prepare(
              "DELETE FROM ParentElevationPin WHERE user_id=?1 AND family_id=?2 AND pin_hash=?3",
            )
            .bind(
              plan.stalePin.user_id,
              plan.stalePin.family_id,
              plan.stalePin.pin_hash,
            ),
        );
      let reply: DeviceCredentialResult;
      if (!plan.valid || !plan.target) {
        effects.push(
          ...[...plan.deviceCounters, ...plan.extra].map((row) =>
            prepareD1RateLimitIncrement(
              session,
              row.key,
              row.windowMs,
              now.getTime(),
            ),
          ),
        );
        if (plan.target) {
          const account = plan.extra[0],
            auditBase = {
              familyId: actor.familyId,
              deviceId: actor.deviceId,
              actorUserId: plan.target.id,
              at: now,
            };
          if (account.used + 1 >= 10) {
            effects.push(
              session
                .prepare(
                  "UPDATE ParentElevationPin SET locked_until=?3,updated_at=?4 WHERE user_id=?1 AND family_id=?2",
                )
                .bind(
                  plan.target.id,
                  actor.familyId,
                  now.getTime() + 60 * MIN,
                  now.getTime(),
                ),
            );
            audits.push({
              ...auditBase,
              type: "device.elevation_locked",
              metadata: { scope: "account" },
            });
          } else if (plan.deviceCounters[0].used + 1 >= 5)
            audits.push({
              ...auditBase,
              type: "device.elevation_locked",
              metadata: { scope: "device" },
            });
        }
        reply = denied(401, "ELEVATION_INVALID_CREDENTIAL");
      } else {
        const token = generateDeviceToken("e"),
          expiresAt = new Date(now.getTime() + ELEVATION_MAX_MS);
        effects.push(
          session
            .prepare("DELETE FROM RateLimitEntry WHERE key=?1")
            .bind(plan.pairKey),
          session
            .prepare(
              "UPDATE HouseholdDevice SET elevation_token_hash=?2,elevated_user_id=?3,elevated_token_version=?4,elevation_method=?5,elevation_started_at=?6,elevation_last_used_at=?6,elevation_expires_at=?7,updated_at=?6 WHERE id=?1 AND family_id=?8 AND revoked_at IS NULL",
            )
            .bind(
              actor.deviceId,
              hashToken(token),
              plan.target.id,
              plan.target.token_version,
              input.method,
              now.getTime(),
              expiresAt.getTime(),
              actor.familyId,
            ),
        );
        reply = {
          status: 200,
          body: {
            elevationToken: token,
            expiresAt: expiresAt.toISOString(),
            idleTimeoutSeconds: ELEVATION_IDLE_MS / 1000,
            member: { id: plan.target.id, name: plan.target.name },
          },
        };
        audits.push({
          familyId: actor.familyId,
          deviceId: actor.deviceId,
          actorUserId: plan.target.id,
          type: "device.elevation_started",
          metadata: { method: input.method },
          at: now,
        });
      }
      await session.batch([...captured.checks(session), ...effects]);
      for (const audit of audits) await writeD1DeviceAudit(session, audit);
      return reply;
    } catch (cause) {
      if (!isD1WriteConflict(cause)) throw cause;
    }
  }
  return denied(503, "SERVICE_UNAVAILABLE");
}
export async function setD1ParentPin(
  actor: DeviceManagerActor,
  input: { pin: string; password: string },
  now: Date,
  database?: D1Store,
): Promise<DeviceCredentialResult> {
  if (!Number.isFinite(now.getTime())) throw new Error("Invalid PIN clock");
  if (!isAcceptablePin(input.pin)) return denied(400, "PIN_TOO_WEAK");
  const store = database ?? (await getD1Database()),
    session = store.withSession("first-primary"),
    proofs = new Map<string, boolean>();
  let pinHash: string | undefined;
  for (let attempt = 0; attempt < 12; attempt++) {
    const captured = await captureD1Reads(
      async (db) => {
        await requireD1DeviceManager(db, actor);
        const user = await db.user.findUnique({
          where: { id: actor.userId },
          select: { password: true },
        });
        if (!user?.password) return false;
        if (!proofs.has(user.password))
          proofs.set(
            user.password,
            await verifyPassword(input.password, user.password),
          );
        return proofs.get(user.password) === true;
      },
      store as unknown as NativeD1,
    );
    try {
      if (!captured.value) {
        await session.batch(captured.checks(session));
        return denied(401, "INVALID_PASSWORD");
      }
      pinHash ??= await hashPassword(input.pin);
      await session.batch([
        ...captured.checks(session),
        session
          .prepare(
            "INSERT INTO ParentElevationPin(user_id,family_id,pin_hash,locked_until,created_at,updated_at) VALUES (?1,?2,?3,NULL,?4,?4) ON CONFLICT(user_id) DO UPDATE SET family_id=excluded.family_id,pin_hash=excluded.pin_hash,locked_until=NULL,updated_at=excluded.updated_at",
          )
          .bind(actor.userId, actor.familyId, pinHash, now.getTime()),
      ]);
      await writeD1DeviceAudit(session, {
        familyId: actor.familyId,
        actorUserId: actor.userId,
        type: "parent_pin.set",
        metadata: {},
        at: now,
      });
      return { status: 204 };
    } catch (cause) {
      if (!isD1WriteConflict(cause)) throw cause;
    }
  }
  return denied(503, "SERVICE_UNAVAILABLE");
}
export async function removeD1ParentPin(
  actor: DeviceManagerActor,
  now: Date,
  database?: D1Store,
): Promise<DeviceCredentialResult> {
  if (!Number.isFinite(now.getTime())) throw new Error("Invalid PIN clock");
  const store = database ?? (await getD1Database()),
    session = store.withSession("first-primary");
  for (let attempt = 0; attempt < 12; attempt++) {
    const captured = await captureD1Reads(
      async (db) => {
        await requireD1DeviceManager(db, actor);
        return db.parentElevationPin.findUnique({
          where: { user_id: actor.userId },
          select: { user_id: true },
        });
      },
      store as unknown as NativeD1,
    );
    try {
      await session.batch([
        ...captured.checks(session),
        ...(captured.value
          ? [
              session
                .prepare("DELETE FROM ParentElevationPin WHERE user_id=?1")
                .bind(actor.userId),
            ]
          : []),
      ]);
      if (captured.value)
        await writeD1DeviceAudit(session, {
          familyId: actor.familyId,
          actorUserId: actor.userId,
          type: "parent_pin.removed",
          metadata: {},
          at: now,
        });
      return { status: 204 };
    } catch (cause) {
      if (!isD1WriteConflict(cause)) throw cause;
    }
  }
  return denied(503, "SERVICE_UNAVAILABLE");
}
