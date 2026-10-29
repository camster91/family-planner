import type { D1Store } from "./database";

export async function storeD1ResetToken(
  db: D1Store,
  userId: string,
  hash: string,
  expires: number,
): Promise<void> {
  const row = await db
    .prepare(
      'UPDATE "User" SET reset_token=?1,reset_token_expires=?2 WHERE id=?3 RETURNING id',
    )
    .bind(hash, expires, userId)
    .first<{ id: string }>();
  if (!row) throw new Error("Reset account unavailable");
}
export async function d1ResetTokenExists(
  db: D1Store,
  hash: string,
  now: number,
): Promise<boolean> {
  return (
    (await db
      .withSession("first-primary")
      .prepare(
        'SELECT id FROM "User" WHERE reset_token=?1 AND reset_token_expires>?2',
      )
      .bind(hash, now)
      .first()) !== null
  );
}

/** PIN deletion, password replacement, token claim and revocation commit together. */
export async function consumeD1ResetToken(
  db: D1Store,
  hash: string,
  passwordHash: string,
  now: number,
) {
  const session = db.withSession("first-primary");
  const result = await session.batch<{
    user_id: string;
    id: string;
    family_id: string | null;
  }>([
    session
      .prepare(
        `DELETE FROM "ParentElevationPin" WHERE user_id IN
      (SELECT id FROM "User" WHERE reset_token=?1 AND reset_token_expires>?2) RETURNING user_id`,
      )
      .bind(hash, now),
    session
      .prepare(
        `UPDATE "User" SET password=?1,reset_token=NULL,reset_token_expires=NULL,token_version=token_version+1
      WHERE reset_token=?2 AND reset_token_expires>?3 RETURNING id,family_id`,
      )
      .bind(passwordHash, hash, now),
  ]);
  const account = result[1].results[0];
  return {
    consumed: result[1].results.length === 1,
    clearedPin:
      account && result[0].results.some((pin) => pin.user_id === account.id)
        ? { userId: account.id, familyId: account.family_id }
        : null,
  };
}

/** A failed mail send cannot overwrite a newer challenge or a completed claim. */
export async function restoreD1VerificationToken(
  db: D1Store,
  userId: string,
  issuedHash: string,
  previousHash: string | null,
  previousExpires: number | null,
): Promise<void> {
  await db
    .prepare(
      `UPDATE "User" SET verify_token=?1,verify_token_expires=?2
    WHERE id=?3 AND verify_token=?4 AND email_verified=0 AND verify_token_expires IS NOT NULL`,
    )
    .bind(previousHash, previousExpires, userId, issuedHash)
    .run();
}

/** Recheck the verified password/session snapshot after the bcrypt wait. */
export async function changeD1Password(
  db: D1Store,
  userId: string,
  expectedVersion: number,
  oldHash: string,
  newHash: string,
): Promise<boolean> {
  const row = await db
    .prepare(
      `UPDATE "User" SET password=?1,token_version=token_version+1,reset_token=NULL,reset_token_expires=NULL
    WHERE id=?2 AND token_version=?3 AND password=?4 RETURNING id`,
    )
    .bind(newHash, userId, expectedVersion, oldHash)
    .first<{ id: string }>();
  return row !== null;
}
