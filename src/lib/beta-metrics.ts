import { prisma } from "@/lib/prisma";

export type CoreMutationName =
  | "family.create"
  | "family.member_join"
  | "chore.assign"
  | "chore.complete"
  | "chore.verify"
  | "reward.claim";

interface CoreMutationContext {
  familyId: string;
  actorRole: string;
  eventName: CoreMutationName;
}

async function record(
  context: CoreMutationContext,
  success: boolean,
  startedAt: number,
) {
  try {
    await prisma?.betaMetricEvent.create({
      data: {
        family_id: context.familyId,
        actor_role: context.actorRole,
        event_name: context.eventName,
        success,
        duration_ms: Math.max(0, Date.now() - startedAt),
      },
    });
  } catch (error) {
    console.error("Beta metric recording failed:", error);
  }
}

export async function measureCoreMutation<T>(
  context: CoreMutationContext,
  operation: () => Promise<T>,
  shouldRecord: (result: T) => boolean = () => true,
): Promise<T> {
  const startedAt = Date.now();
  try {
    const result = await operation();
    if (shouldRecord(result)) {
      await record(context, true, startedAt);
    }
    return result;
  } catch (error) {
    await record(context, false, startedAt);
    throw error;
  }
}
