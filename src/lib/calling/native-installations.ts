import { createHash, randomUUID } from "node:crypto";
import type { D1Store } from "@/lib/cloudflare/database";
import {
  NATIVE_INSTALLATION_LIMIT,
  NATIVE_INSTALLATION_TTL_MS,
  NATIVE_REGISTRATION_WINDOW_MS,
  NATIVE_REVOCATION_HOLD_MS,
  type NativeCallOwner,
  type NativeRegistration,
  sameNativeOwner,
} from "./native-registration-contract";
import {
  nativeTokenAad,
  nativeTokenFingerprint,
  sealNativeToken,
} from "./native-token";

export class NativeInstallationError extends Error {
  constructor(
    public readonly code:
      | "NATIVE_CALL_OWNER_CHANGED"
      | "NATIVE_CALL_COMMAND_EXPIRED"
      | "NATIVE_CALL_REGISTRATION_CONFLICT"
      | "NATIVE_CALL_UNAVAILABLE",
    public readonly status: number,
  ) {
    super(code);
  }
}
type Row = {
  id: string;
  platform: string;
  label: string;
  epoch: string;
  revision: number;
  expires_at: number;
  revoked_at: number | null;
  last_command_id?: string;
  last_command_hash?: string;
};
const publicColumns =
  "i.id,i.platform,i.label,i.epoch,i.revision,i.expires_at,i.revoked_at";
