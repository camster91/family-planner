/** Ephemeral server catalog. Opaque keyed IDs are scoped to the authenticated
 * person/family/role/generation. Neither they nor revisions grant write rights. */
import { createHmac } from "node:crypto";
import { getJwtSecret } from "./auth";
import { memberIdentityIdSchema as id } from "./member-subject-contract";
import {
  assistantEvidence,
  type AssistantEvidence,
} from "./assistant-reference-contract";
import {
  loadAssistantTodayContext,
  type AssistantTodayDb,
  type LoadAssistantTodayContextInput,
} from "./assistant-today-context";
export type AssistantSourceRow = {
  kind: AssistantEvidence["kind"];
  id: string;
  index: number;
  label: string;
  containerId?: string;
  versionInput: unknown;
};
type Owner = {
  userId: string;
  familyId: string;
  role: string;
  generation: number;
};
export const isAssistantReferencesEnabled = () =>
  process.env.FAMILY_ASSISTANT_REFERENCES_READY === "1";
const digest = (key: string, values: unknown[]) =>
  createHmac("sha256", key).update(JSON.stringify(values)).digest("hex");
export function buildAssistantReferenceCatalog(
  rows: AssistantSourceRow[],
  owner: Owner,
  observedAt: string,
  key = getJwtSecret(),
) {
  if (
    rows.length > 91 ||
    !id.safeParse(owner.userId).success ||
    !id.safeParse(owner.familyId).success ||
    !["parent", "teen"].includes(owner.role) ||
    !Number.isSafeInteger(owner.generation) ||
    owner.generation < 0 ||
    !Number.isFinite(Date.parse(observedAt))
  )
    throw new Error("Reference context unavailable");
  const seen = new Set<string>();
  return rows.map((row) => {
    if (
      !id.safeParse(row.id).success ||
      !Number.isSafeInteger(row.index) ||
      row.index < 0 ||
      row.index > 29 ||
      !row.versionInput ||
      (row.kind === "grocery" && !id.safeParse(row.containerId).success)
    )
      throw new Error("Reference context unavailable");
    const identity = [
      "herewoven.assistant-reference.v1",
      owner.userId,
      owner.familyId,
      owner.role,
      owner.generation,
      row.kind,
      row.id,
    ];
    const ref = `asr1_${digest(key, identity)}`;
    if (seen.has(ref)) throw new Error("Reference context unavailable");
    seen.add(ref);
    const href =
      row.kind === "event"
        ? `/dashboard/calendar/edit?id=${row.id}`
        : row.kind === "chore"
          ? `/dashboard/chores/edit?id=${row.id}`
          : row.kind === "grocery"
            ? `/dashboard/lists/${row.containerId}`
            : row.kind === "dinner"
              ? "/dashboard/meals"
              : "/dashboard/inventory";
    return {
      provider: {
        ref,
        kind: row.kind,
        index: row.index,
        observedAt,
        revision: digest(key, [
          "herewoven.assistant-source.v1",
          identity,
          row.versionInput,
        ]),
      },
      evidence: assistantEvidence.parse({
        ref,
        kind: row.kind,
        label: row.label,
        observedAt,
        href,
      }),
    };
  });
}
export type AssistantReferenceCatalog = ReturnType<
  typeof buildAssistantReferenceCatalog
>;
export async function loadReferencedAssistantToday(
  db: AssistantTodayDb,
  input: LoadAssistantTodayContextInput & { generation: number },
) {
  let rows: AssistantSourceRow[] = [];
  const context = await loadAssistantTodayContext(db, {
    ...input,
    onSources: (current) => {
      rows = current;
    },
  });
  if (!context) return null;
  const expected =
    context.today.events.length +
    context.today.chores.length +
    context.today.groceries.length +
    context.today.useSoon.length +
    (context.today.dinner ? 1 : 0);
  if (rows.length !== expected) return null;
  const slots = new Set<string>();
  for (const row of rows) {
    const projected =
      row.kind === "event"
        ? context.today.events[row.index]?.title
        : row.kind === "chore"
          ? context.today.chores[row.index]?.title
          : row.kind === "grocery"
            ? context.today.groceries[row.index]?.item
            : row.kind === "inventory"
              ? context.today.useSoon[row.index]?.item
              : row.kind === "dinner" && row.index === 0 && context.today.dinner
                ? (context.today.dinner.title ?? "Dinner")
                : undefined;
    const slot = `${row.kind}:${row.index}`;
    if (projected === undefined || projected !== row.label || slots.has(slot))
      return null;
    slots.add(slot);
  }
  try {
    const catalog = buildAssistantReferenceCatalog(
      rows,
      {
        userId: input.userId,
        familyId: input.familyId,
        role: input.role,
        generation: input.generation,
      },
      context.generatedAt,
    );
    return { context, catalog, sources: rows };
  } catch {
    return null;
  }
}
export function resolveAssistantEvidence(
  refs: string[],
  catalog: AssistantReferenceCatalog,
): AssistantEvidence[] | null {
  const byId = new Map(
    catalog.map((entry) => [entry.provider.ref, entry.evidence]),
  );
  if (
    refs.length > 8 ||
    new Set(refs).size !== refs.length ||
    refs.some((ref) => !byId.has(ref))
  )
    return null;
  return refs.map((ref) => byId.get(ref)!);
}
