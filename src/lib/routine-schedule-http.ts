/** Private route admission; effect/read helpers renew authority under locks. */
import { NextResponse, type NextRequest } from "next/server";
import { authenticateWithFamily } from "@/lib/api-auth";
import { checkRateLimit } from "@/lib/rate-limit-db";
import { requestedMemberProtocol } from "@/lib/chore-profile";
import { ROUTINE_SCHEDULE_READY_ENV } from "@/lib/routine-schedule-gates";
import {
  routineScheduleOwner,
  routineIndependentOwner,
} from "@/lib/routine-schedule-owner";
import { ROUTINE_RECOVERY_OWNER_HEADER } from "@/lib/routine-schedule-recovery-contract";
export const routineResponse = (body: unknown, status = 200) =>
  NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "private, no-store" },
  });
export const routineError = (status: number, code: string) =>
  routineResponse({ error: { code } }, status);
export async function openRoutineSchedule(
  request: NextRequest,
  requireOwner = false,
  ownerKind: "schedule" | "independent" = "schedule",
) {
  const [auth, error] = await authenticateWithFamily(request);
  if (error) {
    error.headers.set("Cache-Control", "private, no-store");
    return { ok: false as const, response: error };
  }
  if (auth.user.role !== "parent")
    return {
      ok: false as const,
      response: routineError(403, "ROUTINE_PARENT_REQUIRED"),
    };
  if (process.env[ROUTINE_SCHEDULE_READY_ENV] !== "1")
    return {
      ok: false as const,
      response: routineError(404, "ROUTINE_SCHEDULE_UNAVAILABLE"),
    };
  if (
    !(await checkRateLimit(`routine-schedules:${auth.user.id}`, 120, 60_000))
      .allowed
  )
    return { ok: false as const, response: routineError(429, "RATE_LIMITED") };
  const baseOwner = routineScheduleOwner(request, auth.payload, auth.user);
  const owner =
    ownerKind === "independent"
      ? routineIndependentOwner(baseOwner)
      : baseOwner;
  if (
    (requireOwner || request.headers.has(ROUTINE_RECOVERY_OWNER_HEADER)) &&
    (!owner ||
      request.headers.get(ROUTINE_RECOVERY_OWNER_HEADER) !== owner.scope)
  )
    return {
      ok: false as const,
      response: routineError(409, "ROUTINE_RECOVERY_OWNER_CHANGED"),
    };
  return {
    ok: true as const,
    owner,
    actor: {
      userId: auth.user.id,
      familyId: auth.user.family_id,
      tokenVersion: auth.payload.tv ?? 0,
      memberProtocol: requestedMemberProtocol(request),
    },
  };
}
