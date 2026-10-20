import type { Prisma, PrismaClient } from "@prisma/client";
import { lockUser, lockHousehold } from "@/lib/household-lock";
import { normalizeFeatures } from "@/lib/features";
import type { EffectResult } from "@/lib/idempotency";
import { loadWeeklyResetSummaryInTx } from "@/lib/weekly-reset-summary";
import {
  WEEKLY_RESET_PROTOCOL,
  WeeklyResetError,
  weeklyResetRecord,
  weeklyResetReceipt,
  weeklyResetSections,
  weeklyResetMatches,
  planWeeklyReset,
  type WeeklyResetRecord,
  type WeeklyResetScope,
  type WeeklyResetCommand,
  type WeeklyResetStep,
} from "@/lib/weekly-reset";
export type WeeklyResetActor = {
  userId: string;
  familyId: string;
  tokenVersion: number;
};
type Row = {
  id: string;
  family_id: string | null;
  role: string;
  token_version: number;
  email_verified: boolean;
  progress: unknown;
  revision: number;
};
export async function weeklyResetActorInTx(
  tx: Prisma.TransactionClient,
  actor: WeeklyResetActor,
) {
  await lockUser(tx, actor.userId);
  await lockHousehold(tx, actor.familyId);
  const rows = await tx.$queryRaw<
    Row[]
  >`SELECT "id", "family_id", "role", "token_version", "email_verified",
    "weekly_reset_progress" AS progress, "weekly_reset_revision" AS revision
    FROM "User" WHERE "id" = ${actor.userId} FOR UPDATE`;
  const user = rows[0];
  if (!user || user.token_version !== actor.tokenVersion)
    throw new WeeklyResetError("UNAUTHORIZED");
  if (
    user.family_id !== actor.familyId ||
    !["parent", "teen", "child"].includes(user.role)
  )
    throw new WeeklyResetError("FORBIDDEN");
  const family = await tx.family.findUnique({
    where: { id: actor.familyId },
    select: { features: true },
  });
  if (!family) throw new WeeklyResetError("FORBIDDEN");
  return { user, features: normalizeFeatures(family.features) };
}
export function readWeeklyResetSummary(
  db: PrismaClient,
  actor: WeeklyResetActor,
  scope: WeeklyResetScope,
  step: WeeklyResetStep,
) {
  return db.$transaction(async (tx) => {
    const { user, features } = await weeklyResetActorInTx(tx, actor);
    return loadWeeklyResetSummaryInTx(
      tx,
      {
        userId: user.id,
        familyId: actor.familyId,
        role: user.role,
        emailVerified: user.email_verified === true,
      },
      features,
      scope,
      step,
    );
  });
}
function recordFrom(row: Row): WeeklyResetRecord | null {
  if (!Number.isInteger(row.revision) || row.revision < 0)
    throw new WeeklyResetError("UNSUPPORTED");
  if (row.progress == null) return null;
  const parsed = weeklyResetRecord.safeParse(row.progress);
  if (!parsed.success) throw new WeeklyResetError("UNSUPPORTED");
  return parsed.data;
}
export function authorizeWeeklyReset(
  db: PrismaClient,
  actor: WeeklyResetActor,
) {
  return db.$transaction(async (tx) => {
    await weeklyResetActorInTx(tx, actor);
  });
}
export function readWeeklyReset(
  db: PrismaClient,
  actor: WeeklyResetActor,
  scope: WeeklyResetScope,
) {
  return db.$transaction(async (tx) => {
    const { user, features } = await weeklyResetActorInTx(tx, actor);
    const stored = recordFrom(user);
    const record = weeklyResetMatches(stored, actor.familyId, scope)
      ? stored
      : null;
    const steps = weeklyResetSections(user.role, features).map((section) => ({
      ...section,
      state: record?.steps[section.id] ?? "pending",
    }));
    return {
      protocol: WEEKLY_RESET_PROTOCOL,
      owner: { userId: user.id, familyId: actor.familyId },
      scope,
      revision: user.revision,
      started: record !== null,
      steps,
      finishedAt: record?.finishedAt ?? null,
      complete:
        record?.finishedAt != null &&
        steps.every((step) => step.state !== "pending"),
    };
  });
}
/** The progress effect and its minimal receipt commit together. Receipts contain
 * no route/step/household records; clients read a fresh role-filtered snapshot. */
export function writeWeeklyReset(
  db: PrismaClient,
  actor: WeeklyResetActor,
  command: WeeklyResetCommand,
  recordId: string,
  now = new Date(),
): Promise<EffectResult> {
  return db.$transaction(async (tx) => {
    const { user, features } = await weeklyResetActorInTx(tx, actor);
    if (command.familyId !== actor.familyId || command.userId !== actor.userId)
      throw new WeeklyResetError("FORBIDDEN");
    await tx.$queryRaw`SELECT "id" FROM "IdempotencyRecord" WHERE "id" = ${recordId} FOR UPDATE`;
    const receipt = await tx.idempotencyRecord.findFirst({
      where: {
        id: recordId,
        scope: `user:${actor.userId}`,
        user_id: actor.userId,
        family_id: actor.familyId,
        action: "weekly-reset.progress.v1",
      },
      select: { response_status: true, response_body: true },
    });
    if (!receipt)
      return {
        status: 409,
        body: { error: { code: "IDEMPOTENCY_IN_PROGRESS", retryable: true } },
      };
    if (receipt.response_status != null) {
      const parsed = weeklyResetReceipt.safeParse(receipt.response_body);
      if (
        !parsed.success ||
        parsed.data.receipt.familyId !== actor.familyId ||
        parsed.data.receipt.userId !== actor.userId ||
        parsed.data.receipt.weekStart !== command.weekStart ||
        parsed.data.receipt.timeZone !== command.timeZone ||
        parsed.data.receipt.action !== command.action
      )
        throw new WeeklyResetError("UNSUPPORTED");
      return { status: receipt.response_status, body: parsed.data };
    }
    if (user.revision !== command.expectedRevision)
      throw new WeeklyResetError("CONFLICT");
    const age = now.getTime() - Date.parse(command.issuedAt);
    if (age > 15 * 60_000 || age < -60_000)
      throw new WeeklyResetError("CONFLICT");
    const original = recordFrom(user);
    const next = planWeeklyReset(original, command, user.role, features, now);
    const changed = JSON.stringify(original) !== JSON.stringify(next);
    if (changed) {
      if (user.revision >= 2147483647) throw new WeeklyResetError("CONFLICT");
      const count =
        await tx.$executeRaw`UPDATE "User" SET "weekly_reset_progress" = ${JSON.stringify(next)}::jsonb,
        "weekly_reset_revision" = "weekly_reset_revision" + 1
        WHERE "id" = ${actor.userId} AND "family_id" = ${actor.familyId} AND "weekly_reset_revision" = ${user.revision}`;
      if (count !== 1) throw new WeeklyResetError("CONFLICT");
    }
    const body = {
      receipt: {
        protocol: WEEKLY_RESET_PROTOCOL,
        familyId: actor.familyId,
        userId: actor.userId,
        weekStart: command.weekStart,
        timeZone: command.timeZone,
        action: command.action,
        revision: user.revision + (changed ? 1 : 0),
      },
    };
    await tx.idempotencyRecord.update({
      where: { id: recordId },
      data: {
        response_status: 200,
        response_body: body as Prisma.InputJsonObject,
      },
    });
    return { status: 200, body };
  });
}
