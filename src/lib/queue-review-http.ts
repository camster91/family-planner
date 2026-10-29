import { NextRequest, NextResponse } from "next/server";
import { authenticateWithFamily } from "@/lib/api-auth";
import { authenticateDevice } from "@/lib/device-route";
import { killSwitch } from "@/lib/device-http";
import { prisma } from "@/lib/prisma";
import { featureGate } from "@/lib/feature-gate-server";
import {
  isQueueOwnerRecoveryEnabled,
  personQueueOwner,
  deviceQueueOwner,
} from "@/lib/queue-owner-server";
import { queueReviewRequest } from "@/lib/queue-review-contract";
import { reviewQueueTargets } from "@/lib/queue-review-server";
import {
  boundedRequestText,
  RequestBodyTooLarge,
} from "@/lib/bounded-request-text";
import { checkRateLimit } from "@/lib/rate-limit-db";
import { apiError, logRouteError } from "@/lib/api-error";
import { getRequestId } from "@/lib/request-id";
import type { QueueOwner } from "@/lib/queue-owner-contract";
import { storageBackend } from "@/lib/storage-backend";
import { reviewD1DeviceQueue } from "@/lib/cloudflare/device-queue";
import type { DeviceActor } from "@/lib/device-session";
import type { AssistantProofActor } from "@/lib/assistant-source-proof";
import { reviewD1PersonQueue } from "@/lib/cloudflare/person-queue";
const headers = { "Cache-Control": "private, no-store" };
async function reviewQueueHttpInternal(
  request: NextRequest,
  kind: "person" | "device",
) {
  const fail = (status: number, code: string) =>
    apiError(
      status,
      code,
      "Could not review saved changes. They are kept and will not be sent.",
      { requestId: getRequestId(request), shape: "nested", headers },
    );
  try {
    let familyId: string;
    let owner: QueueOwner | null;
    let deviceActor: DeviceActor | null = null;
    let personActor: AssistantProofActor | null = null;
    if (kind === "device") {
      const off = killSwitch();
      if (off) return off;
      const auth = await authenticateDevice(request);
      if (!auth.ok) return auth.response;
      familyId = auth.actor.familyId;
      owner = deviceQueueOwner(auth.actor);
      deviceActor = auth.actor;
    } else {
      const [auth, error] = await authenticateWithFamily(request);
      if (error) return error;
      if (!["parent", "teen", "child"].includes(auth.user.role))
        return fail(403, "FORBIDDEN");
      familyId = auth.user.family_id;
      owner = personQueueOwner(request, auth.payload);
      personActor = {
        userId: auth.user.id,
        familyId,
        role: auth.user.role,
        generation: auth.payload.tv ?? 0,
      };
    }
    if (!isQueueOwnerRecoveryEnabled())
      return fail(409, "QUEUE_PROTOCOL_UNAVAILABLE");
    if (!owner) return fail(409, "QUEUE_SESSION_REQUIRED");
    const gated = await featureGate(familyId, "lists");
    if (gated) return gated;
    if (kind === "device" && storageBackend() !== "d1") {
      const family = await prisma!.family.findUnique({
        where: { id: familyId },
        select: { device_writes_enabled: true },
      });
      if (!family?.device_writes_enabled) return fail(403, "DEVICE_WRITES_OFF");
    }
    const rate = await checkRateLimit(
      `queue-review:${kind}:${owner.ownerId}`,
      30,
      60_000,
    );
    if (!rate.allowed) {
      const response = fail(429, "RATE_LIMITED");
      response.headers.set(
        "Retry-After",
        String(Math.max(1, Math.ceil(rate.retryAfterMs / 1000))),
      );
      return response;
    }
    let body: unknown;
    try {
      body = JSON.parse(await boundedRequestText(request, 32 * 1024));
    } catch (error) {
      return fail(
        error instanceof RequestBodyTooLarge ? 413 : 400,
        "INVALID_REQUEST",
      );
    }
    const parsed = queueReviewRequest.safeParse(body);
    if (!parsed.success) return fail(400, "INVALID_REQUEST");
    let rows: unknown;
    if (kind === "device" && storageBackend() === "d1") {
      const native = await reviewD1DeviceQueue(
        deviceActor!,
        parsed.data.entries,
      );
      if (native.status !== 200)
        return fail(native.status, native.code ?? "INTERNAL_ERROR");
      rows = native.body;
    } else if (storageBackend() === "d1") {
      const native = await reviewD1PersonQueue(
        personActor!,
        parsed.data.entries,
      );
      if (native.status !== 200)
        return NextResponse.json(native.body, {
          status: native.status,
          headers,
        });
      rows = native.body;
    } else {
      rows = await reviewQueueTargets(
        prisma!,
        familyId,
        kind,
        parsed.data.entries,
      );
    }
    return NextResponse.json(
      { contract: "herewoven.queue-review.v1", owner, rows },
      { headers },
    );
  } catch (error) {
    logRouteError(`queue review ${kind}`, error, getRequestId(request));
    return fail(500, "INTERNAL_ERROR");
  }
}

export async function reviewQueueHttp(
  request: NextRequest,
  kind: "person" | "device",
) {
  const response = await reviewQueueHttpInternal(request, kind);
  response.headers.set("Cache-Control", headers["Cache-Control"]);
  return response;
}
