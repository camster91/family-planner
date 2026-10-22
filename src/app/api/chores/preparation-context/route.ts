import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { authenticateWithFamily, requireParent } from "@/lib/api-auth";
import { prisma } from "@/lib/prisma";
import { lockUser, lockHousehold } from "@/lib/household-lock";
import {
  boundedRequestText,
  RequestBodyTooLarge,
} from "@/lib/bounded-request-text";
import { memberIdentityIdSchema } from "@/lib/member-subject-contract";
import { eventPreparationReady } from "@/lib/event-preparation/owner";
import { eventPreparationStorageAvailable } from "@/lib/event-preparation/storage";
import { readPreparationBacklinks } from "@/lib/event-preparation/discovery";
import { readPreparationRoutineOrigins } from "@/lib/event-preparation/origin";
import { chorePreparationContext } from "@/lib/event-preparation/origin-contract";
import { logRouteError } from "@/lib/api-error";
import { getRequestId } from "@/lib/request-id";
export const dynamic = "force-dynamic";
const input = z
  .object({
    ids: z
      .array(memberIdentityIdSchema)
      .min(1)
      .max(300)
      .refine((ids) => new Set(ids).size === ids.length),
  })
  .strict();
const reply = (body: unknown, status = 200) =>
  NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "private, no-store" },
  });
/** POST is a bounded read-only ID batch, never a mutation, receipt or queue. */
export async function POST(request: NextRequest) {
  try {
    const [auth, error] = await authenticateWithFamily(request);
    if (error) {
      error.headers.set("Cache-Control", "private, no-store");
      return error;
    }
    const parent = requireParent(auth.user.role);
    if (parent) {
      parent.headers.set("Cache-Control", "private, no-store");
      return parent;
    }
    let parsed: z.infer<typeof input>;
    try {
      parsed = input.parse(
        JSON.parse(await boundedRequestText(request, 65536)),
      );
    } catch (error) {
      return reply(
        { error: "Invalid context request" },
        error instanceof RequestBodyTooLarge ? 413 : 400,
      );
    }
    const result = await prisma!.$transaction(async (tx) => {
      await lockUser(tx, auth.user.id);
      await lockHousehold(tx, auth.user.family_id);
      const current = await tx.user.findUnique({
        where: { id: auth.user.id },
        select: { family_id: true, role: true, token_version: true },
      });
      if (!current || current.token_version !== (auth.payload.tv ?? 0))
        return { status: 401, body: { error: "Context unavailable" } };
      if (
        current.role !== "parent" ||
        current.family_id !== auth.user.family_id
      )
        return { status: 403, body: { error: "Context unavailable" } };
      const owner = {
        userId: auth.user.id,
        familyId: auth.user.family_id,
        generation: current.token_version,
      };
      const tables = await tx.$queryRaw<
        Array<{ ready: boolean }>
      >`SELECT to_regclass('public."RoutineStack"') IS NOT NULL AS ready`;
      if (
        !eventPreparationReady() ||
        !tables[0]?.ready ||
        !(await eventPreparationStorageAvailable(tx))
      )
        return {
          status: 200,
          body: chorePreparationContext.parse({
            owner,
            state: "paused",
            backlinks: {},
            origins: {},
          }),
        };
      const scope = {
        userId: auth.user.id,
        familyId: auth.user.family_id,
        role: current.role,
        tokenVersion: current.token_version,
        choreIds: parsed.ids,
      };
      const backlinks = await readPreparationBacklinks(tx, scope);
      const origins = await readPreparationRoutineOrigins(tx, scope);
      return {
        status: 200,
        body: chorePreparationContext.parse({
          owner,
          state: "available",
          backlinks,
          origins,
        }),
      };
    });
    return reply(result.body, result.status);
  } catch (error) {
    logRouteError(
      "POST chore preparation context read",
      error,
      getRequestId(request),
    );
    return reply({ error: "Context unavailable" }, 500);
  }
}
