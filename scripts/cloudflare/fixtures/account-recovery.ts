import { createHash } from "node:crypto";
import {
  consumeD1ResetToken,
  d1ResetTokenExists,
  changeD1Password,
  restoreD1VerificationToken,
  storeD1ResetToken,
} from "../../../src/lib/cloudflare/account-recovery";
import {
  consumeD1VerificationToken,
  isD1VerificationTokenUsed,
  storeD1VerificationToken,
  revokeD1UserSessions,
} from "../../../src/lib/cloudflare/accounts";
import type { D1Store } from "../../../src/lib/cloudflare/database";

function check(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}

function digest(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

/**
 * Native D1 auth recovery fixture. It intentionally does not send mail or
 * call a provider: the route owns transport, while these helpers own the
 * hashed-token, expiry, single-use and session-generation boundaries.
 */
export async function testAccountRecovery(db: D1Store) {
  const now = 1_000_000;
  await db.batch([
    db.prepare(
      `INSERT INTO "Family" (id,name,invite_code) VALUES ('auth-recovery-family','Recovery fixture','auth-recovery-code')`,
    ),
    db.prepare(`INSERT INTO "User" (id,email,name,role,family_id,password,email_verified,token_version)
      VALUES ('auth-recovery-user','auth-recovery@example.test','Recovery User','parent','auth-recovery-family','old-password-hash',0,0)`),
    db.prepare(
      `INSERT INTO "ParentElevationPin" (user_id,family_id,pin_hash) VALUES ('auth-recovery-user','auth-recovery-family','old-pin-hash')`,
    ),
  ]);

  const resetHash = digest("auth-recovery-reset");
  await storeD1ResetToken(db, "auth-recovery-user", resetHash, now + 5_000);
  check(
    await d1ResetTokenExists(db, resetHash, now),
    "live reset token lookup",
  );
  check(
    !(await d1ResetTokenExists(db, digest("unknown-reset"), now)),
    "unknown reset token hidden",
  );
  const claims = await Promise.all(
    Array.from({ length: 8 }, () =>
      consumeD1ResetToken(db, resetHash, "replacement-password-hash", now),
    ),
  );
  check(
    claims.filter((result) => result.consumed).length === 1,
    "reset token is single-use",
  );
  check(
    claims.find((result) => result.consumed)?.clearedPin?.userId ===
      "auth-recovery-user",
    "reset clears PIN",
  );
  check(
    !(await d1ResetTokenExists(db, resetHash, now)),
    "consumed reset token is unavailable",
  );
  check(
    (
      await db
        .prepare(
          `SELECT count(*) AS count FROM "ParentElevationPin" WHERE user_id='auth-recovery-user'`,
        )
        .first<{ count: number }>()
    )?.count === 0,
    "reset PIN deletion",
  );
  check(
    (
      await db
        .prepare(
          `SELECT token_version,password FROM "User" WHERE id='auth-recovery-user'`,
        )
        .first<{ token_version: number; password: string }>()
    )?.token_version === 1,
    "reset increments session generation",
  );
  check(
    (await changeD1Password(
      db,
      "auth-recovery-user",
      0,
      "old-password-hash",
      "stale-change",
    )) === false,
    "stale password change refused",
  );
  check(
    await changeD1Password(
      db,
      "auth-recovery-user",
      1,
      "replacement-password-hash",
      "new-password-hash",
    ),
    "current password change accepted",
  );
  check(
    (await changeD1Password(
      db,
      "auth-recovery-user",
      1,
      "replacement-password-hash",
      "raced-password-hash",
    )) === false,
    "password change is compare-and-set",
  );

  const expiredHash = digest("expired-reset");
  await storeD1ResetToken(db, "auth-recovery-user", expiredHash, now - 1);
  check(
    !(await d1ResetTokenExists(db, expiredHash, now)),
    "expired reset token refused",
  );

  await db
    .prepare(`UPDATE "User" SET email_verified=0 WHERE id='auth-recovery-user'`)
    .run();
  const verifyHash = digest("auth-recovery-verify");
  await storeD1VerificationToken(
    db,
    "auth-recovery-user",
    verifyHash,
    now + 5_000,
  );
  const verifications = await Promise.all(
    Array.from({ length: 8 }, () =>
      consumeD1VerificationToken(db, verifyHash, now),
    ),
  );
  check(
    verifications.filter(Boolean).length === 1,
    "verification token is single-use",
  );
  check(
    await isD1VerificationTokenUsed(db, verifyHash),
    "used verification token is replay-safe",
  );
  check(
    (await consumeD1VerificationToken(db, verifyHash, now)) === false,
    "verification replay refused",
  );

  // The resend path is only available while the account remains unverified.
  // The single-use verification assertions above intentionally mark this
  // fixture account verified, so reset that state before modelling a failed
  // delivery of a replacement challenge.
  await db
    .prepare(`UPDATE "User" SET email_verified=0 WHERE id='auth-recovery-user'`)
    .run();

  await storeD1VerificationToken(
    db,
    "auth-recovery-user",
    "issued-verification-hash",
    now + 5_000,
  );
  await restoreD1VerificationToken(
    db,
    "auth-recovery-user",
    "issued-verification-hash",
    "prior-verification-hash",
    now + 4_000,
  );
  const restored = await db
    .prepare(
      `SELECT verify_token,verify_token_expires FROM "User" WHERE id='auth-recovery-user'`,
    )
    .first<{ verify_token: string; verify_token_expires: number }>();
  check(
    restored?.verify_token === "prior-verification-hash" &&
      restored.verify_token_expires === now + 4_000,
    "failed resend restores prior challenge",
  );
  await storeD1VerificationToken(
    db,
    "auth-recovery-user",
    "newer-verification-hash",
    now + 6_000,
  );
  await restoreD1VerificationToken(
    db,
    "auth-recovery-user",
    "issued-verification-hash",
    "stale-prior-hash",
    now + 4_000,
  );
  check(
    (
      await db
        .prepare(
          `SELECT verify_token FROM "User" WHERE id='auth-recovery-user'`,
        )
        .first<{ verify_token: string }>()
    )?.verify_token === "newer-verification-hash",
    "stale resend cannot overwrite newer challenge",
  );

  const beforeLogout = await db
    .prepare(`SELECT token_version FROM "User" WHERE id='auth-recovery-user'`)
    .first<{ token_version: number }>();
  check(beforeLogout, "logout fixture account exists");
  const logoutRace = await Promise.all(
    Array.from({ length: 4 }, () =>
      revokeD1UserSessions(
        db,
        "auth-recovery-user",
        beforeLogout.token_version,
      ),
    ),
  );
  check(
    logoutRace.filter(Boolean).length === 1,
    "one current-generation logout wins",
  );
  check(
    !(await revokeD1UserSessions(
      db,
      "auth-recovery-user",
      beforeLogout.token_version,
    )),
    "stale logout cannot revoke a newer session",
  );
  check(
    !(await revokeD1UserSessions(db, "auth-recovery-missing", 0)),
    "missing logout account is a no-op",
  );
  const afterLogout = await db
    .prepare(`SELECT token_version FROM "User" WHERE id='auth-recovery-user'`)
    .first<{ token_version: number }>();
  check(
    afterLogout?.token_version === beforeLogout.token_version + 1,
    "logout revokes exactly the prior generation",
  );
  return {
    resetSingleUse: true,
    expiry: true,
    pinCleared: true,
    sessionGeneration: true,
    passwordCompareAndSet: true,
    verificationSingleUse: true,
    verificationReplay: true,
    resendRestore: true,
    logoutGenerationRace: true,
  };
}
