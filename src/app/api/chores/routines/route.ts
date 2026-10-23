import type { NextRequest } from "next/server";
import { ZodError } from "zod";
import { prisma } from "@/lib/prisma";
import { readIdempotencyKey } from "@/lib/idempotency";
import {
  boundedRequestText,
  RequestBodyTooLarge,
} from "@/lib/bounded-request-text";
import { ROUTINE_SCHEDULE_MAX_BYTES } from "@/lib/routine-schedule";
import { readRoutineSchedule } from "@/lib/routine-schedule-runtime";
import { readRoutineScheduleCatalog } from "@/lib/routine-schedule-catalog";
import { saveRoutineSchedule } from "@/lib/routine-schedule-api";
import { routineRecoveryWritingEnabled } from "@/lib/routine-schedule-owner";
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
    const stackId = new URL(request.url).searchParams.get("stack_id");
    if (stackId === null) {
      const result = await readRoutineScheduleCatalog(
        prisma!,
        opened.actor,
        new URL(request.url).searchParams.get("cursor"),
      );
      return routineResponse(result.body, result.status);
    }
    if (!stackId || stackId.length > 128)
      return routineError(400, "INVALID_QUERY");
    const result = await readRoutineSchedule(prisma!, opened.actor, stackId);
    return routineResponse(result.body, result.status);
  } catch (caught) {
    logRouteError("GET /api/chores/routines", caught, getRequestId(request));
    return routineError(500, "ROUTINE_SCHEDULE_UNAVAILABLE");
  }
}
export async function POST(request: NextRequest) {
  try {
    const opened = await openRoutineSchedule(request, true);
    if (!opened.ok) return opened.response;
    const { key, error } = readIdempotencyKey(request);
    if (error) {
      error.headers.set("Cache-Control", "private, no-store");
      return error;
    }
    if (!key) return routineError(400, "IDEMPOTENCY_KEY_REQUIRED");
    let body: unknown;
    try {
      body = JSON.parse(
        await boundedRequestText(request, ROUTINE_SCHEDULE_MAX_BYTES),
      );
    } catch (caught) {
      return routineError(
        caught instanceof RequestBodyTooLarge ? 413 : 400,
        "INVALID_ROUTINE_REQUEST",
      );
    }
    const result = await saveRoutineSchedule(
      prisma!,
      opened.actor,
      body,
      key,
      new Date(),
      routineRecoveryWritingEnabled(),
    );
    return routineResponse(result.body, result.status);
  } catch (caught) {
    if (caught instanceof ZodError)
      return routineError(400, "INVALID_ROUTINE_REQUEST");
    logRouteError("POST /api/chores/routines", caught, getRequestId(request));
    return routineError(500, "ROUTINE_CONFIRMATION_UNAVAILABLE");
  }
}
