/** Inspect one original note-create receipt. Never replays, prunes or recreates a note. */
import type { PrismaClient } from "@prisma/client";
import type { z } from "zod";
import type { createNoteSchema } from "./validations";
import { authorizeContentWriteInTx, type ContentWriteActor } from "./person-content-authority";
import { hashIdempotentRequest, type EffectResult } from "./idempotency";
type Input = z.infer<typeof createNoteSchema>;
const unavailable = (): EffectResult => ({ status: 200, body: { state: "unavailable" } });
export function inspectPersonNoteReceipt(db: Pick<PrismaClient, "$transaction">, actor: ContentWriteActor,
  key: string, input: Input, now = new Date()): Promise<EffectResult> {
  return db.$transaction(async tx => {
    const denied = await authorizeContentWriteInTx(tx, actor, "notes");
    if (denied) return denied;
    if (input.expected_user_id !== actor.userId || input.expected_family_id !== actor.familyId)
      return { status: 409, body: { error: { code: "NOTE_OWNER_CHANGED", retryable: false } } };
    const scope = `user:${actor.userId}`;
    await tx.$queryRaw`SELECT "id" FROM "IdempotencyRecord" WHERE "scope"=${scope} AND "key"=${key}
      AND "family_id"=${actor.familyId} AND "user_id"=${actor.userId} FOR SHARE`;
    const record = await tx.idempotencyRecord.findFirst({
      where: { scope, key, family_id: actor.familyId, user_id: actor.userId },
      select: { action: true, request_hash: true, response_status: true, response_body: true, expires_at: true },
    });
    if (!record) return { status: 200, body: { state: "unissued" } };
    if (record.action !== "note.create" || record.request_hash !== hashIdempotentRequest("note.create", input))
      return { status: 422, body: { error: { code: "IDEMPOTENCY_KEY_REUSED", retryable: false } } };
    if (record.expires_at.getTime() <= now.getTime()) return { status: 200, body: { state: "expired" } };
    if (record.response_status === null) return { status: 200, body: { state: "pending" } };
    const body = record.response_body;
    if (![200, 201].includes(record.response_status) || !body || typeof body !== "object" || Array.isArray(body)) return unavailable();
    const note = body.note;
    if (!note || typeof note !== "object" || Array.isArray(note) || typeof note.id !== "string" ||
      !note.id.length || note.id.length > 128 || note.family_id !== actor.familyId || note.created_by !== actor.userId) return unavailable();
    const current = await tx.pinnedNote.findFirst({ where: { id: note.id, family_id: actor.familyId }, select: { id: true } });
    return { status: 200, body: { state: current ? "present" : "removed", noteId: note.id } };
  });
}
