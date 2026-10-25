/** Canonical note mutations: current authority and record ownership commit together. */
import type { Prisma, PrismaClient } from "@prisma/client";
import type { z } from "zod";
import type { updateNoteSchema } from "./validations";
import type { EffectResult } from "./idempotency";
import { authorizeContentWriteInTx, type ContentWriteActor } from "./person-content-authority";
import { canEditOwnedRecord } from "./role-capabilities";
const NOTE_COLORS = ["yellow", "pink", "blue", "green", "purple"];
type Command = { kind: "edit"; input: z.infer<typeof updateNoteSchema> } | { kind: "delete"; id: string };
export function mutatePersonNote(db: Pick<PrismaClient, "$transaction">, actor: ContentWriteActor, command: Command): Promise<EffectResult> {
  return db.$transaction(async tx => {
    const denied = await authorizeContentWriteInTx(tx, actor, "notes");
    if (denied) return denied;
    if (command.kind === "delete" && actor.role !== "parent")
      return { status: 403, body: { error: "Only parents can delete notes" } };
    const id = command.kind === "edit" ? command.input.id : command.id;
    await tx.$queryRaw`SELECT "id" FROM "PinnedNote" WHERE "id"=${id} AND "family_id"=${actor.familyId} FOR UPDATE`;
    const note = await tx.pinnedNote.findFirst({ where: { id, family_id: actor.familyId }, select: { created_by: true } });
    if (!note) return { status: 404, body: { error: "Note not found" } };
    if (command.kind === "delete") {
      await tx.pinnedNote.delete({ where: { id, family_id: actor.familyId } });
      return { status: 200, body: { success: true } };
    }
    if (!canEditOwnedRecord(actor.role, actor.userId, note.created_by))
      return { status: 403, body: { error: "You can only edit notes you created" } };
    const { title, body, color } = command.input;
    const data: Prisma.PinnedNoteUpdateInput = {};
    if (title !== undefined) data.title = title;
    if (body !== undefined) data.body = (body ?? "").trim();
    if (color !== undefined) data.color = typeof color === "string" && NOTE_COLORS.includes(color) ? color : "yellow";
    const updated = await tx.pinnedNote.update({ where: { id, family_id: actor.familyId }, data });
    return { status: 200, body: { note: updated } };
  });
}
