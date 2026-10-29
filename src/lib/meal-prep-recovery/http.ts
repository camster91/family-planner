/** Strict person endpoints; existing legacy bulk routes remain compatible. */
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { authenticateWithFamily } from "../api-auth";
import { refusePairedDevice } from "../device-route";
import { prisma } from "../prisma";
import { checkRateLimit } from "../rate-limit-db";
import {
  boundedRequestText,
  RequestBodyTooLarge,
} from "../bounded-request-text";
import {
  readIdempotencyKey,
  withIdempotency,
  type EffectResult,
} from "../idempotency";
import {
  PREP_RECOVERY,
  PREP_OWNER_HEADER,
  prepContext,
  prepRecoveryInput,
  prepAction,
} from "./contract";
import { prepRecoveryEnabled, prepRequestOwner } from "./owner";
import {
  authorizePrepRecovery,
  inspectOwnedPrep,
  persistOwnedPrep,
  ownedPrepReplay,
  PrepRecoveryRefused,
  type PrepActor,
} from "./server";
import { prepCommand } from "./contract";
import { storageBackend } from "@/lib/storage-backend";
import { handleD1PrepRecoveryHttp } from "@/lib/cloudflare/meal-recovery";
const headers = { "Cache-Control": "private, no-store" };
const fail = (status: number, code: string): EffectResult => ({
  status,
  body: { error: { code } },
});
const json = (result: EffectResult) =>
  NextResponse.json(result.body, { status: result.status, headers });
export async function handlePrepRecoveryHttp(
  request: NextRequest,
  mode: "context" | "inspect" | "apply",
) {
  if (storageBackend() === "d1") return handleD1PrepRecoveryHttp(request, mode);
  try {
    const paired = await refusePairedDevice(request);
    if (paired) {
      paired.headers.set("Cache-Control", "private, no-store");
      return paired;
    }
    const [auth, error] = await authenticateWithFamily(request);
    if (error) {
      error.headers.set("Cache-Control", "private, no-store");
      return error;
    }
    if (!prisma) return json(fail(409, "UNAVAILABLE"));
    const actor: PrepActor = {
      userId: auth.user.id,
      familyId: auth.user.family_id,
      role: auth.user.role,
      generation: auth.payload.tv ?? 0,
    };
    await prisma.$transaction((tx) => authorizePrepRecovery(tx, actor));
    const owner = prepRequestOwner(request, {
      ...auth.payload,
      family_id: actor.familyId,
      role: actor.role,
      tv: actor.generation,
    });
    if (
      !(
        await checkRateLimit(
          `meal-prep-recovery:${mode}:${actor.userId}`,
          mode === "apply" ? 20 : mode === "context" ? 120 : 60,
          60000,
        )
      ).allowed
    )
      return json(fail(429, "RATE_LIMITED"));
    if (mode === "context")
      return NextResponse.json(
        prepContext.parse({
          contract: PREP_RECOVERY,
          enabled: owner !== null && prepRecoveryEnabled(),
          owner,
          userId: actor.userId,
          familyId: actor.familyId,
          role: actor.role,
        }),
        { headers },
      );
    if (!owner || request.headers.get(PREP_OWNER_HEADER) !== owner.scope)
      return json(fail(403, "AUTH_CONTEXT_CHANGED"));
    const input = prepRecoveryInput.parse(
      JSON.parse(await boundedRequestText(request, 196608)),
    );
    if (mode === "inspect") {
      const result = await inspectOwnedPrep(
        prisma,
        actor,
        input.entry,
        owner.scope,
      );
      if (Buffer.byteLength(JSON.stringify(result), "utf8") > 262144)
        return json(fail(409, "UNAVAILABLE"));
      return NextResponse.json(result, { headers });
    }
    const keyHeader = readIdempotencyKey(request);
    if (keyHeader.error) {
      keyHeader.error.headers.set("Cache-Control", "private, no-store");
      return keyHeader.error;
    }
    if (!keyHeader.key || keyHeader.key !== input.entry.key)
      return json(fail(400, "IDEMPOTENCY_KEY_REQUIRED"));
    const command = prepCommand.parse(JSON.parse(input.entry.body));
    await prisma.$transaction((tx) =>
      authorizePrepRecovery(tx, actor, command),
    );
    const response = await withIdempotency(
      prisma,
      keyHeader.key,
      {
        scope: `user:${actor.userId}`,
        userId: actor.userId,
        familyId: actor.familyId,
        action: prepAction(command),
      },
      command,
      async ({ recordId }) => {
        if (!recordId) return fail(409, "SAVE_UNCONFIRMED");
        return persistOwnedPrep(prisma!, actor, command, recordId);
      },
      {
        beforeReplay: async () => {
          try {
            await prisma!.$transaction((tx) =>
              authorizePrepRecovery(tx, actor, command),
            );
            return null;
          } catch (error) {
            return error instanceof PrepRecoveryRefused
              ? error.result
              : fail(409, "UNAVAILABLE");
          }
        },
        transformReplay: (result) => ownedPrepReplay(result, command),
      },
    );
    response.headers.set("Cache-Control", "private, no-store");
    return response;
  } catch (error) {
    if (error instanceof PrepRecoveryRefused) return json(error.result);
    if (error instanceof RequestBodyTooLarge)
      return json(fail(413, "INVALID_DRAFT"));
    if (error instanceof z.ZodError || error instanceof SyntaxError)
      return json(fail(400, "INVALID_DRAFT"));
    return json(
      fail(
        mode === "apply" ? 500 : 409,
        mode === "apply" ? "SAVE_UNCONFIRMED" : "UNAVAILABLE",
      ),
    );
  }
}
