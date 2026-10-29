import {
  AssistantSourceRefused,
  readAssistantSourceProof,
  type AssistantProofActor,
  type AssistantSourceGuard,
} from "@/lib/assistant-source-proof";
import {
  readDeleteTargetProof,
  type DeleteTargetGuard,
} from "@/lib/assistant-delete-target";
import { executeD1PersonEffect } from "./person-effect";
import { authorizeD1Lists } from "./list-authority";
import { d1DeleteTargetChecks } from "./assistant-delete-target";
import type { D1Store } from "./database";
/** Target expiry belongs to a new effect; valid completed receipts can recover. */
export function deleteD1List(
  actor: AssistantProofActor,
  listId: string,
  key: string | null,
  options: {
    sourceGuard?: AssistantSourceGuard;
    targetGuard?: DeleteTargetGuard;
    database?: D1Store;
  } = {},
) {
  const source = options.sourceGuard,
    target = options.targetGuard,
    kind = "list_delete";
  if (source) {
    if (
      !target ||
      !source.d1 ||
      source.d1.kind !== kind ||
      !source.actor ||
      source.actor.userId !== actor.userId ||
      source.actor.familyId !== actor.familyId ||
      source.actor.role !== actor.role ||
      source.actor.generation !== actor.generation
    )
      throw new AssistantSourceRefused();
    readAssistantSourceProof(source.d1.token, actor, kind);
  }
  if (target) {
    if (!target.d1 || target.d1.kind !== kind || target.d1.targetId !== listId)
      throw new AssistantSourceRefused();
    readDeleteTargetProof(target.d1.token, actor, kind, listId);
  }
  return executeD1PersonEffect({
    actor,
    action: "list.delete",
    input: { listId },
    key,
    database: options.database,
    sourceGuard: source,
    effectChecks: target
      ? (database) =>
          d1DeleteTargetChecks(database, actor, kind, listId, target)
      : undefined,
    authorize: async (db) => {
      const denied = await authorizeD1Lists(db, actor);
      return (
        denied ??
        (actor.role === "parent"
          ? null
          : {
              status: 403,
              body: { error: "Only parents can perform this action" },
            })
      );
    },
    plan: async (db) => {
      const list = await db.list.findUnique({
        where: { id: listId },
        select: { family_id: true },
      });
      if (!list) return { status: 404, body: { error: "List not found" } };
      if (list.family_id !== actor.familyId)
        return { status: 403, body: { error: "Forbidden" } };
      return {
        status: 200,
        body: { success: true },
        effects: (session) => [
          session
            .prepare("DELETE FROM List WHERE id=?1 AND family_id=?2")
            .bind(listId, actor.familyId),
        ],
      };
    },
  });
}
