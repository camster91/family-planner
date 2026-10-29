import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { storageBackend } from "@/lib/storage-backend";
import { getD1Database } from "@/lib/cloudflare/database";
import { authenticateWithFamily } from "@/lib/api-auth";
import { WeeklyResetError, weeklyResetReady } from "@/lib/weekly-reset";
import { weeklyResetSummaryQuery } from "@/lib/weekly-reset-summary";
import { readWeeklyResetSummary } from "@/lib/weekly-reset-server";
import { readD1WeeklyResetSummary } from "@/lib/cloudflare/weekly-reset";

export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store" };
export async function GET(request: NextRequest) {
  try {
    const [auth, refusal] = await authenticateWithFamily(request);
    if (refusal) {
      refusal.headers.set("Cache-Control", "private, no-store");
      return refusal;
    }
    if (!weeklyResetReady())
      throw new WeeklyResetError("UNAVAILABLE");
    const params = request.nextUrl.searchParams;
    const parsed = weeklyResetSummaryQuery.safeParse(
      Object.fromEntries(params),
    );
    if (
      new Set(params.keys()).size !== [...params.keys()].length ||
      !parsed.success
    )
      return NextResponse.json(
        { error: { code: "WEEKLY_RESET_INVALID_SCOPE" } },
        { status: 400, headers },
      );
    const { step, ...scope } = parsed.data;
    if (storageBackend() === "d1") {
      const summary = await readD1WeeklyResetSummary(
        {
          userId: auth.user.id,
          familyId: auth.user.family_id,
          role: auth.user.role,
          tokenVersion: auth.payload.tv ?? 0,
        },
        scope,
        step,
        new Date(),
        await getD1Database(),
      );
      return NextResponse.json({ summary }, { headers });
    }
    if (!prisma) throw new WeeklyResetError("UNAVAILABLE");
    const summary = await readWeeklyResetSummary(
      prisma,
      {
        userId: auth.user.id,
        familyId: auth.user.family_id,
        tokenVersion: auth.payload.tv ?? 0,
      },
      scope,
      step,
    );
    return NextResponse.json({ summary }, { headers });
  } catch (error) {
    const code = error instanceof WeeklyResetError ? error.code : "UNAVAILABLE";
    const status =
      code === "UNAUTHORIZED"
        ? 401
        : code === "FORBIDDEN" || code === "STEP_UNAVAILABLE"
          ? 403
          : 503;
    return NextResponse.json(
      { error: { code: `WEEKLY_RESET_${code}` } },
      { status, headers },
    );
  }
}
