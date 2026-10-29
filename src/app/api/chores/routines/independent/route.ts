import type { NextRequest } from "next/server";
import { ZodError } from "zod";
import { prisma } from "@/lib/prisma";
import { readIdempotencyKey } from "@/lib/idempotency";
import {
  boundedRequestText,
  RequestBodyTooLarge,
} from "@/lib/bounded-request-text";
import { ROUTINE_SCHEDULE_MAX_BYTES } from "@/lib/routine-schedule";
import {
  readIndependentRoutineStep,
  readIndependentRoutineCatalog,
  saveIndependentRoutineStep,
} from "@/lib/routine-independent-runtime";
import { routineRecoveryWritingEnabled } from "@/lib/routine-schedule-owner";
import {
  openRoutineSchedule,
  routineResponse,
  routineError,
} from "@/lib/routine-schedule-http";
import { logRouteError } from "@/lib/api-error";
import { getRequestId } from "@/lib/request-id";
import { storageBackend } from "@/lib/storage-backend";
export const dynamic = "force-dynamic";
export async function GET(request: NextRequest) {
  try {
    const opened = await openRoutineSchedule(request, false, "independent");
    if (!opened.ok) return opened.response;
    const rootId = new URL(request.url).searchParams.get("root_id");
    if (rootId === null) {
      if (storageBackend() === "d1") {
        const { readD1IndependentCatalog } = await import("@/lib/cloudflare/routine-independent");
        const result = await readD1IndependentCatalog(opened.actor, new URL(request.url).searchParams.get("cursor"));
        return routineResponse(result.body, result.status);
      }
      const result = await readIndependentRoutineCatalog(
        prisma!,
        opened.actor,
        new URL(request.url).searchParams.get("cursor"),
      );
      return routineResponse(result.body, result.status);
    }
    if (!rootId || rootId.length > 128)
      return routineError(400, "INVALID_QUERY");
    if (storageBackend() === "d1") {
      const { readD1IndependentRoutine } = await import("@/lib/cloudflare/routine-independent");
      const result = await readD1IndependentRoutine(opened.actor, rootId);
      return routineResponse(result.body, result.status);
    }
    const result = await readIndependentRoutineStep(
      prisma!,
      opened.actor,
      rootId,
    );
    return routineResponse(result.body, result.status);
  } catch (caught) {
    logRouteError(
      "GET /api/chores/routines/independent",
      caught,
      getRequestId(request),
    );
    return routineError(500, "ROUTINE_SCHEDULE_UNAVAILABLE");
  }
}
export async function POST(request: NextRequest) {
  try {
    const opened = await openRoutineSchedule(request, true, "independent");
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
    const result = storageBackend() === "d1"
      ? await (await import("@/lib/cloudflare/routine-independent")).saveD1IndependentRoutine(opened.actor, body, key, new Date(), undefined, routineRecoveryWritingEnabled())
      : await saveIndependentRoutineStep(prisma!, opened.actor, body, key, new Date(), routineRecoveryWritingEnabled());
    return routineResponse(result.body, result.status);
  } catch (caught) {
    if (caught instanceof ZodError)
      return routineError(400, "INVALID_ROUTINE_REQUEST");
    logRouteError(
      "POST /api/chores/routines/independent",
      caught,
      getRequestId(request),
    );
    return routineError(500, "ROUTINE_CONFIRMATION_UNAVAILABLE");
  }
}
