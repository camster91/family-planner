import {
  resolveD1DeviceAccess,
  refreshD1DeviceSession,
  prepareD1DeviceSession,
  resolveD1Elevation,
  startD1Elevation,
  clearD1Elevation,
  findD1RefreshDeviceId,
} from "../../../src/lib/cloudflare/device-sessions";
import { readD1DeviceMe } from "../../../src/lib/cloudflare/device-me";
import { hashToken } from "../../../src/lib/tokens";
import {
  ACCESS_TTL_MS,
  REFRESH_REUSE_GRACE_MS,
  ELEVATION_IDLE_MS,
  ELEVATION_MAX_MS,
  type DeviceActor,
} from "../../../src/lib/device-session";
import type { D1Store } from "../../../src/lib/cloudflare/database";
function check(value: unknown, label: string): asserts value {
  if (!value) throw new Error(label);
}
export async function testDeviceSessions(db: D1Store) {
  const now = new Date("2026-10-28T16:00:00Z");
  await db
    .prepare(
      `INSERT INTO Family(id,name,invite_code,features,device_writes_enabled) VALUES ('native-device-a','Fixture household','native-device-a','{"calendar":true,"chores":true,"meals":false,"lists":true}',1),('native-device-b','Private other','native-device-b','{}',0)`,
    )
    .run();
  await db
    .prepare(
      `INSERT INTO User(id,email,name,role,family_id) VALUES ('native-device-parent','private-parent@example.test','Parent','parent','native-device-a'),('native-device-child','private-child@example.test','Child','child','native-device-a'),('native-device-other','private-other@example.test','Foreign name','parent','native-device-b')`,
    )
    .run();
  await db
    .prepare(
      `INSERT INTO ParentElevationPin(user_id,family_id,pin_hash) VALUES ('native-device-parent','native-device-a','fabricated-bcrypt-not-a-real-pin'),('native-device-other','native-device-b','foreign-fabricated-hash')`,
    )
    .run();
  const row = async (id: string) =>
    db
      .prepare("SELECT * FROM HouseholdDevice WHERE id=?1")
      .bind(id)
      .first<any>();
  const sessionRow = async (id: string) =>
    db.prepare("SELECT * FROM DeviceSession WHERE id=?1").bind(id).first<any>();
  async function seed(id: string, family = "native-device-a") {
    await db
      .prepare(
        "INSERT INTO HouseholdDevice(id,family_id,label,platform,last_seen_at,paired_at) VALUES (?1,?2,'Kitchen tablet','web',?3,?3)",
      )
      .bind(id, family, now.getTime() - 600000)
      .run();
    const issued = prepareD1DeviceSession(db, id, family, now);
    await db.batch(issued.statements);
    return issued.tokens;
  }
  function racing(sql: string): D1Store {
    let changed = false;
    return {
      prepare: db.prepare.bind(db),
      batch: db.batch.bind(db),
      withSession() {
        const primary = db.withSession("first-primary");
        return {
          prepare: primary.prepare.bind(primary),
          async batch(statements) {
            if (!changed) {
              changed = true;
              await db.prepare(sql).run();
            }
            return primary.batch(statements);
          },
        };
      },
    };
  }
  const tokens = await seed("native-device-one");
  const missing = await resolveD1DeviceAccess({}, now, db),
    refreshOnly = await resolveD1DeviceAccess(
      { refresh: tokens.refreshToken },
      now,
      db,
    );
  check(
    !missing.ok &&
      missing.code === "DEVICE_SESSION_INVALID" &&
      !refreshOnly.ok &&
      refreshOnly.code === "DEVICE_ACCESS_EXPIRED",
    "cookie classes",
  );
  const unknown = await resolveD1DeviceAccess(
    { access: "fabricated-unknown" },
    now,
    db,
  );
  check(
    !unknown.ok && unknown.code === "DEVICE_SESSION_INVALID",
    "unknown access",
  );
  const resolved = await resolveD1DeviceAccess(
    { access: tokens.accessToken },
    now,
    db,
  );
  check(
    resolved.ok &&
      resolved.actor.kind === "device" &&
      resolved.actor.familyId === "native-device-a",
    "device actor only",
  );
  check(
    (await sessionRow(tokens.sessionId)).first_used_at === now.getTime() &&
      (await row("native-device-one")).last_seen_at === now.getTime(),
    "first use and seen atomic touches",
  );
  await resolveD1DeviceAccess(
    { access: tokens.accessToken },
    new Date(now.getTime() + 1000),
    db,
  );
  check(
    (await row("native-device-one")).last_seen_at === now.getTime(),
    "last seen throttled",
  );
  const timed = await resolveD1DeviceAccess(
    { access: tokens.accessToken },
    new Date(now.getTime() + ACCESS_TTL_MS),
    db,
  );
  check(
    !timed.ok && timed.code === "DEVICE_ACCESS_EXPIRED",
    "access exact expiry",
  );
  check(
    (await findD1RefreshDeviceId(tokens.refreshToken, db)) ===
      "native-device-one" &&
      (await findD1RefreshDeviceId("unknown", db)) === null,
    "private refresh lookup",
  );
  const me = await readD1DeviceMe(resolved.actor, now, db);
  check(
    me.status === 200 &&
      me.body?.household.name === "Fixture household" &&
      me.body.parents.length === 1 &&
      me.body.parents[0].hasPin &&
      me.body.deviceWrites,
    "name-only me",
  );
  const meJson = JSON.stringify(me.body);
  check(
    !meJson.includes("@example.test") &&
      !meJson.includes("Foreign name") &&
      !meJson.includes("pin_hash") &&
      !meJson.includes("fabricated-bcrypt") &&
      !meJson.includes("access_token_hash"),
    "me hides credentials and foreign roster",
  );
  const started = await startD1Elevation(
    {
      deviceId: resolved.actor.deviceId,
      parentId: "native-device-parent",
      tokenVersion: 0,
      method: "pin",
      now,
    },
    db,
  );
  check(started, "start parent elevation");
  const elevated = await resolveD1Elevation(resolved, started.token, now, db);
  check(
    elevated.ok &&
      elevated.actor.kind === "device_elevated_parent" &&
      elevated.actor.parentId === "native-device-parent",
    "parent-bound elevation",
  );
  check(
    (await startD1Elevation(
      {
        deviceId: resolved.actor.deviceId,
        parentId: "native-device-child",
        tokenVersion: 0,
        method: "pin",
        now,
      },
      db,
    )) === null &&
      (await startD1Elevation(
        {
          deviceId: resolved.actor.deviceId,
          parentId: "native-device-other",
          tokenVersion: 0,
          method: "password",
          now,
        },
        db,
      )) === null,
    "non-parent and foreign elevation refused",
  );
  const wrong = await resolveD1Elevation(resolved, "wrong", now, db);
  check(
    !wrong.ok &&
      wrong.code === "ELEVATION_REQUIRED" &&
      (await row(resolved.actor.deviceId)).elevation_token_hash ===
        hashToken(started.token),
    "wrong header does not clear elevation",
  );
  check(
    !(await clearD1Elevation(
      resolved.actor.deviceId,
      hashToken("old-token"),
      db,
    )),
    "old elevation cannot clear new",
  );
  const idle = await resolveD1Elevation(
    resolved,
    started.token,
    new Date(now.getTime() + ELEVATION_IDLE_MS),
    db,
  );
  check(
    !idle.ok &&
      idle.code === "ELEVATION_EXPIRED" &&
      (await row(resolved.actor.deviceId)).elevation_token_hash === null,
    "idle clears atomically",
  );
  const second = await startD1Elevation(
    {
      deviceId: resolved.actor.deviceId,
      parentId: "native-device-parent",
      tokenVersion: 0,
      method: "password",
      now,
    },
    db,
  );
  check(second, "restart elevation");
  await db
    .prepare(`UPDATE User SET token_version=1 WHERE id='native-device-parent'`)
    .run();
  const credentialChanged = await resolveD1Elevation(
    resolved,
    second.token,
    now,
    db,
  );
  check(
    !credentialChanged.ok && credentialChanged.code === "ELEVATION_EXPIRED",
    "parent credential revocation",
  );
  await db
    .prepare(`UPDATE User SET token_version=0 WHERE id='native-device-parent'`)
    .run();
  const maximum = await startD1Elevation(
    {
      deviceId: resolved.actor.deviceId,
      parentId: "native-device-parent",
      tokenVersion: 0,
      method: "password",
      now,
    },
    db,
  );
  check(maximum, "max start");
  await db
    .prepare("UPDATE HouseholdDevice SET elevation_last_used_at=?2 WHERE id=?1")
    .bind(resolved.actor.deviceId, now.getTime() + ELEVATION_MAX_MS - 1000)
    .run();
  const maxed = await resolveD1Elevation(
    resolved,
    maximum.token,
    new Date(now.getTime() + ELEVATION_MAX_MS),
    db,
  );
  check(
    !maxed.ok && maxed.code === "ELEVATION_EXPIRED",
    "absolute max independent of idle touch",
  );
  const rotated = await refreshD1DeviceSession(tokens.refreshToken, now, db);
  check(rotated.ok && rotated.path === "rotated", "live refresh rotates");
  const oldAccess = await resolveD1DeviceAccess(
    { access: tokens.accessToken },
    now,
    db,
  );
  check(
    !oldAccess.ok && oldAccess.code === "DEVICE_ACCESS_EXPIRED",
    "old access dead",
  );
  const grace = await refreshD1DeviceSession(
    tokens.refreshToken,
    new Date(now.getTime() + 1000),
    db,
  );
  check(
    grace.ok &&
      grace.path === "grace_reissued" &&
      (await sessionRow(rotated.tokens.sessionId)).revoked_at !== null,
    "lost response grace replaces only untouched successor",
  );
  const live = await resolveD1DeviceAccess(
    { access: grace.tokens.accessToken },
    new Date(now.getTime() + 2000),
    db,
  );
  check(live.ok, "successor used");
  await startD1Elevation(
    {
      deviceId: resolved.actor.deviceId,
      parentId: "native-device-parent",
      tokenVersion: 0,
      method: "pin",
      now,
    },
    db,
  );
  const reuse = await refreshD1DeviceSession(
    tokens.refreshToken,
    new Date(now.getTime() + 3000),
    db,
  );
  check(
    !reuse.ok && reuse.code === "DEVICE_REVOKED" && reuse.reuseDetected,
    "used successor replay is reuse",
  );
  check(
    (await row(resolved.actor.deviceId)).revoke_reason === "token_reuse" &&
      (await row(resolved.actor.deviceId)).elevation_token_hash === null &&
      (
        await db
          .prepare(
            "SELECT count(*) n FROM DeviceSession WHERE device_id=?1 AND revoked_at IS NULL",
          )
          .bind(resolved.actor.deviceId)
          .first<{ n: number }>()
      )?.n === 0,
    "reuse kills all generations and elevation",
  );
  const afterRevoke = await readD1DeviceMe(live.actor, now, db);
  check(
    afterRevoke.status === 401 && !afterRevoke.body,
    "revoked me returns no metadata",
  );
  const past = await seed("native-device-past");
  const pastFirst = await refreshD1DeviceSession(past.refreshToken, now, db);
  check(pastFirst.ok, "out of grace fixture");
  const out = await refreshD1DeviceSession(
    past.refreshToken,
    new Date(now.getTime() + REFRESH_REUSE_GRACE_MS),
    db,
  );
  check(!out.ok && out.code === "DEVICE_REVOKED", "grace boundary revokes");
  const raceTokens = await seed("native-device-race");
  const race = await Promise.all(
    Array.from({ length: 8 }, () =>
      refreshD1DeviceSession(raceTokens.refreshToken, now, db),
    ),
  );
  check(
    race.every((r) => r.ok),
    "concurrent rotation classified",
  );
  let active = 0;
  for (const result of race) {
    if (
      result.ok &&
      (
        await resolveD1DeviceAccess(
          { access: result.tokens.accessToken },
          now,
          db,
        )
      ).ok
    )
      active++;
  }
  check(active === 1, "one live returned generation after concurrent grace");
  const rollback = await seed("native-device-rollback");
  await db
    .prepare(
      `CREATE TRIGGER device_fixture_fail BEFORE INSERT ON DeviceSession WHEN NEW.device_id='native-device-rollback' BEGIN SELECT RAISE(ABORT,'fixture rollback'); END`,
    )
    .run();
  let failed = false;
  try {
    await refreshD1DeviceSession(rollback.refreshToken, now, db);
  } catch {
    failed = true;
  }
  await db.prepare("DROP TRIGGER device_fixture_fail").run();
  check(
    failed &&
      (await sessionRow(rollback.sessionId)).rotated_at === null &&
      (await resolveD1DeviceAccess({ access: rollback.accessToken }, now, db))
        .ok,
    "rotation rollback retains original credential",
  );
  const revokedDuring = await seed("native-device-revoked-race");
  const denied = await refreshD1DeviceSession(
    revokedDuring.refreshToken,
    now,
    racing(
      `UPDATE HouseholdDevice SET revoked_at=${now.getTime()} WHERE id='native-device-revoked-race'`,
    ),
  );
  check(
    !denied.ok &&
      denied.code === "DEVICE_REVOKED" &&
      (await sessionRow(revokedDuring.sessionId)).rotated_at === null,
    "revocation before rotate batch",
  );
  const usedRace = await seed("native-device-use-race");
  const usedFirst = await refreshD1DeviceSession(
    usedRace.refreshToken,
    now,
    db,
  );
  check(usedFirst.ok, "use race fixture");
  const useDenied = await refreshD1DeviceSession(
    usedRace.refreshToken,
    now,
    racing(
      `UPDATE DeviceSession SET first_used_at=${now.getTime()} WHERE id='${usedFirst.tokens.sessionId}'`,
    ),
  );
  check(
    !useDenied.ok && useDenied.code === "DEVICE_REVOKED",
    "successor first use wins grace race",
  );
  const accessRace = await seed("native-device-access-race");
  const accessDenied = await resolveD1DeviceAccess(
    { access: accessRace.accessToken },
    now,
    racing(
      `UPDATE HouseholdDevice SET revoked_at=${now.getTime()} WHERE id='native-device-access-race'`,
    ),
  );
  check(
    !accessDenied.ok &&
      accessDenied.code === "DEVICE_REVOKED" &&
      (await sessionRow(accessRace.sessionId)).first_used_at === null,
    "revocation before access touch",
  );
  const unavailableDb: D1Store = {
    ...db,
    prepare() {
      throw new Error("fixture unavailable");
    },
    batch: db.batch.bind(db),
    withSession() {
      throw new Error("fixture unavailable");
    },
  };
  const temporary = await resolveD1DeviceAccess(
    { access: "unknown" },
    now,
    unavailableDb,
  );
  check(
    !temporary.ok && temporary.code === "SERVICE_UNAVAILABLE",
    "temporary failure does not purge",
  );
  const mismatch = await seed("native-device-family-mismatch");
  await db
    .prepare(`UPDATE DeviceSession SET family_id='native-device-b' WHERE id=?1`)
    .bind(mismatch.sessionId)
    .run();
  const cross = await resolveD1DeviceAccess(
    { access: mismatch.accessToken },
    now,
    db,
  );
  check(
    !cross.ok && cross.code === "DEVICE_SESSION_INVALID",
    "session family must match device",
  );
  const audit = await db
    .prepare(
      `SELECT metadata FROM DeviceAuditEvent WHERE family_id='native-device-a'`,
    )
    .all<{ metadata: string }>();
  check(
    audit.results.length > 0 &&
      audit.results.every(
        (r) =>
          !r.metadata.includes("fpd1_") &&
          !r.metadata.includes("@example.test"),
      ),
    "audit excludes credentials",
  );
  return {
    deviceOnlyActor: true,
    firstUseAndSeen: true,
    seenThrottle: true,
    accessExpiry: true,
    privateRefreshLookup: true,
    privateMe: true,
    parentBoundElevation: true,
    wrongHeaderAndOldClear: true,
    idleAndMax: true,
    credentialRevocation: true,
    rotation: true,
    lostResponseGrace: true,
    usedSuccessorReuse: true,
    allGenerationsRevoked: true,
    graceBoundary: true,
    concurrentRefresh: 8,
    oneLiveGeneration: true,
    atomicRollback: true,
    revokeBeforeCommit: true,
    successorUseRace: true,
    accessRevocationRace: true,
    temporary503: true,
    householdMismatch: true,
    privateAudit: true,
  };
}
