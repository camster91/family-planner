/** Canonical list/note creates: current authority, effect and replay receipt
 * share one transaction. Optional assistant proofs add freshness, not authority. */
import type { Prisma, PrismaClient } from "@prisma/client";
import type { z } from "zod";
import type { createListSchema, createNoteSchema } from "./validations";
import type { AssistantSourceGuard } from "./assistant-source-proof";
import type { EffectResult } from "./idempotency";
import { authorizeContentWriteInTx as authorize } from "./person-content-authority";
import { resolveChorePhotoForWrite } from "./chore-photos";

export type ContentCreateActor = import("./person-content-authority").ContentWriteActor;
type Domain = import("./person-content-authority").ContentWriteDomain;
type Db = Pick<PrismaClient, "$transaction">;

export function authorizeContentCreateReplay(
  db: Db,
  actor: ContentCreateActor,
  domain: Domain,
) {
  return db.$transaction((tx) => authorize(tx, actor, domain));
}

async function create(
  db: Db,
  actor: ContentCreateActor,
  domain: Domain,
  recordId: string | null,
  guard: AssistantSourceGuard | undefined,
  effect: (tx: Prisma.TransactionClient) => Promise<EffectResult>,
): Promise<EffectResult> {
  return db.$transaction(async (tx) => {
    const denied = await authorize(tx, actor, domain);
    if (denied) return denied;
    await guard?.authorize(tx);
    if (recordId) {
      await tx.$queryRaw`SELECT "id" FROM "IdempotencyRecord" WHERE "id"=${recordId} FOR UPDATE`;
      const record = await tx.idempotencyRecord.findFirst({
        where: {
          id: recordId,
          family_id: actor.familyId,
          user_id: actor.userId,
        },
        select: { response_status: true, response_body: true },
      });
      if (!record)
        return {
          status: 409,
          body: { error: { code: "IDEMPOTENCY_IN_PROGRESS", retryable: true } },
        };
      if (record.response_status !== null)
        return { status: record.response_status, body: record.response_body };
    }
    await guard?.verify(tx);
    const result = await effect(tx);
    // Store the exact HTTP JSON representation in the same commit as the row.
    if (recordId && result.status >= 200 && result.status < 300)
      await tx.idempotencyRecord.update({
        where: { id: recordId },
        data: {
          response_status: result.status,
          response_body: JSON.parse(
            JSON.stringify(result.body),
          ) as Prisma.InputJsonObject,
        },
      });
    return result;
  });
}

export function createPersonList(
  db: Db,
  input: z.infer<typeof createListSchema>,
  actor: ContentCreateActor,
  recordId: string | null,
  guard?: AssistantSourceGuard,
) {
  return create(db, actor, "lists", recordId, guard, async (tx) => {
    let imageUrl: string | null = null;
    if (input.image_url) {
      const image = await resolveChorePhotoForWrite(
        actor.familyId,
        input.image_url,
        undefined,
        tx,
      );
      if (!image.ok)
        return {
          status: 400,
          body: {
            error: "Image not found. Upload a household image and retry.",
          },
        };
      imageUrl = image.value ?? null;
    }
    const list = await tx.list.create({
      data: {
        family_id: actor.familyId,
        created_by: actor.userId,
        name: input.name,
        type: input.type,
        description: input.description ?? null,
        image_url: imageUrl,
      },
    });
    return { status: 200, body: { success: true, list } };
  });
}

export function createPersonNote(
  db: Db,
  input: z.infer<typeof createNoteSchema>,
  actor: ContentCreateActor,
  recordId: string | null,
  guard?: AssistantSourceGuard,
) {
  return create(db, actor, "notes", recordId, guard, async (tx) => {
    const note = await tx.pinnedNote.create({
      data: {
        family_id: actor.familyId,
        created_by: actor.userId,
        title: input.title,
        body: (input.body || "").trim(),
        color:
          typeof input.color === "string" &&
          ["yellow", "pink", "blue", "green", "purple"].includes(input.color)
            ? input.color
            : "yellow",
      },
    });
    return { status: 201, body: { note } };
  });
}
