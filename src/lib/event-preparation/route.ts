import { readPreparationPicker } from "./picker";
import { preparationPickerQuery } from "./picker-contract";
import { preparationReceiptMatches } from "./receipt-server";
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { authenticateWithFamily } from "@/lib/api-auth";
import {
  boundedRequestText,
  RequestBodyTooLarge,
} from "@/lib/bounded-request-text";
import {
  hashIdempotentRequest,
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
} from "./runtime";
import { writeEventPreparation, preparationFailure } from "./server";
import { PREPARATION_ACTION, preparationReceipt } from "./http";
import { preparationReadReply } from "./view-contract";
import {
  PREPARATION_RECOVERY,
  PREPARATION_OWNER_HEADER,
  PREPARATION_REQUEST_BYTES,
  PREPARATION_INSPECTION_BYTES,
  preparationRecoveryContext,
  preparationRecoveryInput,
} from "./recovery";
import {
  authorizePreparationReceipt,
  reviewPreparationRequest,
} from "./recovery-server";
import { eventPreparationStorageAvailable } from "./storage";
import { scheduleStorageAvailable } from "@/lib/calendar-planning/schedule-source";
const headers = { "Cache-Control": "private, no-store" };
const previewInput = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("read"), scope: preparationReadScope }).strict(),
  z
    .object({ kind: z.literal("preview"), command: preparationCommand })
    .strict(),
]);
export async function handlePreparationHttp(
  request: NextRequest,
  mode: "read" | "preview" | "write" | "context" | "inspect" | "picker",
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
    const current = await authorizePreparationReceipt(prisma, actor);
    const owner = eventPreparationOwner(request, auth.payload, {
      ...auth.user,
      role: "parent",
    });
    if (mode === "context")
      return NextResponse.json(
        preparationRecoveryContext.parse({
          contract: PREPARATION_RECOVERY,
          userId: actor.userId,
          familyId: actor.familyId,
          role: "parent",
          owner,
          enabled:
            current.domainsEnabled &&
            eventPreparationWritingEnabled() &&
            owner !== null &&
            (await eventPreparationStorageAvailable(prisma)) &&
            (await scheduleStorageAvailable(prisma)),
        }),
        { headers },
      );
    if (mode === "inspect") {
      if (
        !owner ||
        request.headers.get(PREPARATION_OWNER_HEADER) !== owner.scope
      )
        throw new EventPreparationError("FORBIDDEN");
      const input = preparationRecoveryInput.parse(
        JSON.parse(
          await boundedRequestText(request, PREPARATION_INSPECTION_BYTES),
        ),
      );
      return NextResponse.json(
        await reviewPreparationRequest(prisma, actor, input.entry, owner.scope),
        { headers },
      );
    }
    if (!eventPreparationReady())
      throw new EventPreparationError("UNAVAILABLE");
    if (mode === "picker") {
      const params = request.nextUrl.searchParams;
      if (new Set(params.keys()).size !== [...params.keys()].length)
        throw new EventPreparationError("INVALID");
      return NextResponse.json(
        await readPreparationPicker(
          prisma,
          actor,
          preparationPickerQuery.parse(Object.fromEntries(params)),
        ),
        { headers },
      );
    }
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
          JSON.parse(
            await boundedRequestText(request, PREPARATION_REQUEST_BYTES),
          ),
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
          requestHash: command
            ? hashIdempotentRequest(PREPARATION_ACTION, command)
            : null,
        };
      });
      return NextResponse.json(preparationReadReply.parse(reply), { headers });
    }

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
      JSON.parse(await boundedRequestText(request, PREPARATION_REQUEST_BYTES)),
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
            await authorizePreparationReceipt(prisma!, actor);
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
