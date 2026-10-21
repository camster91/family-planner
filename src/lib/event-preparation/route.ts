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
  preparationReadScope,
  scopeForPreparationCommand,
  type PreparationReadScope,
} from "./read-contract";
import {
  preparationCommand,
  planEventPreparation,
  EventPreparationError,
  type PreparationCommand,
} from "./contract";
import {
  eventPreparationOwner,
  eventPreparationReady,
  eventPreparationWritingEnabled,
} from "./owner";
import { preparationView } from "./view";
import {
  openPreparationActorInTx,
  prepareEventPreparationInTx,
  type PreparationActor,
} from "./runtime";
import { writeEventPreparation, preparationFailure } from "./server";
import {
  PREPARATION_ACTION,
  preparationReceiptMatches,
  preparationReceipt,
} from "./http";
export const PREPARATION_OWNER_HEADER = "X-Event-Preparation-Owner";
const headers = { "Cache-Control": "private, no-store" };
const previewInput = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("read"), scope: preparationReadScope }).strict(),
  z
    .object({ kind: z.literal("preview"), command: preparationCommand })
    .strict(),
]);
/** Metadata-only authority renewal independent of target/schema/readiness, so
 * owned receipt replay remains possible after the event has been deleted. */
async function authorize(
  db: NonNullable<typeof prisma>,
  actor: PreparationActor,
) {
  await db.$transaction(async (tx) => {
    await openPreparationActorInTx(tx, actor);
    const rows = await tx.$queryRaw<
      Array<{ token_version: number; role: string }>
    >`SELECT "token_version", "role" FROM "User" WHERE "id"=${actor.userId} AND "family_id"=${actor.familyId} FOR SHARE`;
    if (!rows[0] || rows[0].token_version !== actor.tokenVersion)
      throw new EventPreparationError("UNAUTHORIZED");
    if (rows[0].role !== "parent") throw new EventPreparationError("FORBIDDEN");
  });
}
export async function handlePreparationHttp(
  request: NextRequest,
  mode: "read" | "preview" | "write",
) {
  try {
    const [auth, refusal] = await authenticateWithFamily(request);
    if (refusal) {
      refusal.headers.set("Cache-Control", "private, no-store");
      return refusal;
    }
    if (!prisma) throw new EventPreparationError("UNAVAILABLE");
    const actor = {
      userId: auth.user.id,
      familyId: auth.user.family_id,
      tokenVersion: auth.payload.tv ?? 0,
    };
    await authorize(prisma, actor);
    if (!eventPreparationReady())
      throw new EventPreparationError("UNAVAILABLE");
    const now = new Date();
    if (mode === "read" || mode === "preview") {
      let scope: PreparationReadScope;
      let command: PreparationCommand | undefined;
      if (mode === "read") {
        const params = request.nextUrl.searchParams;
        if (new Set(params.keys()).size !== [...params.keys()].length)
          throw new EventPreparationError("INVALID");
        const query = z
          .object({
            eventId: z.string(),
            timeZone: z.string(),
            memberProtocol: z.enum(["1", "2"]),
          })
          .strict()
          .parse(Object.fromEntries(params));
        scope = preparationReadScope.parse({
          ...query,
          memberProtocol: Number(query.memberProtocol),
          choreIds: [],
          subjects: [],
          routine: null,
        });
      } else {
        const input = previewInput.parse(
          JSON.parse(await boundedRequestText(request, 1048576)),
        );
        if (input.kind === "read") scope = input.scope;
        else {
          command = input.command;
          scope = scopeForPreparationCommand(command);
        }
      }
      const reply = await prisma.$transaction(async (tx) => {
        await openPreparationActorInTx(tx, actor);
        const prepared = await prepareEventPreparationInTx(tx, actor, scope);
        return {
          view: preparationView(prepared, now),
          effects: command
            ? planEventPreparation(command, prepared.context, now)
            : null,
        };
      });
      return NextResponse.json(reply, { headers });
    }
    const owner = eventPreparationOwner(request, auth.payload, {
      ...auth.user,
      role: "parent",
    });
    if (
      !eventPreparationWritingEnabled() ||
      !owner ||
      request.headers.get(PREPARATION_OWNER_HEADER) !== owner.scope
    )
      throw new EventPreparationError("FORBIDDEN");
    const { key, error } = readIdempotencyKey(request);
    if (error) {
      error.headers.set("Cache-Control", "private, no-store");
      return error;
    }
    if (!key) {
      const reply = idempotencyError("IDEMPOTENCY_KEY_REQUIRED");
      reply.headers.set("Cache-Control", "private, no-store");
      return reply;
    }
    const command = preparationCommand.parse(
      JSON.parse(await boundedRequestText(request, 1048576)),
    );
    if (
      command.owner.userId !== actor.userId ||
      command.owner.familyId !== actor.familyId
    )
      throw new EventPreparationError("FORBIDDEN");
    const response = await withIdempotency(
      prisma,
      key,
      {
        scope: `user:${actor.userId}`,
        userId: actor.userId,
        familyId: actor.familyId,
        action: PREPARATION_ACTION,
      },
      command,
      async ({ recordId }) => {
        if (!recordId)
          return preparationFailure(new EventPreparationError("STALE"));
        try {
          return await writeEventPreparation(
            prisma!,
            actor,
            command,
            key,
            recordId,
          );
        } catch (error) {
          return preparationFailure(error);
        }
      },
      {
        beforeReplay: async () => {
          try {
            await authorize(prisma!, actor);
            return null;
          } catch (error) {
            return preparationFailure(error);
          }
        },
        transformReplay: async (result) =>
          result.status === 200 &&
          preparationReceiptMatches(result.body, command, key)
            ? { status: 200, body: preparationReceipt.parse(result.body) }
            : preparationFailure(new EventPreparationError("UNSUPPORTED")),
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
        { error: { code: "EVENT_PREPARATION_INVALID_REQUEST" } },
        { status: error instanceof RequestBodyTooLarge ? 413 : 400, headers },
      );
    const result = preparationFailure(error);
    return NextResponse.json(result.body, { status: result.status, headers });
  }
}
