import { hashIdempotentRequest } from "@/lib/idempotency";
import { preparationView } from "../view";
import { preparationReadReply } from "../view-contract";
import { planEventPreparation, EVENT_PREPARATION_PROTOCOL } from "../contract";
import { preparationReceipt, PREPARATION_ACTION } from "../http";
import {
  PREPARATION_RECOVERY,
  type PreparationRecoveryContext,
  type PreparationRecoveryEntry,
} from "../recovery";
import type { prepareEventPreparationInTx } from "../runtime";
import { actor, now, preparationTestFixture } from "./test-fixture";
export function preparationRecoveryFixture() {
  const { context, command } = preparationTestFixture();
  const recovery: PreparationRecoveryContext = {
    contract: PREPARATION_RECOVERY,
    enabled: true,
    userId: actor.userId,
    familyId: actor.familyId,
    role: "parent",
    owner: {
      kind: "person",
      ownerId: actor.userId,
      scope: "d".repeat(64),
      householdScope: "e".repeat(64),
      generation: 2,
    },
  };
  const prepared = {
    context,
    scope: { memberProtocol: 2 },
    eventTitle: "Fixture event",
    tasks: [],
    subjects: [
      { subject: context.eligibleSubjects[0], name: "Fixture parent" },
    ],
    routineLabel: null,
    state: null,
  } as unknown as Awaited<ReturnType<typeof prepareEventPreparationInTx>>;
  const requestHash = hashIdempotentRequest(PREPARATION_ACTION, command);
  const entry: PreparationRecoveryEntry = {
    kind: "event-preparation",
    key: "event_preparation_request_a",
    body: JSON.stringify(command),
    requestHash,
  };
  const receipt = preparationReceipt.parse({
    receipt: {
      protocol: EVENT_PREPARATION_PROTOCOL,
      userId: actor.userId,
      familyId: actor.familyId,
      eventId: command.eventId,
      action: command.action,
      requestKey: entry.key,
      requestHash,
      sourceToken: command.eventSourceToken,
      expectedToken: command.expectedToken,
      planId: "plan-a",
      createdCount: 1,
    },
  });
  const preview = preparationReadReply.parse({
    view: preparationView(prepared, now),
    effects: planEventPreparation(command, context, now),
    requestHash,
  });
  return { context, command, recovery, prepared, entry, receipt, preview };
}
