import { normalizeFeatures, type FamilyFeatures } from "./features";
/** Context freshness only: never a role, approval, write tool or replay receipt.
 * Canonical effects own permission, membership locks, validation and receipts. */
import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import type { Prisma, PrismaClient } from "@prisma/client";
import { NextResponse, type NextRequest } from "next/server";
import { getJwtSecret } from "./auth";
import { lockUser, lockHousehold } from "./household-lock";
import { memberIdentityIdSchema as id } from "./member-subject-contract";
import { assistantGroundingLeaseCurrent } from "./assistant-grounding-lease";
import { isAssistantTodayEnabled } from "./assistant-today-capability";
import {
  isAssistantReferencesEnabled,
  loadReferencedAssistantToday,
  type AssistantReferenceCatalog,
  type AssistantSourceRow,
} from "./assistant-references";
import {
  ASSISTANT_SOURCE_PROOF_HEADER,
  assistantConfirmationKind,
  type AssistantConfirmationKind,
} from "./assistant-reference-contract";
import type { AssistantTodayTransportContext } from "./assistant-context-schema";
export const isAssistantConfirmationEnabled = () =>
  process.env.FAMILY_ASSISTANT_CONFIRMATION_READY === "1" &&
  isAssistantReferencesEnabled() &&
  isAssistantTodayEnabled();
const ownerSchema = z
  .object({
    userId: id,
    familyId: id,
    role: z.enum(["parent", "teen"]),
    generation: z.number().int().min(0).max(2147483647),
  })
  .strict();