// Repeated inside the write itself: authentication before an await is not a lease.
const authority = `SELECT 1 FROM "User" u JOIN "Family" f ON f.id=u.family_id WHERE u.id=? AND u.family_id=? AND u.token_version=? AND u.role IN ('parent','teen','child') AND json_extract(f.features,'$.calling')=1`;
const values = (owner: NativeCallOwner) => [
  owner.userId,
  owner.familyId,
  owner.generation,
];
const dto = (row: Row) => ({
  installationId: row.id,
  platform: row.platform,
  label: row.label,
  stamp: { epoch: row.epoch, revision: row.revision },
  expiresAt: row.expires_at,
  backgroundRinging: false as const,
  revoked: row.revoked_at !== null,
});
export function assertNativeCommand(issuedAt: number, now: number) {
  if (
    !Number.isSafeInteger(issuedAt) ||
    issuedAt > now + 30_000 ||
    now - issuedAt > NATIVE_REGISTRATION_WINDOW_MS
  )
    throw new NativeInstallationError("NATIVE_CALL_COMMAND_EXPIRED", 410);
}
export async function listNativeInstallations(
  db: D1Store,
  owner: NativeCallOwner,
  now = Date.now(),
) {
  const reply = await db
    .withSession("first-primary")
    .prepare(
      `SELECT ${publicColumns} FROM "NativeCallInstallation" i WHERE i.user_id=? AND i.family_id=? AND i.generation=? AND i.expires_at>? AND i.revoked_at IS NULL AND EXISTS (${authority}) ORDER BY i.updated_at DESC,i.id LIMIT ${NATIVE_INSTALLATION_LIMIT}`,
    )
    .bind(...values(owner), now, ...values(owner))
    .all<Row>();
  return reply.results.map(dto);
}
export async function registerNativeInstallation(
  db: D1Store,
  owner: NativeCallOwner,
  input: NativeRegistration,
  key: string,
  now = Date.now(),
) {
  if (!sameNativeOwner(owner, input.owner))
    throw new NativeInstallationError("NATIVE_CALL_OWNER_CHANGED", 409);
  assertNativeCommand(input.issuedAt, now);
  const epoch = input.expected?.epoch ?? randomUUID();
  const hash = createHash("sha256").update(JSON.stringify(input)).digest("hex");
  const encrypted = sealNativeToken(
    input.token,
    nativeTokenAad(input.installationId, owner, input.platform, {
      epoch,
      revision: (input.expected?.revision ?? 0) + 1,
    }),
    key,
  );
  const fingerprint = nativeTokenFingerprint(input.provider, input.token);
  const session = db.withSession("first-primary");
  const cleanup = session
    .prepare(
      `DELETE FROM "NativeCallInstallation" WHERE user_id=? AND expires_at<=? AND EXISTS (${authority})`,
    )
    .bind(owner.userId, now, ...values(owner));
  const write =
    input.expected === null
      ? session
          .prepare(
            `INSERT INTO "NativeCallInstallation" (id,family_id,user_id,generation,epoch,revision,platform,label,provider,push_token_enc,token_fingerprint,last_command_id,last_command_hash,created_at,updated_at,expires_at) SELECT ?,?,?,?,?,1,?,?,?,?,?,?,?,?,?,? WHERE EXISTS (${authority}) AND (SELECT count(*) FROM "NativeCallInstallation" WHERE user_id=? AND revoked_at IS NULL)<${NATIVE_INSTALLATION_LIMIT} ON CONFLICT DO NOTHING`,
          )
          .bind(
            input.installationId,
            owner.familyId,
            owner.userId,
            owner.generation,
            epoch,
            input.platform,
            input.label,
            input.provider,
            encrypted,
            fingerprint,
            input.commandId,
            hash,
            now,
            now,
            now + NATIVE_INSTALLATION_TTL_MS,
            ...values(owner),
            owner.userId,
          )
      : session
          .prepare(
            `UPDATE "NativeCallInstallation" SET label=?,push_token_enc=?,token_fingerprint=?,revoked_at=NULL,last_command_id=?,last_command_hash=?,revision=revision+1,updated_at=?,expires_at=? WHERE id=? AND user_id=? AND family_id=? AND generation=? AND epoch=? AND revision=? AND platform=? AND provider=? AND last_command_id<>? AND (revoked_at IS NULL OR revoked_at<?) AND EXISTS (${authority})`,
          )
          .bind(
            input.label,
            encrypted,
            fingerprint,
            input.commandId,
            hash,
            now,
            now + NATIVE_INSTALLATION_TTL_MS,
            input.installationId,
            ...values(owner),
            input.expected.epoch,
            input.expected.revision,
            input.platform,
            input.provider,
            input.commandId,
            input.issuedAt,
            ...values(owner),
          );
  const read = session
    .prepare(
      `SELECT ${publicColumns},i.last_command_id,i.last_command_hash FROM "NativeCallInstallation" i WHERE i.id=? AND i.user_id=? AND i.family_id=? AND i.generation=? AND EXISTS (${authority})`,
    )
    .bind(input.installationId, ...values(owner), ...values(owner));
  let results;
  try {
    results = await session.batch<Row>([cleanup, write, read]);
  } catch (error) {
    throw new NativeInstallationError(
      error instanceof Error && /UNIQUE constraint/i.test(error.message)
        ? "NATIVE_CALL_REGISTRATION_CONFLICT"
        : "NATIVE_CALL_UNAVAILABLE",
      error instanceof Error && /UNIQUE constraint/i.test(error.message)
        ? 409
        : 503,
    );
  }
  const row = results[2].results[0];
  if (
    !row ||
    row.revoked_at !== null ||
    row.last_command_id !== input.commandId ||
    row.last_command_hash !== hash
  )
    throw new NativeInstallationError("NATIVE_CALL_REGISTRATION_CONFLICT", 409);
  return dto(row);
}
export async function unregisterNativeInstallation(
  db: D1Store,
  owner: NativeCallOwner,
  id: string,
  stamp: { epoch: string; revision: number },
  now = Date.now(),
) {
  const session = db.withSession("first-primary");
  const result = await session.batch<Row>([
    session
      .prepare(
        `UPDATE "NativeCallInstallation" SET push_token_enc=NULL,revoked_at=?,revision=revision+1,updated_at=?,expires_at=? WHERE revoked_at IS NULL AND id=? AND user_id=? AND family_id=? AND generation=? AND epoch=? AND revision=? AND EXISTS (${authority})`,
      )
      .bind(
        now,
        now,
        now + NATIVE_REVOCATION_HOLD_MS,
        id,
        ...values(owner),
        stamp.epoch,
        stamp.revision,
        ...values(owner),
      ),
    session
      .prepare(
        `SELECT ${publicColumns} FROM "NativeCallInstallation" i WHERE i.id=? AND i.user_id=? AND i.family_id=? AND i.generation=? AND EXISTS (${authority})`,
      )
      .bind(id, ...values(owner), ...values(owner)),
  ]);
  if (result[1].results.some((row) => row.revoked_at === null))
    throw new NativeInstallationError("NATIVE_CALL_REGISTRATION_CONFLICT", 409);
  return result[1].results[0] ? dto(result[1].results[0]) : null;
}

export async function inspectNativeInstallation(
  db: D1Store,
  owner: NativeCallOwner,
  id: string,
  now = Date.now(),
) {
  const row = await db
    .withSession("first-primary")
    .prepare(
      `SELECT ${publicColumns} FROM "NativeCallInstallation" i WHERE i.id=? AND i.user_id=? AND i.family_id=? AND i.generation=? AND i.expires_at>? AND EXISTS (${authority})`,
    )
    .bind(id, ...values(owner), now, ...values(owner))
    .first<Row>();
  return row ? dto(row) : null;
}
