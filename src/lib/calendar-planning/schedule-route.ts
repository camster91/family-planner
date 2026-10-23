import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { authenticateWithFamily } from "@/lib/api-auth";
import {
  boundedRequestText,
  RequestBodyTooLarge,
} from "@/lib/bounded-request-text";
import {
  readIdempotencyKey,
  idempotencyError,
  withIdempotency,
} from "@/lib/idempotency";
import {
  ScheduleReviewError,
  scheduleReviewQuery,
  scheduleMoveCommand,
} from "./conflict-review";
import { scheduleReviewScopeClassic as scheduleReviewScope } from "./review-scope-classic";
import {
  authorizeScheduleReceipt,
  readScheduleSnapshot,
  previewScheduleQuery,
} from "./schedule-runtime";
import {
  scheduleReviewOwner,
  scheduleReviewReady,
  scheduleReviewWritingEnabled,
} from "./schedule-owner";
import { scheduleStorageAvailable } from "./schedule-source";
import {
  scheduleReadReply,
  scheduleReceipt,
  scheduleReceiptMatches,
  SCHEDULE_ACTION,
} from "./schedule-http";
import { writeScheduleMove, scheduleFailure } from "./schedule-server";
import {
  SCHEDULE_RECOVERY,
  SCHEDULE_OWNER_HEADER,
  scheduleRecoveryContext,
  scheduleRecoveryInput,
} from "./schedule-recovery";
import { reviewScheduleRequest } from "./schedule-recovery-server";
export type ScheduleHttpMode =
  "read" | "preview" | "write" | "context" | "inspect";
const headers = { "Cache-Control": "private, no-store" };
const paramsSchema = z
  .object({
    targetId: z.string(),
    start: z.string(),
    end: z.string(),
    timeZone: z.string(),
  })
  .strict();
export async function handleScheduleHttp(
  request: NextRequest,
  mode: ScheduleHttpMode,
) {
  try {
    const [auth, refusal] = await authenticateWithFamily(request);
    if (refusal) {
      refusal.headers.set("Cache-Control", "private, no-store");
      return refusal;
    }
    if (!prisma) throw new ScheduleReviewError("UNAVAILABLE");
    const actor = {
      userId: auth.user.id,
      familyId: auth.user.family_id,
      tokenVersion: auth.payload.tv ?? 0,
    };
    const current = await authorizeScheduleReceipt(prisma, actor);
    const owner = scheduleReviewOwner(request, auth.payload, {
      ...auth.user,
      role: current.role,
    });
    if (mode === "context")
      return NextResponse.json(
        scheduleRecoveryContext.parse({
          contract: SCHEDULE_RECOVERY,
          enabled:
            current.role === "parent" &&
            current.calendarEnabled &&
            scheduleReviewWritingEnabled() &&
            owner !== null &&
            (await scheduleStorageAvailable(prisma)),
          owner,
          userId: actor.userId,
          familyId: actor.familyId,
          role: current.role,
        }),
        { headers },
      );
    if (mode === "inspect") {
      if (!owner || request.headers.get(SCHEDULE_OWNER_HEADER) !== owner.scope)
        throw new ScheduleReviewError("FORBIDDEN");
      const input = scheduleRecoveryInput.parse(
        JSON.parse(await boundedRequestText(request, 65536)),
      );
      return NextResponse.json(
        await reviewScheduleRequest(prisma, actor, input.entry, owner.scope),
        { headers },
      );
    }
    if (!scheduleReviewReady()) throw new ScheduleReviewError("UNAVAILABLE");
    if (mode === "read") {
      const params = request.nextUrl.searchParams;
      if (new Set(params.keys()).size !== [...params.keys()].length)
        throw new ScheduleReviewError("INVALID");
      const query = paramsSchema.parse(Object.fromEntries(params));
      const scope = scheduleReviewScope.parse({
        targetId: query.targetId,
        range: { start: query.start, end: query.end },
        timeZone: query.timeZone,
      });
      return NextResponse.json(
        scheduleReadReply.parse(
          await readScheduleSnapshot(prisma, actor, scope),
        ),
        { headers },
      );
    }
    if (mode === "preview") {
      const query = scheduleReviewQuery.parse(
        JSON.parse(await boundedRequestText(request, 32768)),
      );
      return NextResponse.json(
        scheduleReadReply.parse(
          await previewScheduleQuery(prisma, actor, query),
        ),
        { headers },
      );
    }
    if (
      !scheduleReviewWritingEnabled() ||
      !owner ||
      request.headers.get(SCHEDULE_OWNER_HEADER) !== owner.scope
    )
      throw new ScheduleReviewError("FORBIDDEN");
    const { key, error } = readIdempotencyKey(request);
    if (error) return error;
    if (!key) return idempotencyError("IDEMPOTENCY_KEY_REQUIRED");
    const command = scheduleMoveCommand.parse(
      JSON.parse(await boundedRequestText(request, 32768)),
    );
    if (
      command.owner.userId !== actor.userId ||
      command.owner.familyId !== actor.familyId
    )
      throw new ScheduleReviewError("FORBIDDEN");
    const response = await withIdempotency(
      prisma,
      key,
      {
        scope: `user:${actor.userId}`,
        userId: actor.userId,
        familyId: actor.familyId,
        action: SCHEDULE_ACTION,
      },
      command,
      async ({ recordId }) => {
        if (!recordId) return scheduleFailure(new ScheduleReviewError("STALE"));
        try {
          return await writeScheduleMove(
            prisma!,
            actor,
            command,
            key,
            recordId,
          );
        } catch (error) {
          return scheduleFailure(error);
        }
      },
      {
        beforeReplay: async () => {
          try {
            await authorizeScheduleReceipt(prisma!, actor);
            return null;
          } catch (error) {
            return scheduleFailure(error);
          }
        },
        transformReplay: async (result) =>
          result.status === 200 &&
          scheduleReceiptMatches(result.body, command, key)
            ? { status: 200, body: scheduleReceipt.parse(result.body) }
            : scheduleFailure(new ScheduleReviewError("UNSUPPORTED")),
      },
    );
    response.headers.set("Cache-Control", "private, no-store");
    return response;
  } catch (error) {
    if (
      error instanceof SyntaxError ||
      error instanceof z.ZodError ||
      error instanceof RequestBodyTooLarge
    )
      return NextResponse.json(
        { error: { code: "SCHEDULE_REVIEW_INVALID_REQUEST" } },
        { status: error instanceof RequestBodyTooLarge ? 413 : 400, headers },
      );
    const result = scheduleFailure(error);
    return NextResponse.json(result.body, { status: result.status, headers });
  }
}
