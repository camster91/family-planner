import { randomUUID } from "node:crypto";
import { hashToken } from "@/lib/tokens";
import { timingSafeEqualStr } from "@/lib/constant-time";
import {
  generatePairingCode,
  generateConfirmDigits,
  normalisePairingCode,
  PAIRING_TTL_MS,
  MAX_LIVE_CODES,
  MAX_ACTIVE_DEVICES,
  MAX_CONFIRM_ATTEMPTS,
  PARENT_PAIRING_SELECT,
  TABLET_PAIRING_SELECT,
  parentPairingStatus,
  type CreatePairingResult,
  type ClaimResult,
  type ConfirmResult,
  type IssueResult,
} from "@/lib/device-pairing";
import { generateDeviceToken } from "@/lib/device-session";
import {
  auditSummary,
  prepareD1AuditLog,
  type AuditEntry,
} from "@/lib/household-audit";
import { getD1Database, type D1Store, type D1Statement } from "./database";
import { captureD1Reads } from "./read-witness";
import type { D1ReadClient, NativeD1 } from "./read-client";
import { isD1WriteConflict, d1WriteCheck } from "./write-check";
import {
  requireD1DeviceManager,
  type DeviceManagerActor,
} from "./device-manager";
import {
  prepareD1DeviceRevocation,
  prepareD1DeviceSession,
} from "./device-sessions";
type Session = Pick<D1Store, "prepare" | "batch">;
type Plan<T> = { value: T; effects?: (session: Session) => D1Statement[] };
/** Internal planner only: actual source SELECTs are witnessed, then explicit SQL
 * effects commit. No Prisma transaction or mutable database facade is granted. */
