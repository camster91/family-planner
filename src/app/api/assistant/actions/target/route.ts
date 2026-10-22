/** Read-only review of one user-selected canonical target. Never a model tool. */
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { authenticateWithFamily } from "@/lib/api-auth";
import { prisma } from "@/lib/prisma";
import {
  boundedRequestText,
  RequestBodyTooLarge,
} from "@/lib/bounded-request-text";
import { memberIdentityIdSchema } from "@/lib/member-subject-contract";
import {
  assistantDeleteKind,
  assistantDeletePreviewSchema,
  ASSISTANT_SOURCE_PROOF_HEADER,
} from "@/lib/assistant-reference-contract";
import {
  assistantSourceGuard,
  AssistantSourceRefused,
} from "@/lib/assistant-source-proof";
import {
  readDeleteSnapshot,
  issueDeleteTargetProof,
} from "@/lib/assistant-delete-target";
import {
  authorizePersonDelete,
  deletionEligibility,
} from "@/lib/person-record-delete";
import { RoutineScheduleLegacyWriteError } from "@/lib/routine-schedule-legacy";
export const dynamic = "force-dynamic";
const input = z
  .object({
    kind: assistantDeleteKind,
    id: memberIdentityIdSchema,
    sourceProof: z.string().min(1).max(4096),
  })
  .strict();
const headers = { "Cache-Control": "private, no-store" };
export async function POST(request: NextRequest) {
  try {
    const [auth, error] = await authenticateWithFamily(request);
    if (error) {
      error.headers.set("Cache-Control", "private, no-store");
      return error;
    }
    let command: z.infer<typeof input>;
    try {
      command = input.parse(
        JSON.parse(await boundedRequestText(request, 8192)),
      );
    } catch (error) {
      return NextResponse.json(
        { error: "Invalid target review" },
        { status: error instanceof RequestBodyTooLarge ? 413 : 400, headers },
      );
    }
    const actor = {
      userId: auth.user.id,
      familyId: auth.user.family_id,
      role: auth.user.role,
      generation: auth.payload?.tv ?? 0,
    };
    const guard = assistantSourceGuard(
      {
        headers: new Headers({
          [ASSISTANT_SOURCE_PROOF_HEADER]: command.sourceProof,
        }),
      },
      actor,
      command.kind,
    )!;
    const result = await prisma!.$transaction(async (tx) => {
      const denied = await authorizePersonDelete(tx, actor, command.kind);
      if (denied) return denied;
      await guard.authorize(tx);
      await guard.verify(tx);
      const snapshot = await readDeleteSnapshot(
        tx,
        actor.familyId,
        command.kind,
        command.id,
      );
      if (!snapshot) throw new AssistantSourceRefused();
      const refused = await deletionEligibility(
        tx,
        actor,
        command.kind,
        command.id,
      );
      if (refused) return refused;
      const row = snapshot.row;
      // Labels/details come only from the locked canonical row. Full row and
      // dependent content remain server-side; the token contains keyed hashes.
      const target = assistantDeletePreviewSchema.parse({
        id: command.id,
        title: command.kind === "list_delete" ? row.name : row.title,
        ...(typeof row.start_time === "string"
          ? { detail: row.start_time }
          : typeof row.due_date === "string"
            ? { detail: row.due_date }
            : {}),
        ...(command.kind === "list_delete"
          ? {
              context: [row.type, row.description]
                .filter((value) => typeof value === "string" && value)
                .join(" · "),
              itemCount: snapshot.children[0].length,
            }
          : {}),
        proof: issueDeleteTargetProof(
          actor,
          command.kind,
          command.id,
          snapshot,
        ),
      });
      return { status: 200, body: { target } };
    });
    return NextResponse.json(result.body, { status: result.status, headers });
  } catch (error) {
    if (error instanceof AssistantSourceRefused) return error.response();
    if (error instanceof RoutineScheduleLegacyWriteError)
      return NextResponse.json(
        { error: error.message, code: error.code },
        { status: 409, headers },
      );
    return NextResponse.json(
      {
        error:
          "Target review unavailable. Use the app controls or refresh Today.",
      },
      { status: 503, headers },
    );
  }
}
