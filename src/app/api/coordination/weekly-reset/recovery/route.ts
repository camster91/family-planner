import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { authenticateWithFamily } from "@/lib/api-auth";
import {
  boundedRequestText,
  RequestBodyTooLarge,
} from "@/lib/bounded-request-text";
import { authorizeWeeklyReset } from "@/lib/weekly-reset-server";
import { WeeklyResetError } from "@/lib/weekly-reset";
import {
  weeklyResetOwner,
  weeklyResetWritingEnabled,
} from "@/lib/weekly-reset-owner";
import {
  WEEKLY_RESET_RECOVERY,
  WEEKLY_RESET_OWNER_HEADER,
  weeklyResetRecoveryInput,
} from "@/lib/weekly-reset-recovery";
import { reviewWeeklyResetRequest } from "@/lib/weekly-reset-recovery-server";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store" };
async function handle(request: NextRequest, review: boolean) {
  try {
    const [auth, refusal] = await authenticateWithFamily(request);
    if (refusal) {
      refusal.headers.set("Cache-Control", "private, no-store");
      return refusal;
    }
    if (!prisma) throw new WeeklyResetError("UNAVAILABLE");
    const actor = {
      userId: auth.user.id,
      familyId: auth.user.family_id,
      tokenVersion: auth.payload.tv ?? 0,
    };
    const owner = weeklyResetOwner(request, auth.payload, auth.user);
    if (!review) {
      await authorizeWeeklyReset(prisma, actor);
      return NextResponse.json(
        {
          contract: WEEKLY_RESET_RECOVERY,
          enabled: weeklyResetWritingEnabled() && owner !== null,
          owner,
          userId: actor.userId,
          familyId: actor.familyId,
        },
        { headers },
      );
    }
    if (
      !owner ||
      request.headers.get(WEEKLY_RESET_OWNER_HEADER) !== owner.scope
    )
      throw new WeeklyResetError("FORBIDDEN");
    const body = weeklyResetRecoveryInput.safeParse(
      JSON.parse(await boundedRequestText(request, 10000)),
    );
    if (!body.success)
      return NextResponse.json(
        { error: { code: "WEEKLY_RESET_INVALID_REQUEST" } },
        { status: 400, headers },
      );
    return NextResponse.json(
      await reviewWeeklyResetRequest(
        prisma,
        actor,
        body.data.entry,
        owner.scope,
        weeklyResetWritingEnabled(),
      ),
      { headers },
    );
  } catch (error) {
    const code = error instanceof WeeklyResetError ? error.code : "UNAVAILABLE";
    const status =
      error instanceof RequestBodyTooLarge
        ? 413
        : error instanceof SyntaxError
          ? 400
          : code === "UNAUTHORIZED"
            ? 401
            : code === "FORBIDDEN"
              ? 403
              : code === "CONFLICT"
                ? 409
                : 503;
    return NextResponse.json(
      { error: { code: `WEEKLY_RESET_${code}` } },
      { status, headers },
    );
  }
}
export const GET = (request: NextRequest) => handle(request, false);
export const POST = (request: NextRequest) => handle(request, true);