async function commit<T>(
  store: D1Store,
  read: (db: D1ReadClient) => Promise<Plan<T>>,
): Promise<T> {
  const session = store.withSession("first-primary");
  for (let attempt = 0; attempt < 16; attempt++) {
    const capture = await captureD1Reads(read, store as unknown as NativeD1);
    try {
      await session.batch([
        ...capture.checks(session),
        ...(capture.value.effects?.(session) ?? []),
      ]);
      return capture.value.value;
    } catch (cause) {
      if (!isD1WriteConflict(cause)) throw cause;
    }
  }
  throw new Error("Device pairing changed too many times");
}
function clock(now: Date) {
  if (!Number.isFinite(now.getTime())) throw new Error("Invalid pairing clock");
}
export async function createD1Pairing(
  actor: DeviceManagerActor,
  args: { label: string; replacesDeviceId?: string | null; now: Date },
  database?: D1Store,
): Promise<CreatePairingResult> {
  clock(args.now);
  const store = database ?? (await getD1Database()),
    now = args.now,
    replaces = args.replacesDeviceId ?? null;
  for (let collision = 0; collision < 3; collision++) {
    try {
      return await commit<CreatePairingResult>(store, async (db) => {
        await requireD1DeviceManager(db, actor);
        if (replaces) {
          const target = await db.householdDevice.findFirst({
            where: { id: replaces, family_id: actor.familyId },
            select: { revoked_at: true },
          });
          if (!target)
            return { value: { ok: false, code: "REPLACE_NOT_FOUND" } };
          if (target.revoked_at)
            return { value: { ok: false, code: "REPLACE_REMOVED" } };
        }
        const pending = await db.devicePairing.findMany({
          where: {
            family_id: actor.familyId,
            expires_at: { gt: now },
            cancelled_at: null,
            device_id: null,
          },
          select: {
            id: true,
            claimed_at: true,
            replaces_device_id: true,
            created_at: true,
          },
          orderBy: [{ created_at: "asc" }, { id: "asc" }],
        });
        const unclaimed = pending.filter((row) => row.claimed_at === null),
          superseded = unclaimed
            .slice(0, Math.max(0, unclaimed.length - (MAX_LIVE_CODES - 1)))
            .map((row) => row.id),
          remaining = pending.filter((row) => !superseded.includes(row.id));
        const active = await db.householdDevice.findMany({
            where: { family_id: actor.familyId, revoked_at: null },
            select: { id: true },
          }),
          targets = new Set(
            remaining.flatMap((row) =>
              row.replaces_device_id ? [row.replaces_device_id] : [],
            ),
          );
        if (replaces) targets.add(replaces);
        if (
          active.length -
            active.filter((row) => targets.has(row.id)).length +
            remaining.length >=
          MAX_ACTIVE_DEVICES
        )
          return { value: { ok: false, code: "DEVICE_LIMIT_REACHED" } };
        const code = generatePairingCode(),
          pairingId = randomUUID(),
          expiresAt = new Date(now.getTime() + PAIRING_TTL_MS);
        return {
          value: { ok: true, pairingId, code, expiresAt, superseded },
          effects: (session) => [
            ...superseded.map((id) =>
              session
                .prepare(
                  "UPDATE DevicePairing SET cancelled_at=?2 WHERE id=?1 AND cancelled_at IS NULL",
                )
                .bind(id, now.getTime()),
            ),
            session
              .prepare(
                "INSERT INTO DevicePairing(id,family_id,code_hash,label,created_by,expires_at,replaces_device_id,created_at) VALUES (?1,?2,?3,?4,?5,?6,?7,?8)",
              )
              .bind(
                pairingId,
                actor.familyId,
                hashToken(code),
                args.label,
                actor.userId,
                expiresAt.getTime(),
                replaces,
                now.getTime(),
              ),
          ],
        };
      });
    } catch (cause) {
      if (
        !(
          cause instanceof Error &&
          cause.message.includes(
            "UNIQUE constraint failed: DevicePairing.code_hash",
          )
        ) ||
        collision === 2
      )
        throw cause;
    }
  }
  throw new Error("Pairing code could not be allocated");
}
export async function claimD1Pairing(
  args: {
    code: unknown;
    platform: "android" | "web";
    appVersion: string | null;
    now: Date;
  },
  database?: D1Store,
): Promise<ClaimResult> {
  clock(args.now);
  const code = normalisePairingCode(args.code);
  if (!code) return { ok: false };
  const store = database ?? (await getD1Database());
  return commit<ClaimResult>(store, async (db) => {
    const row = await db.devicePairing.findUnique({
      where: { code_hash: hashToken(code) },
      select: {
        id: true,
        family_id: true,
        expires_at: true,
        claimed_at: true,
        cancelled_at: true,
        device_id: true,
      },
    });
    if (
      !row ||
      row.expires_at <= args.now ||
      row.claimed_at ||
      row.cancelled_at ||
      row.device_id
    )
      return { value: { ok: false } };
    const claimToken = generateDeviceToken("p"),
      confirmDigits = generateConfirmDigits();
    return {
      value: {
        ok: true,
        pairingId: row.id,
        familyId: row.family_id,
        claimToken,
        confirmDigits,
        expiresAt: row.expires_at,
      },
      effects: (session) => [
        session
          .prepare(
            "UPDATE DevicePairing SET claimed_at=?2,claim_token_hash=?3,confirm_digits_hash=?4,claim_platform=?5,claim_app_version=?6 WHERE id=?1 AND claimed_at IS NULL AND cancelled_at IS NULL AND device_id IS NULL",
          )
          .bind(
            row.id,
            args.now.getTime(),
            hashToken(claimToken),
            hashToken(confirmDigits),
            args.platform,
            args.appVersion,
          ),
        d1WriteCheck(session, "changes()=1"),
      ],
    };
  });
}
export async function confirmD1Pairing(
  actor: DeviceManagerActor,
  args: { pairingId: string; digits: string; now: Date },
  database?: D1Store,
): Promise<ConfirmResult> {
  clock(args.now);
  const store = database ?? (await getD1Database());
  return commit<ConfirmResult>(store, async (db) => {
    await requireD1DeviceManager(db, actor);
    const row = await db.devicePairing.findFirst({
      where: { id: args.pairingId, family_id: actor.familyId },
      select: {
        ...PARENT_PAIRING_SELECT,
        confirm_digits_hash: true,
        confirm_attempts: true,
      },
    });
    if (!row) return { value: { kind: "not_found" } };
    if (row.device_id || row.confirmed_at)
      return { value: { kind: "confirmed", newly: false } };
    if (row.cancelled_at) return { value: { kind: "cancelled" } };
    if (row.expires_at <= args.now) return { value: { kind: "expired" } };
    if (!row.claimed_at || !row.confirm_digits_hash)
      return { value: { kind: "not_claimed" } };
    if (timingSafeEqualStr(hashToken(args.digits), row.confirm_digits_hash))
      return {
        value: { kind: "confirmed", newly: true },
        effects: (session) => [
          session
            .prepare(
              "UPDATE DevicePairing SET confirmed_at=?2,confirmed_by=?3 WHERE id=?1 AND confirmed_at IS NULL AND cancelled_at IS NULL",
            )
            .bind(row.id, args.now.getTime(), actor.userId),
          d1WriteCheck(session, "changes()=1"),
        ],
      };
    if (row.confirm_attempts >= MAX_CONFIRM_ATTEMPTS)
      return { value: { kind: "cancelled" } };
    const attempts = row.confirm_attempts + 1,
      cancelled = attempts >= MAX_CONFIRM_ATTEMPTS;
    return {
      value: {
        kind: "mismatch",
        attemptsLeft: Math.max(0, MAX_CONFIRM_ATTEMPTS - attempts),
        cancelledNow: cancelled,
      },
      effects: (session) => [
        session
          .prepare(
            "UPDATE DevicePairing SET confirm_attempts=?2,cancelled_at=?3 WHERE id=?1 AND confirmed_at IS NULL AND cancelled_at IS NULL",
          )
          .bind(row.id, attempts, cancelled ? args.now.getTime() : null),
        d1WriteCheck(session, "changes()=1"),
      ],
    };
  });
}
export async function cancelD1Pairing(
  actor: DeviceManagerActor,
  pairingId: string,
  now: Date,
  database?: D1Store,
) {
  clock(now);
  return commit(database ?? (await getD1Database()), async (db) => {
    await requireD1DeviceManager(db, actor);
    const row = await db.devicePairing.findFirst({
      where: { id: pairingId, family_id: actor.familyId },
      select: { id: true, cancelled_at: true, device_id: true },
    });
    if (!row) return { value: { found: false, cancelledNow: false } };
    const changed = !row.cancelled_at && !row.device_id;
    return {
      value: { found: true, cancelledNow: changed },
      effects: (session) =>
        changed
          ? [
              session
                .prepare(
                  "UPDATE DevicePairing SET cancelled_at=?2 WHERE id=?1 AND cancelled_at IS NULL AND device_id IS NULL",
                )
                .bind(row.id, now.getTime()),
              d1WriteCheck(session, "changes()=1"),
            ]
          : [],
    };
  });
}
export async function readD1ParentPairing(
  actor: DeviceManagerActor,
  id: string,
  now: Date,
  database?: D1Store,
) {
  clock(now);
  return commit(database ?? (await getD1Database()), async (db) => {
    await requireD1DeviceManager(db, actor);
    const row = await db.devicePairing.findFirst({
      where: { id, family_id: actor.familyId },
      select: PARENT_PAIRING_SELECT,
    });
    if (!row) return { value: null };
    const old = row.replaces_device_id
      ? await db.householdDevice.findFirst({
          where: { id: row.replaces_device_id, family_id: actor.familyId },
          select: { revoked_at: true },
        })
      : null;
    return {
      value: {
        status: parentPairingStatus(row, now),
        ...(row.claimed_at
          ? {
              claim: {
                platform: row.claim_platform,
                appVersion: row.claim_app_version,
              },
            }
          : {}),
        replaces: row.replaces_device_id
          ? {
              deviceId: row.replaces_device_id,
              removed: Boolean(old?.revoked_at),
            }
          : null,
      },
    };
  });
}
function validClaim(token: unknown): token is string {
  return (
    typeof token === "string" &&
    token.startsWith("fpd1_p_") &&
    token.length <= 100
  );
}
export async function findD1PairingByClaimToken(
  token: unknown,
  database?: D1Store,
) {
  if (!validClaim(token)) return null;
  return commit(database ?? (await getD1Database()), async (db) => ({
    value: await db.devicePairing.findUnique({
      where: { claim_token_hash: hashToken(token) },
      select: TABLET_PAIRING_SELECT,
    }),
  }));
}
/** Claim-token authority is read again here; the earlier polling lookup cannot
 * turn a stale cached row into permission to issue or replace a device. */
