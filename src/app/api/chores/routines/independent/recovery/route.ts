import { INDEPENDENT_DRAFT_CONTRACT } from "@/lib/routine-independent-draft-contract";
import { routineDraftOwner } from "@/lib/routine-schedule-owner";
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
import { reviewIndependentRoutineStep } from "@/lib/routine-independent-runtime";
import { ROUTINE_SCHEDULE_MAX_BYTES } from "@/lib/routine-schedule";
import {
  INDEPENDENT_RECOVERY_CONTRACT,
  independentRecoveryReviewInput,
} from "@/lib/routine-independent-recovery";
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
    let pointsEnabled = false;
    if (storageBackend() === "d1") {
      const { readD1IndependentCatalog } = await import(
        "@/lib/cloudflare/routine-independent"
      );
      const catalog = await readD1IndependentCatalog(opened.actor, null);
      if (catalog.status !== 200) return routineResponse(catalog.body, catalog.status);
      pointsEnabled = false;
      // Detached routine catalog intentionally omits points. The draft
      // contract only needs the capability bit, which is renewed by the
      // native save/read authority; do not infer it from a client payload.
      const { getD1Database } = await import("@/lib/cloudflare/database");
      const family = await (await getD1Database()).withSession("first-primary")
        .prepare(`SELECT features FROM "Family" WHERE id=?1`)
        .bind(opened.actor.familyId)
        .first<{ features: string | null }>();
      try {
        pointsEnabled = Boolean(JSON.parse(String(family?.features ?? "{}")).gamification);
      } catch {
        pointsEnabled = false;
      }
    } else {
      const capabilities = await prisma!.$transaction((tx) =>
        routineScheduleAuthority(tx, opened.actor),
      );
      pointsEnabled = capabilities.pointsEnabled;
    }
    if (new URL(request.url).searchParams.get("draft") === "1") {
      const owner = routineDraftOwner(opened.owner);
      return routineResponse({
        contract: INDEPENDENT_DRAFT_CONTRACT,
        owner,
        enabled: routineRecoveryWritingEnabled() && owner !== null,
        userId: opened.actor.userId,
        familyId: opened.actor.familyId,
        pointsEnabled,
      });
    }
    return routineResponse({
      contract: INDEPENDENT_RECOVERY_CONTRACT,
      enabled: routineRecoveryWritingEnabled() && opened.owner !== null,
      owner: opened.owner,
      userId: opened.actor.userId,
      familyId: opened.actor.familyId,
    });
  } catch (caught) {
    const refusal = routineScheduleFailure(caught);
    if (refusal) return routineResponse(refusal.body, refusal.status);
    logRouteError(
      "GET independent routine recovery",
      caught,
      getRequestId(request),
    );
    return routineError(500, "ROUTINE_RECOVERY_UNAVAILABLE");
  }
}
export async function POST(request: NextRequest) {
  try {
    const opened = await openRoutineSchedule(request, true, "independent");
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
    const parsed = independentRecoveryReviewInput.safeParse(raw);
    if (!parsed.success) return routineError(400, "INVALID_ROUTINE_REQUEST");
    const result = storageBackend() === "d1"
      ? await (await import("@/lib/cloudflare/routine-independent")).reviewD1IndependentRoutine(
          opened.actor,
          parsed.data.entry,
          opened.owner!.scope,
          routineRecoveryWritingEnabled(),
        )
      : await reviewIndependentRoutineStep(
          prisma!,
          opened.actor,
          parsed.data.entry,
          opened.owner!.scope,
          routineRecoveryWritingEnabled(),
        );
    return routineResponse(result.body, result.status);
  } catch (caught) {
    logRouteError(
      "POST independent routine recovery",
      caught,
      getRequestId(request),
    );
    return routineError(500, "ROUTINE_RECOVERY_UNAVAILABLE");
  }
}
