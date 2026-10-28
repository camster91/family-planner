/** Original authenticated account boundary for subscription collection and management work.
 * This is HTTP actor renewal, not proof of the original browser session packet.
 */
import { storageBackend } from "@/lib/storage-backend";
import { renewD1CalendarSubscriptionActor } from "@/lib/cloudflare/calendar-subscriptions";
import type { Prisma, PrismaClient } from "@prisma/client";
import { NextResponse } from "next/server";
import { lockUser, lockHousehold } from "@/lib/household-lock";

export type CalendarSubscriptionActor = {
  userId: string;
  familyId: string;
  role: string;
  generation: number;
};
type Mode = "read" | "create" | "manage" | "refresh";
type Outcome<T> = { kind: "data"; value: T } | { kind: "held" };

export async function withCalendarSubscriptionAccess<T>(
  db: Pick<PrismaClient, "$transaction">,
  original: CalendarSubscriptionActor,
  mode: Mode,
  work: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<Outcome<T>> {
  if (!Number.isSafeInteger(original.generation) || original.generation < 0
    || !(["read", "refresh"].includes(mode) ? ["parent", "teen"] : ["parent"]).includes(original.role)) return { kind: "held" };
  return db.$transaction(async tx => {
    await lockUser(tx, original.userId);
    await lockHousehold(tx, original.familyId);
    const users = await tx.$queryRaw<Array<{ id: string; family_id: string | null; role: string; token_version: number }>>`
      SELECT "id", "family_id", "role", "token_version" FROM "User" WHERE "id" = ${original.userId} FOR SHARE`;
    const current = users[0];
    if (users.length !== 1 || current.family_id !== original.familyId
      || current.role !== original.role || current.token_version !== original.generation) return { kind: "held" as const };
    const families = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT "id" FROM "Family" WHERE "id" = ${original.familyId} FOR SHARE`;
    if (families.length !== 1) return { kind: "held" as const };
    return { kind: "data" as const, value: await work(tx) };
  }, { timeout: mode === "refresh" ? 30_000 : 5000, maxWait: 5000,
    ...(mode === "refresh" ? { isolationLevel: "RepeatableRead" as const } : {}) });
}

export function calendarSubscriptionAccessHeld(unconfirmed = false): NextResponse {
  return NextResponse.json({
    error: "Calendar access could not be confirmed. A requested change may already have saved.",
    code: unconfirmed ? "CALENDAR_SUBSCRIPTION_ACCESS_UNCONFIRMED" : "CALENDAR_SUBSCRIPTION_ACCESS_CHANGED",
  }, { status: unconfirmed ? 503 : 401, headers: { "Cache-Control": "private, no-store" } });
}

/** Renew once more after reads/effects; a held success may already have committed. */
export async function protectCalendarSubscriptionResponse(
  db: Pick<PrismaClient, "$transaction">,
  original: CalendarSubscriptionActor,
  mode: Mode,
  response: NextResponse,
): Promise<NextResponse> {
  response.headers.set("Cache-Control", "private, no-store");
  if (!response.ok) return response;
  try {
    const renewed = storageBackend() === "d1"
      ? { kind: await renewD1CalendarSubscriptionActor(original, mode) ? "data" : "held" }
      : await withCalendarSubscriptionAccess(db, original, mode, async () => null);
    return renewed.kind === "held" ? calendarSubscriptionAccessHeld() : response;
  } catch { return calendarSubscriptionAccessHeld(true); }
}

/** Lock the existing original-family target after principal/household admission. */
export async function lockCalendarSubscriptionInTx(
  tx: Prisma.TransactionClient, subscriptionId: string, familyId: string,
): Promise<boolean> {
  const rows = await tx.$queryRaw<Array<{ id: string }>>`
    SELECT "id" FROM "CalendarSubscription" WHERE "id" = ${subscriptionId} AND "family_id" = ${familyId} FOR UPDATE`;
  return rows.length === 1 && rows[0].id === subscriptionId;
}