export async function issueD1PairedDevice(
  token: unknown,
  now: Date,
  database?: D1Store,
): Promise<IssueResult> {
  clock(now);
  if (!validClaim(token)) return { kind: "expired" };
  const store = database ?? (await getD1Database());
  return commit<IssueResult>(store, async (db) => {
    const row = await db.devicePairing.findUnique({
      where: { claim_token_hash: hashToken(token) },
    });
    if (!row || row.device_id) return { value: { kind: "expired" } };
    if (row.cancelled_at) return { value: { kind: "cancelled" } };
    if (row.expires_at <= now) return { value: { kind: "expired" } };
    if (!row.confirmed_at) return { value: { kind: "pending" } };
    const [family, creator, confirmer] = await Promise.all([
      db.family.findUnique({
        where: { id: row.family_id },
        select: { id: true },
      }),
      db.user.findFirst({
        where: { id: row.created_by, family_id: row.family_id },
        select: { id: true },
      }),
      row.confirmed_by
        ? db.user.findFirst({
            where: {
              id: row.confirmed_by,
              family_id: row.family_id,
              role: "parent",
            },
            select: { id: true },
          })
        : null,
    ]);
    if (!family || !creator || !confirmer)
      return { value: { kind: "expired" } };
    const replaced = row.replaces_device_id
      ? await db.householdDevice.findFirst({
          where: {
            id: row.replaces_device_id,
            family_id: row.family_id,
            revoked_at: null,
          },
          select: { id: true, label: true },
        })
      : null;
    const active = await db.householdDevice.count({
      where: { family_id: row.family_id, revoked_at: null },
    });
    if (active - (replaced ? 1 : 0) >= MAX_ACTIVE_DEVICES)
      return {
        value: { kind: "limit" },
        effects: (session) => [
          session
            .prepare(
              "UPDATE DevicePairing SET cancelled_at=?2 WHERE id=?1 AND device_id IS NULL AND cancelled_at IS NULL",
            )
            .bind(row.id, now.getTime()),
          d1WriteCheck(session, "changes()=1"),
        ],
      };
    const device = { id: randomUUID(), label: row.label },
      primary = store.withSession("first-primary"),
      issued = prepareD1DeviceSession(primary, device.id, row.family_id, now);
    const base = {
      familyId: row.family_id,
      actorUserId: row.confirmed_by,
      actorKind: "person" as const,
      targetType: "device" as const,
    };
    const audit: AuditEntry[] = [
      ...(replaced
        ? [
            {
              ...base,
              action: "device.removed" as const,
              targetId: replaced.id,
              summary: auditSummary.deviceRemoved(replaced.label, "replaced"),
            },
          ]
        : []),
      {
        ...base,
        action: "device.paired",
        targetId: device.id,
        summary: auditSummary.devicePaired(device.label),
      },
    ];
    return {
      value: {
        kind: "paired",
        device,
        tokens: issued.tokens,
        replacedDeviceId: replaced?.id ?? null,
      },
      effects: (session) => [
        ...(replaced
          ? prepareD1DeviceRevocation(
              session,
              replaced.id,
              row.family_id,
              row.confirmed_by,
              "replaced",
              now,
            )
          : []),
        session
          .prepare(
            "INSERT INTO HouseholdDevice(id,family_id,label,platform,created_by,confirmed_by,paired_at,last_seen_at,last_seen_app_version,created_at,updated_at) VALUES (?1,?2,?3,?4,?5,?6,?7,?7,?8,?7,?7)",
          )
          .bind(
            device.id,
            row.family_id,
            row.label,
            row.claim_platform === "android" ? "android" : "web",
            row.created_by,
            row.confirmed_by,
            now.getTime(),
            row.claim_app_version,
          ),
        session
          .prepare(
            "UPDATE DevicePairing SET device_id=?2 WHERE id=?1 AND device_id IS NULL AND cancelled_at IS NULL",
          )
          .bind(row.id, device.id),
        d1WriteCheck(session, "changes()=1"),
        ...issued.statements,
        ...prepareD1AuditLog(session, audit, now),
      ],
    };
  });
}
