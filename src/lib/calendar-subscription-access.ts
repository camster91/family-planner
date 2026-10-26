/** Original authenticated account boundary for subscription list/create work.
 * This is HTTP actor renewal, not proof of the original browser session packet.
 */
import type { Prisma, PrismaClient } from "@prisma/client";
import { NextResponse } from "next/server";
import { lockUser, lockHousehold } from "@/lib/household-lock";

export type CalendarSubscriptionActor = {
  userId: string;
  familyId: string;
  role: string;
  generation: number;
};
type Mode = "read" | "create";
type Outcome<T> = { kind: "data"; value: T } | { kind: "held" };

export async function withCalendarSubscriptionAccess<T>(
  db: Pick<PrismaClient, "$transaction">,
  original: CalendarSubscriptionActor,
  mode: Mode,
  work: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<Outcome<T>> {
  if (!Number.isSafeInteger(original.generation) || original.generation < 0
    || !(mode === "create" ? ["parent"] : ["parent", "teen"]).includes(original.role)) return { kind: "held" };
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
  }, { timeout: 5000, maxWait: 5000 });
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
    const renewed = await withCalendarSubscriptionAccess(db, original, mode, async () => null);
    return renewed.kind === "held" ? calendarSubscriptionAccessHeld() : response;
  } catch { return calendarSubscriptionAccessHeld(true); }
}
