/** Exact pending personal creates. No offline action or editable-document queue. */
import { z } from "zod";
import { queueOwnerClassicSchema } from "./queue-owner-classic";
import { NOTE_CREATE_RECOVERY_CONTRACT } from "./note-create-recovery-identity";
import type { NoteCreateIntent } from "./note-create-client";
const id = z.string().min(1).max(128);
export const noteRecoveryContext = z.object({
  contract: z.literal(NOTE_CREATE_RECOVERY_CONTRACT), enabled: z.boolean(),
  owner: queueOwnerClassicSchema.refine(owner => owner.kind === "person").nullable(),
  userId: id, familyId: id,
}).strict().refine(value => (!value.enabled || value.owner !== null) && (!value.owner || value.owner.ownerId === value.userId));
export type NoteRecoveryContext = z.infer<typeof noteRecoveryContext>;
const request = z.object({ title: z.string().trim().min(1).max(200), body: z.string().max(10000),
  color: z.enum(["yellow", "pink", "blue", "green", "purple"]), expected_user_id: id, expected_family_id: id }).strict();
export const noteRecoveryEntry = z.object({ kind: z.literal("note-create"),
  key: z.string().regex(/^[A-Za-z0-9_-]{16,128}$/), body: z.string().min(1).max(65536),
  issuedAt: z.number().int().nonnegative(),
}).strict().refine(entry => {
  try { return new TextEncoder().encode(entry.body).byteLength <= 65536 && request.safeParse(JSON.parse(entry.body)).success; }
  catch { return false; }
});
export type NoteRecoveryEntry = z.infer<typeof noteRecoveryEntry>;
export const noteRecoveryJournal = z.object({ contract: z.literal(NOTE_CREATE_RECOVERY_CONTRACT),
  entries: z.array(noteRecoveryEntry).max(1) }).strict();
export function noteEntryMatchesContext(entry: NoteRecoveryEntry, context: NoteRecoveryContext) {
  const parsed = request.safeParse(JSON.parse(entry.body));
  return parsed.success && parsed.data.expected_user_id === context.userId && parsed.data.expected_family_id === context.familyId;
}
export function noteIntentFromEntry(entry: NoteRecoveryEntry): NoteCreateIntent {
  const value = noteRecoveryEntry.parse(entry);
  const body = request.parse(JSON.parse(value.body));
  return { key: value.key, body: value.body, issuedAt: value.issuedAt,
    context: { userId: body.expected_user_id, familyId: body.expected_family_id } };
}
