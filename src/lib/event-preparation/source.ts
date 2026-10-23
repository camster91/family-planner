/** Canonical source fingerprints; all values come from freshly locked DB rows.
 * Chore status/proof epoch is separate from assignment/consent material epoch. */
import { createHash } from "node:crypto";
import { z } from "zod";
import {
  responsibilitySourceToken,
  type ResponsibilitySourceEpoch,
} from "@/lib/responsibility-storage";
import { EventPreparationError, EVENT_PREPARATION_PROTOCOL } from "./contract";
const epoch = z.number().int().min(0).max(2147483646);
export function preparationTaskToken(
  familyId: string,
  choreId: string,
  source: ResponsibilitySourceEpoch & { preparationEpoch: number },
) {
  if (!epoch.safeParse(source.preparationEpoch).success)
    throw new EventPreparationError("UNAVAILABLE");
  let material: string;
  try {
    material = responsibilitySourceToken(
      { kind: "chore", id: choreId },
      familyId,
      source,
    );
  } catch {
    throw new EventPreparationError("UNAVAILABLE");
  }
  return createHash("sha256")
    .update(
      JSON.stringify([
        EVENT_PREPARATION_PROTOCOL,
        "task",
        material,
        source.preparationEpoch,
      ]),
    )
    .digest("hex");
}
export function preparationRoutineToken(input: {
  familyId: string;
  stackId: string;
  version: number;
  fingerprint: string;
  occurrenceDay: string;
  complete: boolean;
  steps: { id: string; sourceToken: string; copyable: boolean }[];
}) {
  if (
    !epoch.safeParse(input.version).success ||
    input.steps.length > 99 ||
    new Set(input.steps.map((step) => step.id)).size !== input.steps.length
  )
    throw new EventPreparationError("UNAVAILABLE");
  return createHash("sha256")
    .update(
      JSON.stringify([
        EVENT_PREPARATION_PROTOCOL,
        "dated-routine",
        input.familyId,
        input.stackId,
        input.version,
        input.fingerprint,
        input.occurrenceDay,
        input.complete,
        input.steps.map((step) => [step.id, step.sourceToken, step.copyable]),
      ]),
    )
    .digest("hex");
}