const proofSchema = z
  .object({
    v: z.literal(1),
    owner: ownerSchema,
    kind: assistantConfirmationKind,
    issuedAt: z.string().datetime(),
    expiresAt: z.string().datetime(),
    timeZone: z.string().min(1).max(100),
    localDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    context: z.string().regex(/^[a-f0-9]{64}$/),
    catalog: z.string().regex(/^[a-f0-9]{64}$/),
    features: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict();
export type AssistantProofActor = {
  userId: string;
  familyId: string;
  role: string;
  generation: number;
};
const mac = (domain: string, value: unknown, key: string) =>
  createHmac("sha256", key)
    .update(JSON.stringify([domain, value]))
    .digest("hex");
export class AssistantSourceRefused extends Error {
  readonly code = "ASSISTANT_SOURCE_REFUSED";
  constructor() {
    super(
      "The source information changed, expired or could not be checked. Refresh Today or use the app controls.",
    );
  }
  response() {
    return NextResponse.json(
      { error: this.message, code: this.code },
      { status: 409, headers: { "Cache-Control": "private, no-store" } },
    );
  }
}
export function issueAssistantSourceProof(
  owner: AssistantProofActor,
  kind: AssistantConfirmationKind,
  context: AssistantTodayTransportContext,
  catalog: AssistantReferenceCatalog,
  features: FamilyFeatures,
  key = getJwtSecret(),
) {
  const payload = proofSchema.parse({
    v: 1,
    owner,
    kind,
    issuedAt: context.generatedAt,
    expiresAt: context.expiresAt,
    timeZone: context.viewer.timeZone,
    localDate: context.viewer.localDate,
    context: mac("assistant-context.v1", context, key),
    catalog: mac("assistant-catalog.v1", catalog, key),
    features: mac("assistant-features.v1", normalizeFeatures(features), key),
  });
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `asb1.${encoded}.${mac("assistant-proof.v1", encoded, key)}`;
}
/** Decode has no expiry check: an already-completed canonical receipt can be
 * replayed under current authority after the context lease expires. */
export function readAssistantSourceProof(
  token: string,
  actor: AssistantProofActor,
  kind: AssistantConfirmationKind,
  key = getJwtSecret(),
) {
  try {
    if (token.length > 4096) throw new Error();
    const parts = /^asb1\.([A-Za-z0-9_-]+)\.([a-f0-9]{64})$/.exec(token);
    if (
      !parts ||
      !timingSafeEqual(
        Buffer.from(parts[2], "hex"),
        Buffer.from(mac("assistant-proof.v1", parts[1], key), "hex"),
      )
    )
      throw new Error();
    const bytes = Buffer.from(parts[1], "base64url");
    if (bytes.toString("base64url") !== parts[1]) throw new Error();
    const payload = proofSchema.parse(JSON.parse(bytes.toString("utf8")));
    if (
      payload.kind !== kind ||
      payload.owner.userId !== actor.userId ||
      payload.owner.familyId !== actor.familyId ||
      payload.owner.role !== actor.role ||
      payload.owner.generation !== actor.generation
    )
      throw new Error();
    return payload;
  } catch {
    throw new AssistantSourceRefused();
  }
}
function leaseCurrent(payload: z.infer<typeof proofSchema>, now: number) {
  return assistantGroundingLeaseCurrent(
    {
      generatedAt: payload.issuedAt,
      expiresAt: payload.expiresAt,
      viewer: { timeZone: payload.timeZone, localDate: payload.localDate },
    },
    now,
  );
}
/** Source IDs come only from the scoped server loader, never model/client URLs.
 * Lock parents before children, then reread. These are positive-record locks,
 * not predicate/range locks or a claim that a bounded Today window is complete. */
async function lockSources(
  tx: Prisma.TransactionClient,
  familyId: string,
  sources: AssistantSourceRow[],
) {
  const selected = (kind: AssistantSourceRow["kind"]) =>
    JSON.stringify(
      [
        ...new Set(
          sources.filter((row) => row.kind === kind).map((row) => row.id),
        ),
      ].sort(),
    );
  const users = new Set<string>(),
    recipes = new Set<string>(),
    lists = new Set<string>();
  for (const source of sources) {
    const input = source.versionInput as {
      row?: { cook?: { id?: string }; recipe?: { id?: string } };
      dependencies?: Array<{ id?: string }>;
    };
    for (const member of input.dependencies ?? [])
      if (id.safeParse(member.id).success) users.add(member.id!);
    if (id.safeParse(input.row?.cook?.id).success)
      users.add(input.row!.cook!.id!);
    if (id.safeParse(input.row?.recipe?.id).success)
      recipes.add(input.row!.recipe!.id!);
    if (source.containerId) lists.add(source.containerId);
  }
  await tx.$queryRaw`SELECT "id" FROM "User" WHERE "family_id"=${familyId} AND "id" IN (SELECT jsonb_array_elements_text(${JSON.stringify([...users].sort())}::jsonb)) ORDER BY "id" FOR SHARE`;
  await tx.$queryRaw`SELECT "id" FROM "Recipe" WHERE "family_id"=${familyId} AND "id" IN (SELECT jsonb_array_elements_text(${JSON.stringify([...recipes].sort())}::jsonb)) ORDER BY "id" FOR SHARE`;
  await tx.$queryRaw`SELECT "id" FROM "List" WHERE "family_id"=${familyId} AND "id" IN (SELECT jsonb_array_elements_text(${JSON.stringify([...lists].sort())}::jsonb)) ORDER BY "id" FOR SHARE`;
  await tx.$queryRaw`SELECT "id" FROM "Event" WHERE "family_id"=${familyId} AND "id" IN (SELECT jsonb_array_elements_text(${selected("event")}::jsonb)) ORDER BY "id" FOR SHARE`;
  await tx.$queryRaw`SELECT "id" FROM "Chore" WHERE "family_id"=${familyId} AND "id" IN (SELECT jsonb_array_elements_text(${selected("chore")}::jsonb)) ORDER BY "id" FOR SHARE`;
  await tx.$queryRaw`SELECT "id" FROM "FamilyMeal" WHERE "family_id"=${familyId} AND "id" IN (SELECT jsonb_array_elements_text(${selected("dinner")}::jsonb)) ORDER BY "id" FOR SHARE`;
  await tx.$queryRaw`SELECT i."id" FROM "ListItem" i JOIN "List" l ON l."id"=i."list_id" WHERE l."family_id"=${familyId} AND i."id" IN (SELECT jsonb_array_elements_text(${selected("grocery")}::jsonb)) ORDER BY i."id" FOR SHARE OF i`;
  await tx.$queryRaw`SELECT "id" FROM "InventoryItem" WHERE "family_id"=${familyId} AND "id" IN (SELECT jsonb_array_elements_text(${selected("inventory")}::jsonb)) ORDER BY "id" FOR SHARE`;
}
export type AssistantSourceGuard = {
  actor: AssistantProofActor;
  /** Caller already holds actor and household membership locks. */
  authorize: (tx: Prisma.TransactionClient) => Promise<void>;
  /** Recheck gates/lease after any intervening canonical target-lock waits. */
  assertCurrent?: () => void;
  /** After completed-receipt replay, before the first effect in the same tx. */
  verify: (tx: Prisma.TransactionClient) => Promise<void>;
};
export function assistantSourceGuard(
  request: Pick<NextRequest, "headers">,
  actor: AssistantProofActor,
  kind: AssistantConfirmationKind,
): AssistantSourceGuard | undefined {
  const token = request.headers.get(ASSISTANT_SOURCE_PROOF_HEADER);
  if (token === null) return undefined;
  const payload = readAssistantSourceProof(token, actor, kind);
  const authorize = async (tx: Prisma.TransactionClient) => {
    await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id"=${actor.userId} AND "family_id"=${actor.familyId} FOR SHARE`;
    await tx.$queryRaw`SELECT "id" FROM "Family" WHERE "id"=${actor.familyId} FOR SHARE`;
    const current = await tx.user.findUnique({
      where: { id: actor.userId },
      select: { family_id: true, role: true, token_version: true },
    });
    if (
      !current ||
      current.family_id !== actor.familyId ||
      current.role !== actor.role ||
      current.token_version !== actor.generation
    )
      throw new AssistantSourceRefused();
  };
  return {
    actor,
    authorize,
    assertCurrent() {
      if (
        !isAssistantConfirmationEnabled() ||
        !leaseCurrent(payload, Date.now())
      )
        throw new AssistantSourceRefused();
    },
    async verify(tx) {
      try {
        if (
          !isAssistantConfirmationEnabled() ||
          !isAssistantReferencesEnabled() ||
          !isAssistantTodayEnabled() ||
          !leaseCurrent(payload, Date.now())
        )
          throw new AssistantSourceRefused();
        const family = await tx.family.findUnique({
          where: { id: actor.familyId },
          select: { features: true },
        });
        if (
          !family ||
          mac(
            "assistant-features.v1",
            normalizeFeatures(family.features),
            getJwtSecret(),
          ) !== payload.features
        )
          throw new AssistantSourceRefused();
        const input = {
          ...actor,
          userId: actor.userId,
          familyId: actor.familyId,
          role: actor.role,
          generation: actor.generation,
          serverNow: new Date(payload.issuedAt),
          localNow: new Date(payload.issuedAt),
          viewerTimeZone: payload.timeZone,
          surface: "person" as const,
          materializeSeries: false,
        };
        const before = await loadReferencedAssistantToday(tx, input);
        if (!before) throw new AssistantSourceRefused();
        await lockSources(tx, actor.familyId, before.sources);
        const current = await loadReferencedAssistantToday(tx, input);
        if (
          !current ||
          mac("assistant-context.v1", current.context, getJwtSecret()) !==
            payload.context ||
          mac("assistant-catalog.v1", current.catalog, getJwtSecret()) !==
            payload.catalog ||
          !leaseCurrent(payload, Date.now()) ||
          !isAssistantConfirmationEnabled() ||
          !isAssistantReferencesEnabled() ||
          !isAssistantTodayEnabled()
        )
          throw new AssistantSourceRefused();
      } catch {
        throw new AssistantSourceRefused();
      }
    },
  };
}
export async function authorizeAssistantSourceReplay(
  db: Pick<PrismaClient, "$transaction">,
  guard: AssistantSourceGuard | undefined,
) {
  if (!guard) return null;
  await db.$transaction(async (tx) => {
    await lockUser(tx, guard.actor.userId);
    await lockHousehold(tx, guard.actor.familyId);
    await guard.authorize(tx);
  });
  return null;
}
