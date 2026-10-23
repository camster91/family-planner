import { Prisma, type PrismaClient } from "@prisma/client";
import { lockHousehold, lockUser } from "@/lib/household-lock";
import { defaultPersonalLayout, type TodayLayout } from "@/lib/personal-layout";
import {
  personalDisplayRecordSchema,
  householdDisplayRecordSchema,
  effectivePersonalLayout,
  permittedFavorites,
  type DisplaySnapshot,
  type PersonalDisplayRecord,
} from "@/lib/display-preferences-schema";

type Actor = { userId: string; familyId: string | null; tokenVersion: number };
type Patch = {
  expectedRevision: number;
  today?: TodayLayout;
  favorites?: string[];
  quiet?: boolean;
  inheritToday?: true;
};
export class DisplayPreferencesError extends Error {
  constructor(
    readonly code: "UNAUTHORIZED" | "FORBIDDEN" | "CONFLICT" | "UNSUPPORTED",
  ) {
    super(code);
  }
}
/** Same user-then-household lock order as membership and account deletion. */
async function readLocked(tx: Prisma.TransactionClient, actor: Actor) {
  await lockUser(tx, actor.userId);
  if (actor.familyId) await lockHousehold(tx, actor.familyId);
  // Pin role/session/membership against writers that do not use advisory locks.
  await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${actor.userId} FOR UPDATE`;
  const user = await tx.user.findUnique({
    where: { id: actor.userId },
    select: {
      id: true,
      family_id: true,
      role: true,
      token_version: true,
      display_preferences: true,
      display_preferences_revision: true,
    },
  });
  if (!user || user.token_version !== actor.tokenVersion)
    throw new DisplayPreferencesError("UNAUTHORIZED");
  if (
    user.family_id !== actor.familyId ||
    !["parent", "teen", "child"].includes(user.role)
  )
    throw new DisplayPreferencesError("FORBIDDEN");
  const family = actor.familyId
    ? await tx.family.findUnique({
        where: { id: actor.familyId },
        select: { display_defaults: true, display_defaults_revision: true },
      })
    : null;
  if (actor.familyId && !family) throw new DisplayPreferencesError("FORBIDDEN");
  const personal = personalDisplayRecordSchema.safeParse(
    user.display_preferences ?? { version: 1 },
  );
  const defaults = householdDisplayRecordSchema.safeParse(
    family?.display_defaults ?? {
      version: 1,
      today: defaultPersonalLayout().today,
    },
  );
  if (!personal.success || !defaults.success)
    throw new DisplayPreferencesError("UNSUPPORTED");
  return {
    user,
    family,
    personal: personal.data,
    defaults: defaults.data.today,
  };
}
function snapshot(
  loaded: Awaited<ReturnType<typeof readLocked>>,
): DisplaySnapshot {
  return {
    version: 1,
    revision: loaded.user.display_preferences_revision,
    defaultsRevision: loaded.family?.display_defaults_revision ?? 0,
    layout: effectivePersonalLayout(
      loaded.personal,
      loaded.defaults,
      loaded.user.role,
    ),
    quiet: loaded.personal.quiet ?? false,
    defaultToday: loaded.defaults,
    personalizedToday: loaded.personal.today !== undefined,
    canManageDefaults: loaded.user.role === "parent" && loaded.family !== null,
  };
}
export async function readDisplayPreferences(db: PrismaClient, actor: Actor) {
  return db.$transaction(async (tx) => snapshot(await readLocked(tx, actor)));
}
export async function updateDisplayPreferences(
  db: PrismaClient,
  actor: Actor,
  patch: Patch,
) {
  return db.$transaction(async (tx) => {
    const loaded = await readLocked(tx, actor);
    if (loaded.user.display_preferences_revision !== patch.expectedRevision)
      throw new DisplayPreferencesError("CONFLICT");
    const next: PersonalDisplayRecord = { ...loaded.personal };
    if (patch.inheritToday) delete next.today;
    if (patch.today !== undefined) next.today = patch.today;
    if (patch.quiet !== undefined) next.quiet = patch.quiet;
    if (patch.favorites !== undefined)
      next.favorites = permittedFavorites(patch.favorites, loaded.user.role);
    const updated = await tx.user.updateMany({
      where: {
        id: actor.userId,
        family_id: actor.familyId,
        role: loaded.user.role,
        token_version: actor.tokenVersion,
        display_preferences_revision: patch.expectedRevision,
      },
      data: {
        display_preferences: next as Prisma.InputJsonValue,
        display_preferences_revision: { increment: 1 },
      },
    });
    if (updated.count !== 1) throw new DisplayPreferencesError("CONFLICT");
    loaded.personal = next;
    loaded.user.display_preferences_revision += 1;
    return snapshot(loaded);
  });
}
export async function updateDisplayDefaults(
  db: PrismaClient,
  actor: Actor,
  expectedRevision: number,
  today: TodayLayout,
) {
  return db.$transaction(async (tx) => {
    const loaded = await readLocked(tx, actor);
    if (loaded.user.role !== "parent" || !loaded.family || !actor.familyId)
      throw new DisplayPreferencesError("FORBIDDEN");
    if (loaded.family.display_defaults_revision !== expectedRevision)
      throw new DisplayPreferencesError("CONFLICT");
    const updated = await tx.family.updateMany({
      where: {
        id: actor.familyId,
        display_defaults_revision: expectedRevision,
      },
      data: {
        display_defaults: { version: 1, today } as Prisma.InputJsonValue,
        display_defaults_revision: { increment: 1 },
      },
    });
    if (updated.count !== 1) throw new DisplayPreferencesError("CONFLICT");
    loaded.defaults = today;
    loaded.family.display_defaults_revision += 1;
    return snapshot(loaded);
  });
}
