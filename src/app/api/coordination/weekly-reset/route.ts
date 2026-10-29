import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { storageBackend } from "@/lib/storage-backend";
import { getD1Database } from "@/lib/cloudflare/database";
import {
  readD1WeeklyReset,
  writeD1WeeklyReset,
  authorizeD1WeeklyReset,
} from "@/lib/cloudflare/weekly-reset";
import { authenticateWithFamily } from "@/lib/api-auth";
import {
  boundedRequestText,
  RequestBodyTooLarge,
} from "@/lib/bounded-request-text";
import {
  readIdempotencyKey,
  idempotencyError,
  withIdempotency,
  type EffectResult,
} from "@/lib/idempotency";
import {
  weeklyResetReady,
  weeklyResetScope,
  weeklyResetCommand,
  WeeklyResetError,
} from "@/lib/weekly-reset";
import {
  readWeeklyReset,
  writeWeeklyReset,
  authorizeWeeklyReset,
} from "@/lib/weekly-reset-server";
import {
  weeklyResetOwner,
  weeklyResetWritingEnabled,
} from "@/lib/weekly-reset-owner";
import { WEEKLY_RESET_OWNER_HEADER } from "@/lib/weekly-reset-recovery";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store" };
function failure(error: unknown): EffectResult {
  if (error instanceof WeeklyResetError)
    return {
      status:
        error.code === "UNAUTHORIZED"
          ? 401
          : error.code === "FORBIDDEN"
            ? 403
            : error.code === "UNAVAILABLE"
              ? 503
              : 409,
      body: {
        error: {
          code: `WEEKLY_RESET_${error.code}`,
          message:
            "Keep your review and reload its current state before continuing.",
        },
      },
    };
  return {
    status: error instanceof RequestBodyTooLarge ? 413 : 503,
    body: {
      error: {
        code: "WEEKLY_RESET_UNAVAILABLE",
        message:
          "Weekly review is unavailable. Keep your request and check its saved state before retrying.",
      },
    },
  };
}
async function handle(request: NextRequest, write: boolean) {
  try {
    const [auth, error] = await authenticateWithFamily(request);
    if (error) return error;
    if (!weeklyResetReady())
      throw new WeeklyResetError("UNAVAILABLE");
    const actor = {
      userId: auth.user.id,
      familyId: auth.user.family_id,
      role: auth.user.role,
      tokenVersion: auth.payload.tv ?? 0,
    };
    const owner = weeklyResetOwner(request, auth.payload, auth.user);
    if (
      write &&
      (!weeklyResetWritingEnabled() ||
        !owner ||
        request.headers.get(WEEKLY_RESET_OWNER_HEADER) !== owner.scope)
    )
      throw new WeeklyResetError("FORBIDDEN");
    if (!write) {
      const params = request.nextUrl.searchParams;
      if (new Set(params.keys()).size !== [...params.keys()].length)
        return NextResponse.json(
          { error: "Invalid review scope" },
          { status: 400, headers },
        );
      const scope = weeklyResetScope.safeParse(Object.fromEntries(params));
      if (!scope.success)
        return NextResponse.json(
          { error: "Invalid review scope" },
          { status: 400, headers },
        );
      if (storageBackend() === "d1") {
        return NextResponse.json(
          {
            review: await readD1WeeklyReset(
              actor,
              scope.data,
              await getD1Database(),
            ),
          },
          { headers },
        );
      }
      if (!prisma) throw new WeeklyResetError("UNAVAILABLE");
      return NextResponse.json(
        { review: await readWeeklyReset(prisma, actor, scope.data) },
        { headers },
      );
    }
    const { key, error: keyError } = readIdempotencyKey(request);
    if (keyError) return keyError;
    if (!key) return idempotencyError("IDEMPOTENCY_KEY_REQUIRED");
    let body: unknown;
    try {
      body = JSON.parse(await boundedRequestText(request, 4000));
    } catch (caught) {
      if (caught instanceof RequestBodyTooLarge) throw caught;
      return NextResponse.json(
        { error: "Invalid review request" },
        { status: 400, headers },
      );
    }
    const parsed = weeklyResetCommand.safeParse(body);
    if (!parsed.success)
      return NextResponse.json(
        { error: "Invalid review request" },
        { status: 400, headers },
      );
    if (
      parsed.data.familyId !== actor.familyId ||
      parsed.data.userId !== actor.userId
    )
      throw new WeeklyResetError("FORBIDDEN");
    if (storageBackend() === "d1") {
      const result = await writeD1WeeklyReset(
        actor,
        parsed.data,
        key,
        await getD1Database(),
      );
      return NextResponse.json(result.body, {
        status: result.status,
        headers: {
          ...headers,
          ...(result.replayed ? { "Idempotency-Replayed": "true" } : {}),
        },
      });
    }
    if (!prisma) throw new WeeklyResetError("UNAVAILABLE");
    return await withIdempotency(
      prisma,
      key,
      {
        scope: `user:${actor.userId}`,
        userId: actor.userId,
        familyId: actor.familyId,
        action: "weekly-reset.progress.v1",
      },
      parsed.data,
      async ({ recordId }) => {
        if (!recordId)
          return {
            status: 400,
            body: { error: "A saved request key is required" },
          };
        try {
          return await writeWeeklyReset(prisma!, actor, parsed.data, recordId);
        } catch (caught) {
          return failure(caught);
        }
      },
      {
        beforeReplay: async () => {
          try {
            await authorizeWeeklyReset(prisma!, actor);
            return null;
          } catch (caught) {
            return failure(caught);
          }
        },
      },
    );
  } catch (caught) {
    const result = failure(caught);
    return NextResponse.json(result.body, { status: result.status, headers });
  }
}
export const GET = (request: NextRequest) => handle(request, false);
export const PATCH = (request: NextRequest) => handle(request, true);
