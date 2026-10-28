import { hashPassword, verifyPassword } from "../../../src/lib/auth";
import {
  setD1ParentPin,
  removeD1ParentPin,
  enterD1DeviceElevation,
} from "../../../src/lib/cloudflare/device-credentials-entry";
import {
  manageD1Device,
  readD1DeviceEvents,
} from "../../../src/lib/cloudflare/device-management";
import { D1DeviceManagerRefused } from "../../../src/lib/cloudflare/device-manager";
import {
  prepareD1DeviceSession,
  resolveD1DeviceAccess,
} from "../../../src/lib/cloudflare/device-sessions";
import { hashToken } from "../../../src/lib/tokens";
import { loginAccountKey } from "../../../src/lib/login-lockout";
import type { D1Store } from "../../../src/lib/cloudflare/database";
function check(value: unknown, label: string): asserts value {
  if (!value) throw new Error(label);
}
export async function testDeviceParent(db: D1Store) {
  const now = new Date("2026-10-28T16:00:00Z"),
    parent = {
      userId: "parent-native-user",
      familyId: "parent-native-a",
      generation: 0,
    },
    password = "Fabricated parent passphrase 9!",
    pin = "482957",
    pin2 = "957284";
  const passwordHash = await hashPassword(password),
    changedPassword = await hashPassword("Different fabricated passphrase 8!");
  await db
    .prepare(
      `INSERT INTO Family(id,name,invite_code) VALUES ('parent-native-a','Fixture','parent-native-a'),('parent-native-b','Other','parent-native-b')`,
    )
    .run();
  await db
    .prepare(
      `INSERT INTO User(id,email,name,role,family_id,password) VALUES ('parent-native-user','parent-native-user@example.test','Parent','parent','parent-native-a',?1),('parent-native-teen','parent-native-teen@example.test','Teen','teen','parent-native-a',?1),('parent-native-other','parent-native-other@example.test','Other','parent','parent-native-b',?1)`,
    )
    .bind(passwordHash)
    .run();
  const pinRow = async () =>
    db
      .prepare(
        `SELECT * FROM ParentElevationPin WHERE user_id='parent-native-user'`,
      )
      .first<any>();
  const deviceRow = async (id: string) =>
    db
      .prepare("SELECT * FROM HouseholdDevice WHERE id=?1")
      .bind(id)
      .first<any>();
  const keyCount = async (key: string) =>
    (
      await db
        .prepare("SELECT count FROM RateLimitEntry WHERE key=?1")
        .bind(key)
        .first<{ count: number }>()
    )?.count ?? 0;
  const factCount = async (id: string, action: string) =>
    (await db
      .prepare(
        "SELECT count(*) n FROM AuditLog WHERE target_id=?1 AND action=?2",
      )
      .bind(id, action)
      .first<{ n: number }>())!.n;
  function racing(change: () => Promise<unknown>): D1Store {
    let changed = false;
    return {
      prepare: db.prepare.bind(db),
      batch: db.batch.bind(db),
      withSession() {
        const source = db.withSession("first-primary");
        return {
          prepare: source.prepare.bind(source),
          async batch(statements) {
            if (!changed) {
              changed = true;
              await change();
            }
            return source.batch(statements);
          },
        };
      },
    };
  }
  async function seed(id: string) {
    await db
      .prepare(
        `INSERT INTO HouseholdDevice(id,family_id,label,platform) VALUES (?1,'parent-native-a','Kitchen','web')`,
      )
      .bind(id)
      .run();
    const issued = prepareD1DeviceSession(db, id, parent.familyId, now);
    await db.batch(issued.statements);
    const resolved = await resolveD1DeviceAccess(
      { access: issued.tokens.accessToken },
      now,
      db,
    );
    check(resolved.ok, "device fixture access");
    return resolved.actor;
  }
  check(
    (await setD1ParentPin(parent, { pin: "111111", password }, now, db))
      .status === 400,
    "weak PIN",
  );
  check(
    (await setD1ParentPin(parent, { pin, password: "wrong" }, now, db))
      .status === 401 && (await pinRow()) === null,
    "password required for PIN",
  );
  check(
    (await setD1ParentPin(parent, { pin, password }, now, db)).status === 204,
    "set own PIN",
  );
  check(
    (await pinRow()).pin_hash !== pin &&
      (await verifyPassword(pin, (await pinRow()).pin_hash)),
    "PIN bcrypt only",
  );
  const actor = await seed("parent-native-device"),
    enter = (
      secret: string,
      method: "pin" | "password" = "pin",
      who = actor,
      userId = parent.userId,
    ) => enterD1DeviceElevation(who, { userId, method, secret }, now, db);
  const bad = await enter("000000");
  check(
    bad.status === 401 &&
      (await deviceRow(actor.deviceId)).elevation_token_hash === null &&
      (await keyCount(
        `device-elev-fail:${actor.deviceId}:${parent.userId}`,
      )) === 1,
    "wrong PIN counts but no access",
  );
  const entered = await enter(pin);
  check(
    entered.status === 200 &&
      entered.body &&
      entered.body.member.id === parent.userId &&
      (await deviceRow(actor.deviceId)).elevation_token_hash ===
        hashToken(entered.body.elevationToken) &&
      (await keyCount(
        `device-elev-fail:${actor.deviceId}:${parent.userId}`,
      )) === 0,
    "successful PIN clears only pair failure and issues hash",
  );
  check(
    (await enter(password, "password")).status === 200,
    "password fallback",
  );
  for (const id of ["parent-native-other", "parent-native-teen", "missing"])
    check(
      (await enter(password, "password", actor, id)).status === 401,
      "uniform unavailable target",
    );
  check(
    (await keyCount("device-elev-fail-acct:parent-native-other")) === 0 &&
      (await keyCount(loginAccountKey("parent-native-other@example.test"))) ===
        0,
    "no foreign account lockout",
  );
  const throttle = await seed("parent-native-throttle");
  const failures = await Promise.all(
    Array.from({ length: 8 }, () => enter("000000", "pin", throttle)),
  );
  check(
    failures.filter((r) => r.status === 401).length === 5 &&
      failures.filter((r) => r.status === 429).length === 3 &&
      (await keyCount(
        `device-elev-fail:${throttle.deviceId}:${parent.userId}`,
      )) === 5,
    "concurrent pair failure cap",
  );
  // Isolate the account-limit case from earlier fabricated counters.
  await db
    .prepare(
      "DELETE FROM RateLimitEntry WHERE key LIKE 'device-elev-fail:parent-native-%' OR key LIKE 'device-elev-fail-acct:parent-native-%' OR key='login-fail:parent-native-user@example.test'",
    )
    .run();
  const lock1 = await seed("parent-native-lock1"),
    lock2 = await seed("parent-native-lock2"),
    lock3 = await seed("parent-native-lock3");
  for (let i = 0; i < 5; i++)
    check(
      (await enter("000000", "pin", lock1)).status === 401,
      "first failure group",
    );
  for (let i = 0; i < 4; i++)
    check(
      (await enter("000000", "pin", lock2)).status === 401,
      "second failure group",
    );
  await db
    .prepare(
      `CREATE TRIGGER pin_lock_rollback BEFORE UPDATE ON ParentElevationPin WHEN NEW.locked_until IS NOT NULL BEGIN SELECT RAISE(ABORT,'fixture rollback'); END`,
    )
    .run();
  let counterRollback = false;
  try {
    await enter("000000", "pin", lock2);
  } catch {
    counterRollback = true;
  }
  await db.prepare("DROP TRIGGER pin_lock_rollback").run();
  check(
    counterRollback &&
      (await keyCount("device-elev-fail-acct:" + parent.userId)) === 9 &&
      (await pinRow()).locked_until === null,
    "PIN lock and counters roll back together",
  );
  check(
    (await enter("000000", "pin", lock2)).status === 401 &&
      (await pinRow()).locked_until === now.getTime() + 3600000 &&
      (await enter(pin, "pin", lock3)).status === 423,
    "account PIN lockout",
  );
  check(
    (await enter(password, "password", lock3)).status === 200,
    "password fallback while PIN locked",
  );
  await db
    .prepare(
      "DELETE FROM RateLimitEntry WHERE key LIKE 'device-elev-fail:parent-native-%' OR key LIKE 'device-elev-fail-acct:parent-native-%' OR key='login-fail:parent-native-user@example.test'",
    )
    .run();
  await db
    .prepare(
      `UPDATE ParentElevationPin SET locked_until=NULL WHERE user_id='parent-native-user'`,
    )
    .run();
  const fresh = await seed("parent-native-secret-race");
  const secretRace = await enterD1DeviceElevation(
    fresh,
    { userId: parent.userId, method: "password", secret: password },
    now,
    racing(() =>
      db
        .prepare(`UPDATE User SET password=?1 WHERE id='parent-native-user'`)
        .bind(changedPassword)
        .run(),
    ),
  );
  check(
    secretRace.status === 401 &&
      (await deviceRow(fresh.deviceId)).elevation_token_hash === null,
    "changed password cannot reuse bcrypt proof",
  );
  await db
    .prepare(`UPDATE User SET password=?1 WHERE id='parent-native-user'`)
    .bind(passwordHash)
    .run();
  let pinRevoked = false;
  try {
    await setD1ParentPin(
      parent,
      { pin: pin2, password },
      now,
      racing(() =>
        db
          .prepare(
            `UPDATE User SET token_version=1 WHERE id='parent-native-user'`,
          )
          .run(),
      ),
    );
  } catch (e) {
    pinRevoked = e instanceof D1DeviceManagerRefused && e.status === 401;
  }
  check(
    pinRevoked && (await verifyPassword(pin, (await pinRow()).pin_hash)),
    "parent generation protects PIN write",
  );
  await db
    .prepare(`UPDATE User SET token_version=0 WHERE id='parent-native-user'`)
    .run();
  const revoked = await seed("parent-native-revoke-race");
  const denied = await enterD1DeviceElevation(
    revoked,
    { userId: parent.userId, method: "pin", secret: pin },
    now,
    racing(() =>
      db
        .prepare("UPDATE HouseholdDevice SET revoked_at=?1 WHERE id=?2")
        .bind(now.getTime(), revoked.deviceId)
        .run(),
    ),
  );
  check(
    denied.status === 401 &&
      denied.code === "DEVICE_REVOKED" &&
      (await keyCount(
        `device-elev-fail:${revoked.deviceId}:${parent.userId}`,
      )) === 0,
    "device revoked at credential commit",
  );
  const owner = { kind: "person" as const, actor: parent },
    adminActor = await seed("parent-native-admin");
  const renames = await Promise.all(
    Array.from({ length: 8 }, (_, i) =>
      manageD1Device(
        owner,
        { kind: "rename", id: adminActor.deviceId, label: "Kitchen " + i },
        now,
        db,
      ),
    ),
  );
  check(
    renames.every((r) => r.status === 200) &&
      (await factCount(adminActor.deviceId, "device.renamed")) === 8,
    "rename races record each real transition",
  );
  const same = await Promise.all(
    Array.from({ length: 8 }, () =>
      manageD1Device(
        owner,
        { kind: "rename", id: adminActor.deviceId, label: "Final kitchen" },
        now,
        db,
      ),
    ),
  );
  check(
    same.every((r) => r.status === 200) &&
      (await factCount(adminActor.deviceId, "device.renamed")) === 9,
    "convergent rename one household fact",
  );
  const labelBefore = (await deviceRow(adminActor.deviceId)).label;
  await db
    .prepare(
      `CREATE TRIGGER device_admin_audit_fail BEFORE INSERT ON AuditLog WHEN NEW.target_id='${adminActor.deviceId}' BEGIN SELECT RAISE(ABORT,'fixture rollback'); END`,
    )
    .run();
  let auditRollback = false;
  try {
    await manageD1Device(
      owner,
      { kind: "revoke", id: adminActor.deviceId, reason: "lost" },
      now,
      db,
    );
  } catch {
    auditRollback = true;
  }
  await db.prepare("DROP TRIGGER device_admin_audit_fail").run();
  check(
    auditRollback &&
      (await deviceRow(adminActor.deviceId)).revoked_at === null &&
      (await deviceRow(adminActor.deviceId)).label === labelBefore,
    "revoke audit rollback retains live device",
  );
  const grant = await enter(pin, "pin", adminActor);
  check(grant.body, "management elevation fixture");
  const elevated = {
    ...adminActor,
    kind: "device_elevated_parent" as const,
    parentId: parent.userId,
    parentName: "Parent",
  };
  const deviceOwner = {
    kind: "device" as const,
    actor: elevated,
    header: grant.body.elevationToken,
  };
  check(
    (
      await manageD1Device(
        deviceOwner,
        { kind: "rename", id: adminActor.deviceId, label: "On tablet" },
        now,
        db,
      )
    ).status === 200,
    "elevated self rename",
  );
  check(
    (
      await manageD1Device(
        deviceOwner,
        { kind: "rename", id: actor.deviceId, label: "Other target" },
        now,
        db,
      )
    ).status === 404,
    "device commands target self only",
  );
  const expiredGrant = await manageD1Device(
    deviceOwner,
    { kind: "rename", id: adminActor.deviceId, label: "Revoked parent" },
    now,
    racing(() =>
      db
        .prepare(
          `UPDATE User SET token_version=1 WHERE id='parent-native-user'`,
        )
        .run(),
    ),
  );
  check(
    expiredGrant.status === 403 &&
      (await deviceRow(adminActor.deviceId)).label === "On tablet",
    "elevated parent generation at commit",
  );
  await db
    .prepare(`UPDATE User SET token_version=0 WHERE id='parent-native-user'`)
    .run();
  const revokeRace = await Promise.all(
    Array.from({ length: 8 }, () =>
      manageD1Device(
        owner,
        { kind: "revoke", id: adminActor.deviceId, reason: "lost" },
        now,
        db,
      ),
    ),
  );
  check(
    revokeRace.every((r) => r.status === 200) &&
      (await factCount(adminActor.deviceId, "device.removed")) === 1 &&
      (
        await db
          .prepare(
            "SELECT count(*) n FROM DeviceSession WHERE device_id=?1 AND revoked_at IS NULL",
          )
          .bind(adminActor.deviceId)
          .first<{ n: number }>()
      )?.n === 0 &&
      (await deviceRow(adminActor.deviceId)).elevation_token_hash === null,
    "revoke races one fact all sessions cleared",
  );
  check(
    (
      await manageD1Device(
        owner,
        { kind: "rename", id: adminActor.deviceId, label: "Removed" },
        now,
        db,
      )
    ).status === 400,
    "removed cannot rename",
  );
  check(
    (
      await manageD1Device(
        {
          kind: "person",
          actor: {
            userId: "parent-native-other",
            familyId: "parent-native-b",
            generation: 0,
          },
        },
        { kind: "revoke", id: actor.deviceId, reason: "parent" },
        now,
        db,
      )
    ).status === 404,
    "foreign target missing",
  );
  let privilege = false;
  try {
    await manageD1Device(
      { kind: "person", actor: { ...parent, userId: "parent-native-teen" } },
      { kind: "revoke", id: actor.deviceId, reason: "parent" },
      now,
      db,
    );
  } catch (e) {
    privilege = e instanceof D1DeviceManagerRefused && e.status === 403;
  }
  check(privilege, "teen no management");
  for (let i = 0; i < 55; i++)
    await db
      .prepare(
        `INSERT INTO DeviceAuditEvent(id,family_id,device_id,actor_user_id,type,metadata,created_at) VALUES (?1,'parent-native-a',?2,?3,'device.renamed','{}',?4)`,
      )
      .bind(
        "parent-native-event-" + String(i).padStart(2, "0"),
        actor.deviceId,
        i === 54 ? "parent-native-other" : parent.userId,
        now.getTime(),
      )
      .run();
  const page = await readD1DeviceEvents(parent, actor.deviceId, null, db);
  check(
    page.status === 200 &&
      page.body &&
      page.body.events.length === 50 &&
      page.body.nextCursor &&
      page.body.events[0].actorName === null,
    "bounded audit and foreign actor anonymized",
  );
  const next = await readD1DeviceEvents(
    parent,
    actor.deviceId,
    page.body.nextCursor,
    db,
  );
  check(
    next.status === 200 && next.body && next.body.events.length >= 5,
    "audit cursor continues",
  );
  check(
    (await readD1DeviceEvents(parent, actor.deviceId, "bad", db)).status ===
      400,
    "invalid audit cursor",
  );
  check(
    (await removeD1ParentPin(parent, now, db)).status === 204 &&
      (await removeD1ParentPin(parent, now, db)).status === 204 &&
      (await pinRow()) === null,
    "PIN removal idempotent",
  );
  return {
    pinPasswordProof: true,
    hashedPIN: true,
    pinAndPasswordEntry: true,
    foreignLockoutRefused: true,
    concurrentFailureCap: 8,
    pinCounterRollback: true,
    accountLockout: true,
    passwordFallbackWhilePINLocked: true,
    changedPasswordProof: true,
    pinGenerationRace: true,
    deviceRevocationRace: true,
    renameRace: 8,
    convergentOneFact: true,
    revokeAuditRollback: true,
    elevatedSelfOnly: true,
    elevationGenerationRace: true,
    revokeRace: 8,
    oneRemovalAllGenerations: true,
    removedRenameRefusal: true,
    foreignAndTeenRefusal: true,
    privatePagedActivity: true,
    idempotentPINRemoval: true,
  };
}
