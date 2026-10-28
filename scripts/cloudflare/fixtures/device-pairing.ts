import { hashToken } from "../../../src/lib/tokens";
import { generateDeviceToken } from "../../../src/lib/device-session";
import {
  createD1Pairing,
  claimD1Pairing,
  confirmD1Pairing,
  cancelD1Pairing,
  findD1PairingByClaimToken,
  issueD1PairedDevice,
  readD1ParentPairing,
} from "../../../src/lib/cloudflare/device-pairing";
import { readD1DeviceList } from "../../../src/lib/cloudflare/device-list";
import { D1DeviceManagerRefused } from "../../../src/lib/cloudflare/device-manager";
import {
  prepareD1DeviceSession,
  resolveD1DeviceAccess,
} from "../../../src/lib/cloudflare/device-sessions";
import { PAIRING_TTL_MS } from "../../../src/lib/device-pairing";
import type { D1Store } from "../../../src/lib/cloudflare/database";
function check(value: unknown, label: string): asserts value {
  if (!value) throw new Error(label);
}
export async function testDevicePairing(db: D1Store) {
  const now = new Date("2026-10-28T16:00:00Z"),
    actor = {
      userId: "pair-native-parent",
      familyId: "pair-native-a",
      generation: 0,
    },
    foreign = {
      userId: "pair-native-other",
      familyId: "pair-native-b",
      generation: 0,
    };
  await db
    .prepare(
      `INSERT INTO Family(id,name,invite_code) VALUES ('pair-native-a','Fixture','pair-native-a'),('pair-native-b','Other','pair-native-b'),('pair-native-cap','Capacity','pair-native-cap')`,
    )
    .run();
  await db
    .prepare(
      `INSERT INTO User(id,email,name,role,family_id) VALUES ('pair-native-parent','pair-native-parent@example.test','Parent','parent','pair-native-a'),('pair-native-teen','pair-native-teen@example.test','Teen','teen','pair-native-a'),('pair-native-other','pair-native-other@example.test','Other','parent','pair-native-b'),('pair-native-cap-parent','pair-native-cap-parent@example.test','Parent','parent','pair-native-cap')`,
    )
    .run();
  const pair = async (label: string, extra: Record<string, unknown> = {}) => {
    const result = await createD1Pairing(actor, { label, now, ...extra }, db);
    check(result.ok, "pair fixture create");
    return result;
  };
  const claim = async (code: string) => {
    const result = await claimD1Pairing(
      { code, platform: "web", appVersion: "fixture-1", now },
      db,
    );
    check(result.ok, "pair fixture claim");
    return result;
  };
  const confirm = async (pairingId: string, digits: string) =>
    confirmD1Pairing(actor, { pairingId, digits, now }, db);
  const count = async (table: string, where = "family_id='pair-native-a'") =>
    (await db
      .prepare(`SELECT count(*) n FROM "${table}" WHERE ${where}`)
      .first<{ n: number }>())!.n;
  const pairingRow = async (id: string) =>
    db.prepare("SELECT * FROM DevicePairing WHERE id=?1").bind(id).first<any>();
  function racing(sql: string): D1Store {
    let changed = false;
    return {
      prepare: db.prepare.bind(db),
      batch: db.batch.bind(db),
      withSession() {
        const session = db.withSession("first-primary");
        return {
          prepare: session.prepare.bind(session),
          async batch(statements) {
            if (!changed) {
              changed = true;
              await db.prepare(sql).run();
            }
            return session.batch(statements);
          },
        };
      },
    };
  }
  const initial = await pair("Kitchen");
  check(
    initial.expiresAt.getTime() === now.getTime() + PAIRING_TTL_MS &&
      (await pairingRow(initial.pairingId)).code_hash !== initial.code,
    "one-time hashed code",
  );
  const claims = await Promise.all(
    Array.from({ length: 8 }, () =>
      claimD1Pairing(
        {
          code: initial.code,
          platform: "android",
          appVersion: "fixture-android",
          now,
        },
        db,
      ),
    ),
  );
  check(claims.filter((r) => r.ok).length === 1, "one claim from eight");
  const claimed = claims.find((r) => r.ok)!;
  check(claimed.ok, "claim result");
  check(
    !(
      await claimD1Pairing(
        { code: "unknown", platform: "web", appVersion: null, now },
        db,
      )
    ).ok &&
      !(
        await claimD1Pairing(
          { code: initial.code, platform: "web", appVersion: null, now },
          db,
        )
      ).ok,
    "uniform unknown used claim",
  );
  check(
    (await issueD1PairedDevice(claimed.claimToken, now, db)).kind === "pending",
    "pending cannot issue",
  );
  const parentStatus = await readD1ParentPairing(
    actor,
    initial.pairingId,
    now,
    db,
  );
  check(
    parentStatus?.status === "claimed" &&
      parentStatus.claim?.platform === "android" &&
      !JSON.stringify(parentStatus).includes("hash") &&
      !JSON.stringify(parentStatus).includes(claimed.confirmDigits),
    "safe parent poll",
  );
  check(
    (await readD1ParentPairing(foreign, initial.pairingId, now, db)) === null &&
      (
        await confirmD1Pairing(
          foreign,
          { pairingId: initial.pairingId, digits: claimed.confirmDigits, now },
          db,
        )
      ).kind === "not_found",
    "foreign scope",
  );
  const confirmations = await Promise.all(
    Array.from({ length: 8 }, () =>
      confirm(initial.pairingId, claimed.confirmDigits),
    ),
  );
  check(
    confirmations.every((r) => r.kind === "confirmed") &&
      confirmations.filter((r) => r.kind === "confirmed" && r.newly).length ===
        1,
    "one confirmation",
  );
  const issued = await Promise.all(
    Array.from({ length: 8 }, () =>
      issueD1PairedDevice(claimed.claimToken, now, db),
    ),
  );
  check(
    issued.filter((r) => r.kind === "paired").length === 1 &&
      (await count("HouseholdDevice")) === 1 &&
      (await count("DeviceSession")) === 1 &&
      (await count("AuditLog")) === 1,
    "one device session audit after eight polls",
  );
  const first = issued.find((r) => r.kind === "paired")!;
  check(first.kind === "paired", "issued fixture");
  check(
    (await resolveD1DeviceAccess({ access: first.tokens.accessToken }, now, db))
      .ok,
    "issued session works",
  );
  const list = await readD1DeviceList(actor, now, db);
  check(
    list.devices.length === 1 &&
      list.devices[0].status === "active" &&
      list.devices[0].platform === "android" &&
      !JSON.stringify(list).includes("hash"),
    "safe list active",
  );
  const wrong = await pair("Wrong digits"),
    wrongClaim = await claim(wrong.code);
  const bad = wrongClaim.confirmDigits === "0000" ? "1111" : "0000";
  const mismatches = await Promise.all(
    Array.from({ length: 8 }, () => confirm(wrong.pairingId, bad)),
  );
  check(
    (await pairingRow(wrong.pairingId)).confirm_attempts === 3 &&
      mismatches.filter((r) => r.kind === "mismatch" && r.cancelledNow)
        .length === 1 &&
      (await issueD1PairedDevice(wrongClaim.claimToken, now, db)).kind ===
        "cancelled",
    "third mismatch atomically cancels",
  );
  const cancelled = await pair("Cancel");
  check(
    (await cancelD1Pairing(actor, cancelled.pairingId, now, db)).cancelledNow &&
      !(await cancelD1Pairing(actor, cancelled.pairingId, now, db))
        .cancelledNow &&
      !(
        await claimD1Pairing(
          { code: cancelled.code, platform: "web", appVersion: null, now },
          db,
        )
      ).ok,
    "cancel idempotent and unclaimable",
  );
  const old = await pair("Expired");
  check(
    !(
      await claimD1Pairing(
        {
          code: old.code,
          platform: "web",
          appVersion: null,
          now: new Date(now.getTime() + PAIRING_TTL_MS),
        },
        db,
      )
    ).ok,
    "exact claim expiry",
  );
  await cancelD1Pairing(actor, old.pairingId, now, db);
  const oldest = await pair("Oldest"),
    middle = await pair("Middle"),
    third = await pair("Third"),
    fourth = await pair("Fourth");
  check(
    fourth.superseded.length === 1 &&
      (await pairingRow(fourth.superseded[0])).cancelled_at !== null,
    "fourth unclaimed code supersedes oldest",
  );
  for (const p of [oldest, middle, third, fourth])
    await cancelD1Pairing(actor, p.pairingId, now, db);
  const cap = {
    userId: "pair-native-cap-parent",
    familyId: "pair-native-cap",
    generation: 0,
  };
  for (let i = 0; i < 5; i++)
    await db
      .prepare(
        "INSERT INTO HouseholdDevice(id,family_id,label,platform) VALUES (?1,'pair-native-cap','Existing','web')",
      )
      .bind("pair-native-cap-" + i)
      .run();
  check(
    !(await createD1Pairing(cap, { label: "No room", now }, db)).ok,
    "five active cap",
  );
  const replacement = await createD1Pairing(
    cap,
    { label: "Replacement", now, replacesDeviceId: "pair-native-cap-0" },
    db,
  );
  check(replacement.ok, "replace allowed at cap");
  const replacementClaim = await claim(replacement.code);
  check(
    (
      await confirmD1Pairing(
        cap,
        {
          pairingId: replacement.pairingId,
          digits: replacementClaim.confirmDigits,
          now,
        },
        db,
      )
    ).kind === "confirmed",
    "replacement confirm",
  );
  const oldSession = prepareD1DeviceSession(
    db,
    "pair-native-cap-0",
    "pair-native-cap",
    now,
  );
  await db.batch(oldSession.statements);
  await db
    .prepare(
      `CREATE TRIGGER pairing_audit_rollback BEFORE INSERT ON AuditLog WHEN NEW.family_id='pair-native-cap' BEGIN SELECT RAISE(ABORT,'fixture rollback'); END`,
    )
    .run();
  let rolled = false;
  try {
    await issueD1PairedDevice(replacementClaim.claimToken, now, db);
  } catch {
    rolled = true;
  }
  await db.prepare("DROP TRIGGER pairing_audit_rollback").run();
  check(
    rolled &&
      (await pairingRow(replacement.pairingId)).device_id === null &&
      (
        await resolveD1DeviceAccess(
          { access: oldSession.tokens.accessToken },
          now,
          db,
        )
      ).ok,
    "replacement audit failure restores old session and pairing",
  );
  const replaceIssued = await issueD1PairedDevice(
    replacementClaim.claimToken,
    now,
    db,
  );
  check(
    replaceIssued.kind === "paired" &&
      replaceIssued.replacedDeviceId === "pair-native-cap-0" &&
      (await count(
        "HouseholdDevice",
        "family_id='pair-native-cap' AND revoked_at IS NULL",
      )) === 5 &&
      (await count("AuditLog", "family_id='pair-native-cap'")) === 2,
    "atomic replace and two audits",
  );
  const oldDenied = await resolveD1DeviceAccess(
    { access: oldSession.tokens.accessToken },
    now,
    db,
  );
  check(
    !oldDenied.ok && oldDenied.code === "DEVICE_REVOKED",
    "old replacement credential revoked",
  );
  const foreignReplace = await createD1Pairing(
    actor,
    { label: "Foreign replace", now, replacesDeviceId: "pair-native-cap-1" },
    db,
  );
  check(
    !foreignReplace.ok && foreignReplace.code === "REPLACE_NOT_FOUND",
    "foreign replace missing",
  );
  const racePair = await pair("Issue race"),
    raceClaim = await claim(racePair.code);
  await confirm(racePair.pairingId, raceClaim.confirmDigits);
  const beforeDevices = await count("HouseholdDevice");
  const cancelledRace = await issueD1PairedDevice(
    raceClaim.claimToken,
    now,
    racing(
      `UPDATE DevicePairing SET cancelled_at=${now.getTime()} WHERE id='${racePair.pairingId}'`,
    ),
  );
  check(
    cancelledRace.kind === "cancelled" &&
      (await count("HouseholdDevice")) === beforeDevices,
    "cancel before issue batch",
  );
  const rolePair = await pair("Parent leaves"),
    roleClaim = await claim(rolePair.code);
  await confirm(rolePair.pairingId, roleClaim.confirmDigits);
  const roleDenied = await issueD1PairedDevice(
    roleClaim.claimToken,
    now,
    racing(`UPDATE User SET role='teen' WHERE id='pair-native-parent'`),
  );
  check(
    roleDenied.kind === "expired" &&
      (await count("HouseholdDevice")) === beforeDevices,
    "confirmation parent role must remain current",
  );
  await db
    .prepare(`UPDATE User SET role='parent' WHERE id='pair-native-parent'`)
    .run();
  await cancelD1Pairing(actor, rolePair.pairingId, now, db);
  let rejected = false;
  try {
    await createD1Pairing(
      { ...actor, userId: "pair-native-teen" },
      { label: "Forbidden", now },
      db,
    );
  } catch (e) {
    rejected = e instanceof D1DeviceManagerRefused && e.status === 403;
  }
  check(rejected, "teen cannot manage");
  const renewPair = await pair("Renew confirm"),
    renewClaim = await claim(renewPair.code);
  let renewal = false;
  try {
    await confirmD1Pairing(
      actor,
      { pairingId: renewPair.pairingId, digits: renewClaim.confirmDigits, now },
      racing(`UPDATE User SET token_version=1 WHERE id='pair-native-parent'`),
    );
  } catch (e) {
    renewal = e instanceof D1DeviceManagerRefused && e.status === 401;
  }
  check(
    renewal && (await pairingRow(renewPair.pairingId)).confirmed_at === null,
    "generation revoked before confirmation",
  );
  await db
    .prepare(`UPDATE User SET token_version=0 WHERE id='pair-native-parent'`)
    .run();
  const tokenLookup = await findD1PairingByClaimToken(
    renewClaim.claimToken,
    db,
  );
  check(
    tokenLookup?.id === renewPair.pairingId &&
      (await findD1PairingByClaimToken("unknown", db)) === null,
    "claim lookup",
  );
  await db
    .prepare(
      `INSERT INTO Family(id,name,invite_code) VALUES ('pair-native-concurrent','Concurrent','pair-native-concurrent');`,
    )
    .run();
  await db
    .prepare(
      `INSERT INTO User(id,email,name,role,family_id) VALUES ('pair-native-concurrent-parent','pair-native-concurrent-parent@example.test','Parent','parent','pair-native-concurrent')`,
    )
    .run();
  // Rehearse the issuance backstop against retained confirmed reservations:
  // even an over-reserved imported/legacy state cannot exceed five devices.
  const concurrentTokens = Array.from({ length: 8 }, () =>
    generateDeviceToken("p"),
  );
  for (let i = 0; i < concurrentTokens.length; i++)
    await db
      .prepare(
        `INSERT INTO DevicePairing(id,family_id,code_hash,label,created_by,expires_at,claimed_at,claim_token_hash,confirmed_at,confirmed_by) VALUES (?1,'pair-native-concurrent',?1,'Concurrent tablet','pair-native-concurrent-parent',?2,?3,?4,?3,'pair-native-concurrent-parent')`,
      )
      .bind(
        "pair-native-concurrent-" + i,
        now.getTime() + PAIRING_TTL_MS,
        now.getTime(),
        hashToken(concurrentTokens[i]),
      )
      .run();
  const concurrentIssues = await Promise.all(
    concurrentTokens.map((token) => issueD1PairedDevice(token, now, db)),
  );
  check(
    concurrentIssues.filter((r) => r.kind === "paired").length === 5 &&
      concurrentIssues.filter((r) => r.kind === "limit").length === 3 &&
      (await count(
        "HouseholdDevice",
        "family_id='pair-native-concurrent' AND revoked_at IS NULL",
      )) === 5 &&
      (await count("DeviceSession", "family_id='pair-native-concurrent'")) ===
        5,
    "parallel issuance respects household capacity",
  );
  check(
    (await count(
      "DevicePairing",
      "family_id='pair-native-concurrent' AND device_id IS NULL AND cancelled_at IS NOT NULL",
    )) === 3,
    "capacity failures cancel only their reservation",
  );
  const concurrentActor = {
    userId: "pair-native-concurrent-parent",
    familyId: "pair-native-concurrent",
    generation: 0,
  };
  const capRefusals = await Promise.all(
    Array.from({ length: 8 }, () =>
      createD1Pairing(concurrentActor, { label: "No room", now }, db),
    ),
  );
  check(
    capRefusals.every((r) => !r.ok && r.code === "DEVICE_LIMIT_REACHED"),
    "parallel full-household creates refuse",
  );
  // Retention is household scoped; it never deletes another family's evidence.
  await db
    .prepare(
      `INSERT INTO DevicePairing(id,family_id,code_hash,label,created_by,expires_at) VALUES ('pair-native-retain-a','pair-native-a','retain-a','Old','pair-native-parent',1),('pair-native-retain-b','pair-native-b','retain-b','Old','pair-native-other',1)`,
    )
    .run();
  await readD1DeviceList(actor, now, db);
  check(
    (await pairingRow("pair-native-retain-a")) === null &&
      (await pairingRow("pair-native-retain-b")) !== null,
    "scoped foreground retention",
  );
  return {
    claimRace: 8,
    oneClaim: true,
    hashedCodes: true,
    uniformClaimRefusal: true,
    pendingCannotIssue: true,
    safeParentPoll: true,
    foreignRefusal: true,
    confirmationRace: 8,
    oneConfirmation: true,
    issueRace: 8,
    oneDeviceSessionAudit: true,
    issuedSession: true,
    privateDeviceList: true,
    threeMismatchCancel: true,
    idempotentCancel: true,
    expiry: true,
    superseding: true,
    activeCapacity: true,
    concurrentCapacity: 8,
    fiveDevicesOnly: true,
    atomicReplacement: true,
    replacementAuditRollback: true,
    oldCredentialsRevoked: true,
    foreignReplace: true,
    cancelAtCommit: true,
    parentRoleAtIssue: true,
    teenRefusal: true,
    parentGenerationAtCommit: true,
    claimLookup: true,
    scopedRetention: true,
  };
}
