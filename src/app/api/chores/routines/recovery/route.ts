import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  boundedRequestText,
  RequestBodyTooLarge,
} from "@/lib/bounded-request-text";
import {
  routineScheduleAuthority,
  routineScheduleFailure,
} from "@/lib/routine-schedule-runtime";
import { reviewRoutineSchedule } from "@/lib/routine-schedule-api";
import { ROUTINE_SCHEDULE_MAX_BYTES } from "@/lib/routine-schedule";
import {
  ROUTINE_RECOVERY_CONTRACT,
  routineRecoveryReviewInput,
} from "@/lib/routine-schedule-recovery-contract";
import {
  routineRecoveryWritingEnabled,
  routineDraftOwner,
} from "@/lib/routine-schedule-owner";
import { ROUTINE_DRAFT_CONTRACT } from "@/lib/routine-draft-contract";
import {
  openRoutineSchedule,
  routineResponse,
  routineError,
} from "@/lib/routine-schedule-http";
import { logRouteError } from "@/lib/api-error";
import { getRequestId } from "@/lib/request-id";
export const dynamic = "force-dynamic";
export async function GET(request: NextRequest) {
  try {
    const opened = await openRoutineSchedule(request);
    if (!opened.ok) return opened.response;
    const capabilities = await prisma!.$transaction((tx) =>
      routineScheduleAuthority(tx, opened.actor),
    );
    if (new URL(request.url).searchParams.get("draft") === "1") {
      const owner = routineDraftOwner(opened.owner);
      return routineResponse({
        contract: ROUTINE_DRAFT_CONTRACT,
        enabled: routineRecoveryWritingEnabled() && owner !== null,
        owner,
        pointsEnabled: capabilities.pointsEnabled,
        userId: opened.actor.userId,
        familyId: opened.actor.familyId,
      });
    }
    return routineResponse({
      contract: ROUTINE_RECOVERY_CONTRACT,
      enabled: routineRecoveryWritingEnabled() && opened.owner !== null,
      owner: opened.owner,
      userId: opened.actor.userId,
      familyId: opened.actor.familyId,
    });
  } catch (caught) {
    const refusal = routineScheduleFailure(caught);
    if (refusal) return routineResponse(refusal.body, refusal.status);
    logRouteError("GET routine recovery", caught, getRequestId(request));
    return routineError(500, "ROUTINE_RECOVERY_UNAVAILABLE");
  }
}
export async function POST(request: NextRequest) {
  try {
    const opened = await openRoutineSchedule(request, true);
    if (!opened.ok) return opened.response;
    let raw: unknown;
    try {
      raw = JSON.parse(
        await boundedRequestText(
          request,
          2 * ROUTINE_SCHEDULE_MAX_BYTES + 8192,
        ),
      );
    } catch (caught) {
      return routineError(
        caught instanceof RequestBodyTooLarge ? 413 : 400,
        "INVALID_ROUTINE_REQUEST",
      );
    }
    const parsed = routineRecoveryReviewInput.safeParse(raw);
    if (!parsed.success) return routineError(400, "INVALID_ROUTINE_REQUEST");
    const result = await reviewRoutineSchedule(
      prisma!,
      opened.actor,
      parsed.data.entry,
      opened.owner!.scope,
      routineRecoveryWritingEnabled(),
    );
    return routineResponse(result.body, result.status);
  } catch (caught) {
    logRouteError("POST routine recovery", caught, getRequestId(request));
    return routineError(500, "ROUTINE_RECOVERY_UNAVAILABLE");
  }
}
