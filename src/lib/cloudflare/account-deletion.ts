/** Native D1 account, household, and membership deletion.
 *
 * The Prisma implementation remains the PostgreSQL path. Native effects use
 * a read witness plus one D1 primary-session batch; R2 and provider cleanup
 * only run after that batch commits.
 */
import { createHash, randomUUID } from "node:crypto";
import { captureD1Reads } from "./read-witness";
import { d1WriteCheck, isD1WriteConflict } from "./write-check";
import type { D1Store, D1Statement } from "./database";
import type { NativeD1 } from "./read-client";
import {
  privateObjectGenerationKey,
  privateObjectKey,
} from "./private-object-keys";
import { revokeProviderGrant } from "@/lib/calendar-sync/revoke";
import { prepareD1AuditLog, auditSummary } from "@/lib/household-audit";
import { rewriteRoutineFutureSubject } from "@/lib/routine-subject-lifecycle";
import {
  routineScheduleConfig,
  routineStepSeriesConfig,
} from "@/lib/routine-schedule";
import type {
  AccountDeletionCode,
  DeletionOptions,
} from "@/lib/account-deletion-shared";
import { IDEMPOTENCY_TTL_MS } from "@/lib/idempotency-key";
import { hashIdempotentRequest } from "@/lib/idempotency-hash";

export type NativeCalendarGrant = {
  id: string;
  family_id: string;
  provider: string;
  access_token_enc: string | null;
  refresh_token_enc: string | null;
  user_id?: string;
};

export type NativeDeletionDeps = {
  database?: D1Store;
  now?: () => Date;
  revokeCalendarGrant?: (
    grant: NativeCalendarGrant,
    familyId: string,
  ) => Promise<unknown>;
  removeObject?: (key: string) => Promise<void>;
  idempotencyKey?: string | null;
};

export class NativeAccountDeletionError extends Error {
  constructor(
    readonly code: AccountDeletionCode,
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "NativeAccountDeletionError";
  }
}

export class NativeMemberRemovalError extends Error {
  constructor(
    readonly code:
      | "NOT_A_PARENT"
      | "CANNOT_REMOVE_SELF"
      | "MEMBER_NOT_FOUND"
      | "LAST_PARENT"
      | "IDENTITY_CONFLICT",
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "NativeMemberRemovalError";
  }
}

type UserRow = {
  id: string;
  role: string;
  family_id: string | null;
  name: string;
  created_at: Date | number | null;
  token_version: number;
};
type ProfileRow = {
  id: string;
  family_id: string;
  archived_at: Date | number | null;
  erasure_user_id: string | null;
};
type RoutineRow = {
  id: string;
  family_id: string;
  recurrence_id: string | null;
  routine_series_config: unknown;
  title: string;
  description: string | null;
  points: number;
  assigned_to: string | null;
  assigned_member_id: string | null;
  member_subject_erased: boolean | number;
  due_date: Date | number;
  frequency: string;
  difficulty: string;
  icon: string | null;
  routine: string | null;
  routine_order: number | null;
  routine_stack_id: string | null;
  routine_anchor: string | null;
  routine_duration_minutes: number | null;
  is_template: boolean | number;
  created_by: string;
  weekly_days: unknown;
  rotation_member_ids: unknown;
  rotation_index: number | null;
  status: string;
};
type RoutineStackRow = {
  id: string;
  family_id: string;
  label: string;
  version: number;
  fingerprint: string;
  schedule_config: unknown;
};
type HistoricalMessageRow = {
  id: string;
  family_id: string;
  sender_id: string;
  read_by: unknown;
};
type HistoricalAuditRow = {
  id: string;
  family_id: string;
  actor_user_id: string | null;
  action: string;
  target_type: string;
  target_id: string | null;
};
type HistoricalDeviceRow = {
  id: string;
  family_id: string;
  label: string | null;
  created_by: string | null;
  confirmed_by: string | null;
  revoked_by: string | null;
  elevated_user_id: string | null;
  revoked_at: Date | number | null;
};
type HistoricalPairingRow = {
  id: string;
  family_id: string;
  created_by: string | null;
  confirmed_by: string | null;
  device_id: string | null;
};
type HistoricalInviteRow = {
  id: string;
  family_id: string;
  created_by: string;
  accepted_at: Date | number | null;
};
type HistoricalImportedRow = {
  id: string;
  family_id: string;
  target_model: string;
  target_id: string;
};
type Preflight = {
  actor: UserRow | null;
  family: { id: string; name: string } | null;
  members: UserRow[];
  profiles: ProfileRow[];
  links: Array<{ member_id: string; user_id: string; family_id: string }>;
  legacy: Array<{ member_id: string; user_id: string; family_id: string }>;
  /** All account claims for current-family profiles, including other users. */
  profileClaims: Array<{
    member_id: string;
    user_id: string;
    family_id: string;
  }>;
  grants: NativeCalendarGrant[];
  devices: Array<{
    id: string;
    label: string | null;
    created_by: string | null;
    confirmed_by: string | null;
    revoked_at: Date | number | null;
  }>;
  uploads: Array<{ id: string; family_id: string; filename: string }>;
  attachments: Array<{
    id: string;
    family_id: string;
    filename: string;
    message_id: string | null;
  }>;
  messages: Array<{ id: string; sender_id: string }>;
  routines: RoutineRow[];
  stacks: RoutineStackRow[];
  historicalRoutines: RoutineRow[];
  historicalMembers: UserRow[];
  historicalProfiles: ProfileRow[];
  historicalMessages: HistoricalMessageRow[];
  historicalAttachments: Array<{
    id: string;
    family_id: string;
    filename: string;
    message_id: string | null;
  }>;
  historicalAudits: HistoricalAuditRow[];
  historicalDevices: HistoricalDeviceRow[];
  historicalPairings: HistoricalPairingRow[];
  historicalInvites: HistoricalInviteRow[];
  historicalImports: HistoricalImportedRow[];
  historicalContentFamilies: string[];
  historicalOwnerFamilies: string[];
  legacyPhotos: string[];
  foreignLegacyPhotos: string[];
  foreignUploadNames: string[];
  idempotency: {
    family_id: string;
    user_id: string | null;
    action: string;
    request_hash: string;
    response_status: number | null;
  } | null;
};

/** Discover every family touched by the canonical retained-content/reference
 * ownership rules.  Account erasure must lock these households before the
 * User row (and its cascading personal rows) is removed; history-only tables
 * do not provide a reliable substitute for creator/reference discovery. */
async function discoverContentFamilies(
  read: any,
  userId: string,
): Promise<{ all: string[]; owners: string[] }> {
  const fields: Array<[string, string, string | null]> = [
    ["chore", "created_by", null],
    ["event", "created_by", null],
    ["list", "created_by", null],
    ["listItem", "added_by", "list"],
    ["reward", "created_by", null],
    ["transaction", "user_id", null],
    ["budgetCategory", "created_by", null],
    ["project", "created_by", null],
    ["familyMeal", "created_by", null],
    ["pinnedNote", "created_by", null],
    ["familyLocation", "user_id", null],
    ["pickup", "created_by", null],
    ["allowance", "from_user_id", null],
    ["handoff", "created_by", null],
    ["sickDay", "created_by", null],
    ["medication", "created_by", null],
    ["calendarSubscription", "created_by", null],
    ["importJob", "started_by", null],
    ["recipe", "created_by", null],
    ["mealPlan", "created_by", null],
    ["shoppingList", "created_by", null],
    ["habit", "created_by", null],
    ["familyGoal", "created_by", null],
    ["routineStack", "created_by", null],
    ["upload", "uploaded_by", null],
    // Personal rows whose ImportedRecord provenance must be captured before
    // the final User cascade. They are family discovery inputs even though
    // they are not retained-content owners.
    ["chore", "assigned_to", null],
    ["choreAssignment", "assigned_to", null],
    ["habitLog", "user_id", null],
    ["earnedBadge", "user_id", null],
    ["rewardRedemption", "requested_by", null],
    ["wishlistItem", "requested_by", null],
    ["listItem", "checked_by", "list"],
    ["reward", "claimed_by", null],
    ["reward", "approved_by", null],
    ["projectTask", "assigned_to", "project"],
    ["familyMeal", "cook_id", null],
    ["mealBatch", "cook_id", null],
    ["anniversary", "person_id", null],
    ["anniversary", "created_by", null],
    ["emergencyContact", "person_id", null],
    ["pickup", "assigned_to", null],
    ["wishlistItem", "status_changed_by", null],
    ["choreAssignment", "completed_by", null],
    ["choreAssignment", "approved_by", null],
    ["rewardRedemption", "approved_by", null],
    ["inventoryItem", "added_by", null],
    ["inventoryAdjustment", "actor_id", null],
    ["inventoryAdjustment", "undone_by", null],
    ["grocerySectionPreference", "updated_by", null],
    ["deviceAuditEvent", "actor_user_id", null],
    ["auditLog", "actor_user_id", null],
  ];
  const ownerFields = new Set([
    "chore:created_by",
    "event:created_by",
    "list:created_by",
    "listItem:added_by",
    "reward:created_by",
    "transaction:user_id",
    "budgetCategory:created_by",
    "project:created_by",
    "familyMeal:created_by",
    "pinnedNote:created_by",
    "familyLocation:user_id",
    "pickup:created_by",
    "allowance:from_user_id",
    "handoff:created_by",
    "sickDay:created_by",
    "medication:created_by",
    "calendarSubscription:created_by",
    "importJob:started_by",
    "recipe:created_by",
    "mealPlan:created_by",
    "shoppingList:created_by",
    "habit:created_by",
    "familyGoal:created_by",
  ]);
  const rows = await Promise.all(
    fields.map(async ([model, column, relation]) => {
      const select = relation
        ? { [relation]: { select: { family_id: true } } }
        : { family_id: true };
      const where =
        model === "chore" && column === "created_by"
          ? {
              created_by: userId,
              OR: [{ assigned_to: null }, { assigned_to: { not: userId } }],
            }
          : model === "allowance" && column === "from_user_id"
            ? { from_user_id: userId, to_user_id: { not: userId } }
            : (model === "sickDay" || model === "medication") &&
                column === "created_by"
              ? { created_by: userId, person_id: { not: userId } }
              : { [column]: userId };
      return (await read[model].findMany({ where, select })) as Array<
        Record<string, any>
      >;
    }),
  );
  const families = new Set<string>();
  const owners = new Set<string>();
  for (const [index, sourceRows] of rows.entries()) {
    const relation = fields[index][2];
    for (const row of sourceRows) {
      const familyId = relation ? row[relation]?.family_id : row.family_id;
      if (typeof familyId === "string" && familyId) {
        families.add(familyId);
        if (ownerFields.has(`${fields[index][0]}:${fields[index][1]}`))
          owners.add(familyId);
      }
    }
  }
  return { all: [...families].sort(), owners: [...owners].sort() };
}

function databaseOf(deps: NativeDeletionDeps): D1Store {
  if (!deps.database) throw new Error("D1 database is required");
  return deps.database;
}

function routineSelect() {
  return {
    id: true,
    family_id: true,
    recurrence_id: true,
    routine_series_config: true,
    title: true,
    description: true,
    points: true,
    assigned_to: true,
    assigned_member_id: true,
    member_subject_erased: true,
    due_date: true,
    frequency: true,
    difficulty: true,
    icon: true,
    routine: true,
    routine_order: true,
    routine_stack_id: true,
    routine_anchor: true,
    routine_duration_minutes: true,
    is_template: true,
    created_by: true,
    weekly_days: true,
    rotation_member_ids: true,
    rotation_index: true,
    status: true,
  };
}

function routineSubjectUser(raw: unknown): string | null {
  const value =
    typeof raw === "string"
      ? (() => {
          try {
            return JSON.parse(raw);
          } catch {
            return null;
          }
        })()
      : raw;
  const subject =
    value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>).content
      : null;
  const nested =
    subject && typeof subject === "object" && !Array.isArray(subject)
      ? (subject as Record<string, unknown>).subject
      : null;
  const user =
    nested && typeof nested === "object" && !Array.isArray(nested)
      ? (nested as Record<string, unknown>).user_id
      : null;
  return typeof user === "string" ? user : null;
}

function legacyPhotoName(value: string): string | null {
  const prefix = "/api/files/chores/";
  const rootPrefix = "/api/files/";
  const name = value.startsWith(prefix)
    ? value.slice(prefix.length)
    : value.startsWith(rootPrefix)
      ? value.slice(rootPrefix.length)
      : value;
  return /^[a-f0-9]{16}\.(jpg|jpeg|png|webp|heic)$/i.test(name) ? name : null;
}

function legacyPhotoAliases(name: string): string[] {
  return [`/api/files/chores/${name}`, `/api/files/${name}`, name];
}

const randomId = randomUUID;
function isIdempotencyConflict(error: unknown): boolean {
  return (
    error instanceof Error &&
    /IdempotencyRecord.*scope.*key|UNIQUE constraint failed/i.test(
      error.message,
    )
  );
}

function nowOf(deps: NativeDeletionDeps): Date {
  const now = deps.now?.() ?? new Date();
  if (!Number.isFinite(now.getTime()))
    throw new Error("Invalid deletion clock");
  return now;
}

async function readPreflight(
  db: D1Store,
  userId: string,
  familyId?: string | null,
  action?: string,
  idempotencyKey?: string | null,
) {
  return captureD1Reads(
    async (read): Promise<Preflight> => {
      const actor = await (read.user as any).findUnique({
        where: { id: userId },
        select: {
          id: true,
          role: true,
          family_id: true,
          name: true,
          created_at: true,
          token_version: true,
        },
      });
      const empty = {
        actor: null,
        family: null,
        members: [],
        profiles: [],
        links: [],
        legacy: [],
        profileClaims: [],
        grants: [],
        devices: [],
        uploads: [],
        attachments: [],
        messages: [],
        routines: [],
        stacks: [],
        historicalRoutines: [],
        historicalMembers: [],
        historicalProfiles: [],
        historicalMessages: [],
        historicalAttachments: [],
        historicalAudits: [],
        historicalDevices: [],
        historicalPairings: [],
        historicalInvites: [],
        historicalImports: [],
        historicalContentFamilies: [],
        historicalOwnerFamilies: [],
        legacyPhotos: [],
        foreignLegacyPhotos: [],
        foreignUploadNames: [],
        idempotency: null,
      } as Preflight;
      if (!actor) return empty;
      const currentFamily = familyId ?? actor.family_id;
      if (familyId && actor.family_id !== familyId)
        return {
          actor,
          family: null,
          members: [],
          profiles: [],
          links: [],
          legacy: [],
          profileClaims: [],
          grants: [],
          devices: [],
          uploads: [],
          attachments: [],
          messages: [],
          routines: [],
          stacks: [],
          historicalRoutines: [],
          historicalMembers: [],
          historicalProfiles: [],
          historicalMessages: [],
          historicalAttachments: [],
          historicalAudits: [],
          historicalDevices: [],
          historicalPairings: [],
          historicalInvites: [],
          historicalImports: [],
          historicalContentFamilies: [],
          historicalOwnerFamilies: [],
          legacyPhotos: [],
          foreignLegacyPhotos: [],
          foreignUploadNames: [],
          idempotency: null,
        };
      if (!currentFamily) {
        const [
          profiles,
          grants,
          historicalRoutines,
          historicalMessages,
          historicalAttachments,
          historicalAudits,
          historicalDevices,
          historicalPairings,
          historicalInvites,
          historicalImports,
          contentFamilies,
        ] = await Promise.all([
          (read.householdMember as any).findMany({
            where: { erasure_user_id: userId },
            select: {
              id: true,
              family_id: true,
              archived_at: true,
              erasure_user_id: true,
            },
          }),
          (read.calendarConnection as any).findMany({
            where: { user_id: userId },
            select: {
              id: true,
              family_id: true,
              user_id: true,
              provider: true,
              access_token_enc: true,
              refresh_token_enc: true,
            },
          }),
          (read.chore as any).findMany({
            where: { recurrence_id: { not: null } },
            select: routineSelect(),
            orderBy: [{ family_id: "asc" }, { id: "asc" }],
          }),
          (read.message as any).findMany({
            select: {
              id: true,
              family_id: true,
              sender_id: true,
              read_by: true,
            },
          }),
          (read.messageAttachment as any).findMany({
            select: {
              id: true,
              family_id: true,
              filename: true,
              message_id: true,
            },
          }),
          (read.auditLog as any).findMany({
            select: {
              id: true,
              family_id: true,
              actor_user_id: true,
              action: true,
              target_type: true,
              target_id: true,
            },
          }),
          (read.householdDevice as any).findMany({
            select: {
              id: true,
              family_id: true,
              label: true,
              created_by: true,
              confirmed_by: true,
              revoked_by: true,
              elevated_user_id: true,
              revoked_at: true,
            },
          }),
          (read.devicePairing as any).findMany({
            select: {
              id: true,
              family_id: true,
              created_by: true,
              confirmed_by: true,
              device_id: true,
            },
          }),
          (read.familyInvite as any).findMany({
            select: {
              id: true,
              family_id: true,
              created_by: true,
              accepted_at: true,
            },
          }),
          (read.importedRecord as any).findMany({
            select: {
              id: true,
              family_id: true,
              target_model: true,
              target_id: true,
            },
          }),
          discoverContentFamilies(read, userId),
        ]);
        // A detached account must not retain any profile claim. The canonical
        // path treats even a stale claim as an identity conflict instead of
        // silently erasing a profile that another household may still use.
        const [accountLinks, accountLegacy] = await Promise.all([
          (read.householdMemberAccountLink as any).findMany({
            where: { user_id: userId },
            select: { member_id: true, user_id: true, family_id: true },
          }),
          (read.householdMemberLegacyMapping as any).findMany({
            where: { user_id: userId },
            select: { member_id: true, user_id: true, family_id: true },
          }),
        ]);
        const historicalContentFamilies = (contentFamilies as { all: string[] })
          .all;
        const historicalOwnerFamilies = (
          contentFamilies as { owners: string[] }
        ).owners;
        const historicFamilies = [
          ...new Set([
            ...historicalContentFamilies,
            ...(profiles as ProfileRow[]).map((row) => row.family_id),
            ...(historicalRoutines as RoutineRow[])
              .filter(
                (row) =>
                  row.assigned_to === userId ||
                  routineSubjectUser(row.routine_series_config) === userId,
              )
              .map((row) => row.family_id),
            ...(historicalMessages as HistoricalMessageRow[])
              .filter(
                (row) =>
                  row.sender_id === userId ||
                  readByIncludes(row.read_by, userId),
              )
              .map((row) => row.family_id),
            ...(historicalAudits as HistoricalAuditRow[])
              .filter(
                (row) =>
                  row.actor_user_id === userId || row.target_id === userId,
              )
              .map((row) => row.family_id),
            ...(historicalDevices as HistoricalDeviceRow[])
              .filter((row) =>
                [
                  row.created_by,
                  row.confirmed_by,
                  row.revoked_by,
                  row.elevated_user_id,
                ].includes(userId),
              )
              .map((row) => row.family_id),
            ...(historicalPairings as HistoricalPairingRow[])
              .filter((row) =>
                [row.created_by, row.confirmed_by].includes(userId),
              )
              .map((row) => row.family_id),
            ...(historicalInvites as HistoricalInviteRow[])
              .filter((row) => row.created_by === userId)
              .map((row) => row.family_id),
          ]),
        ];
        const [historicalMembers, historicalStacks] = historicFamilies.length
          ? await Promise.all([
              (read.user as any).findMany({
                where: { family_id: { in: historicFamilies } },
                select: {
                  id: true,
                  role: true,
                  family_id: true,
                  name: true,
                  created_at: true,
                  token_version: true,
                },
                orderBy: [{ created_at: "asc" }, { id: "asc" }],
              }),
              (read.routineStack as any).findMany({
                where: { family_id: { in: historicFamilies } },
                select: {
                  id: true,
                  family_id: true,
                  label: true,
                  version: true,
                  fingerprint: true,
                  schedule_config: true,
                },
                orderBy: { id: "asc" },
              }),
            ])
          : [[], []];
        return {
          actor,
          family: null,
          members: [],
          profiles: [],
          links: accountLinks as Array<{
            member_id: string;
            user_id: string;
            family_id: string;
          }>,
          legacy: accountLegacy as Array<{
            member_id: string;
            user_id: string;
            family_id: string;
          }>,
          profileClaims: [],
          grants,
          devices: [],
          uploads: [],
          attachments: [],
          messages: [],
          routines: [],
          stacks: (historicalStacks as RoutineStackRow[]).filter(
            (stack) => stack.schedule_config != null,
          ),
          historicalRoutines: historicalRoutines as RoutineRow[],
          historicalMembers: historicalMembers as UserRow[],
          historicalProfiles: profiles as ProfileRow[],
          historicalMessages: historicalMessages as HistoricalMessageRow[],
          historicalAttachments: historicalAttachments as Array<{
            id: string;
            family_id: string;
            filename: string;
            message_id: string | null;
          }>,
          historicalAudits: historicalAudits as HistoricalAuditRow[],
          historicalDevices: historicalDevices as HistoricalDeviceRow[],
          historicalPairings: historicalPairings as HistoricalPairingRow[],
          historicalInvites: historicalInvites as HistoricalInviteRow[],
          historicalImports: historicalImports as HistoricalImportedRow[],
          historicalContentFamilies,
          historicalOwnerFamilies,
          legacyPhotos: [],
          foreignLegacyPhotos: [],
          foreignUploadNames: [],
          idempotency: null,
        };
      }
      const [
        family,
        members,
        profiles,
        links,
        legacy,
        grants,
        devices,
        uploads,
        attachments,
        messages,
        routines,
        stacks,
        chorePhotos,
        assignmentPhotos,
        historicalRoutines,
        historicalProfiles,
        historicalMessages,
        historicalAttachments,
        historicalAudits,
        historicalDevices,
        historicalPairings,
        historicalInvites,
        historicalImports,
        historicalStacks,
        contentFamilies,
        idempotency,
      ] = await Promise.all([
        (read.family as any).findUnique({
          where: { id: currentFamily },
          select: { id: true, name: true },
        }),
        (read.user as any).findMany({
          where: { family_id: currentFamily },
          select: {
            id: true,
            role: true,
            family_id: true,
            name: true,
            created_at: true,
            token_version: true,
          },
          orderBy: [{ created_at: "asc" }, { id: "asc" }],
        }),
        (read.householdMember as any).findMany({
          where: { family_id: currentFamily },
          select: {
            id: true,
            family_id: true,
            archived_at: true,
            erasure_user_id: true,
          },
        }),
        (read.householdMemberAccountLink as any).findMany({
          where: { family_id: currentFamily },
          select: { member_id: true, user_id: true, family_id: true },
        }),
        (read.householdMemberLegacyMapping as any).findMany({
          where: { family_id: currentFamily },
          select: { member_id: true, user_id: true, family_id: true },
        }),
        (read.calendarConnection as any).findMany({
          where: { family_id: currentFamily },
          select: {
            id: true,
            family_id: true,
            provider: true,
            access_token_enc: true,
            refresh_token_enc: true,
            user_id: true,
          },
        }),
        (read.householdDevice as any).findMany({
          where: { family_id: currentFamily, revoked_at: null },
          select: {
            id: true,
            label: true,
            created_by: true,
            confirmed_by: true,
            revoked_at: true,
          },
        }),
        (read.upload as any).findMany({
          where: { family_id: currentFamily },
          select: { id: true, family_id: true, filename: true },
        }),
        (read.messageAttachment as any).findMany({
          where: { family_id: currentFamily },
          select: {
            id: true,
            family_id: true,
            filename: true,
            message_id: true,
          },
        }),
        (read.message as any).findMany({
          where: { family_id: currentFamily },
          select: { id: true, sender_id: true },
        }),
        (read.chore as any).findMany({
          where: { family_id: currentFamily, recurrence_id: { not: null } },
          select: routineSelect(),
          orderBy: [{ due_date: "asc" }, { id: "asc" }],
        }),
        (read.routineStack as any).findMany({
          where: { family_id: currentFamily },
          select: {
            id: true,
            family_id: true,
            label: true,
            version: true,
            fingerprint: true,
            schedule_config: true,
          },
          orderBy: { id: "asc" },
        }),
        (read.chore as any).findMany({
          where: { family_id: currentFamily, photo_url: { not: null } },
          select: { photo_url: true },
        }),
        (read.choreAssignment as any).findMany({
          where: { family_id: currentFamily, photo_url: { not: null } },
          select: { photo_url: true },
        }),
        (read.chore as any).findMany({
          where: { recurrence_id: { not: null } },
          select: routineSelect(),
          orderBy: [{ family_id: "asc" }, { id: "asc" }],
        }),
        (read.householdMember as any).findMany({
          where: { erasure_user_id: userId },
          select: {
            id: true,
            family_id: true,
            archived_at: true,
            erasure_user_id: true,
          },
        }),
        (read.message as any).findMany({
          select: { id: true, family_id: true, sender_id: true, read_by: true },
        }),
        (read.messageAttachment as any).findMany({
          select: {
            id: true,
            family_id: true,
            filename: true,
            message_id: true,
          },
        }),
        (read.auditLog as any).findMany({
          select: {
            id: true,
            family_id: true,
            actor_user_id: true,
            action: true,
            target_type: true,
            target_id: true,
          },
        }),
        (read.householdDevice as any).findMany({
          select: {
            id: true,
            family_id: true,
            label: true,
            created_by: true,
            confirmed_by: true,
            revoked_by: true,
            elevated_user_id: true,
            revoked_at: true,
          },
        }),
        (read.devicePairing as any).findMany({
          select: {
            id: true,
            family_id: true,
            created_by: true,
            confirmed_by: true,
            device_id: true,
          },
        }),
        (read.familyInvite as any).findMany({
          select: {
            id: true,
            family_id: true,
            created_by: true,
            accepted_at: true,
          },
        }),
        (read.importedRecord as any).findMany({
          select: {
            id: true,
            family_id: true,
            target_model: true,
            target_id: true,
          },
        }),
        (read.routineStack as any).findMany({
          select: {
            id: true,
            family_id: true,
            label: true,
            version: true,
            fingerprint: true,
            schedule_config: true,
          },
          orderBy: { id: "asc" },
        }),
        discoverContentFamilies(read, userId),
        action && idempotencyKey
          ? (read.idempotencyRecord as any).findUnique({
              where: {
                scope_key: { scope: `user:${userId}`, key: idempotencyKey },
              },
              select: {
                family_id: true,
                user_id: true,
                action: true,
                request_hash: true,
                response_status: true,
              },
            })
          : Promise.resolve(null),
      ]);
      const legacyPhotos = [
        ...new Set(
          [...chorePhotos, ...assignmentPhotos]
            .map((row: { photo_url: string }) => legacyPhotoName(row.photo_url))
            .filter(
              (name: string | null): name is string =>
                Boolean(name) &&
                !(uploads as Array<{ filename: string }>).some(
                  (upload) => upload.filename === name,
                ),
            ),
        ),
      ];
      const aliases = legacyPhotos.flatMap(legacyPhotoAliases);
      const [foreignChores, foreignAssignments, foreignUploads] = aliases.length
        ? await Promise.all([
            (read.chore as any).findMany({
              where: {
                family_id: { not: currentFamily },
                photo_url: { in: aliases },
              },
              select: { photo_url: true },
            }),
            (read.choreAssignment as any).findMany({
              where: {
                family_id: { not: currentFamily },
                photo_url: { in: aliases },
              },
              select: { photo_url: true },
            }),
            (read.upload as any).findMany({
              where: {
                family_id: { not: currentFamily },
                filename: { in: legacyPhotos },
              },
              select: { filename: true },
            }),
          ])
        : [[], [], []];
      const historicalContentFamilies = (contentFamilies as { all: string[] })
        .all;
      const historicalOwnerFamilies = (contentFamilies as { owners: string[] })
        .owners;
      const historicalFamilyIds = [
        ...new Set(
          [
            ...historicalContentFamilies,
            ...(historicalProfiles as ProfileRow[]).map((row) => row.family_id),
            ...(historicalRoutines as RoutineRow[])
              .filter(
                (row) =>
                  row.assigned_to === userId ||
                  routineSubjectUser(row.routine_series_config) === userId,
              )
              .map((row) => row.family_id),
            ...(historicalMessages as HistoricalMessageRow[])
              .filter(
                (row) =>
                  row.sender_id === userId ||
                  readByIncludes(row.read_by, userId),
              )
              .map((row) => row.family_id),
            ...(historicalAudits as HistoricalAuditRow[])
              .filter(
                (row) =>
                  row.actor_user_id === userId || row.target_id === userId,
              )
              .map((row) => row.family_id),
            ...(historicalDevices as HistoricalDeviceRow[])
              .filter((row) =>
                [
                  row.created_by,
                  row.confirmed_by,
                  row.revoked_by,
                  row.elevated_user_id,
                ].includes(userId),
              )
              .map((row) => row.family_id),
            ...(historicalPairings as HistoricalPairingRow[])
              .filter((row) =>
                [row.created_by, row.confirmed_by].includes(userId),
              )
              .map((row) => row.family_id),
            ...(historicalInvites as HistoricalInviteRow[])
              .filter((row) => row.created_by === userId)
              .map((row) => row.family_id),
          ].filter((id) => id !== currentFamily),
        ),
      ];
      const historicalMembers = historicalFamilyIds.length
        ? await (read.user as any).findMany({
            where: { family_id: { in: historicalFamilyIds } },
            select: {
              id: true,
              role: true,
              family_id: true,
              name: true,
              created_at: true,
              token_version: true,
            },
            orderBy: [{ created_at: "asc" }, { id: "asc" }],
          })
        : [];
      const historicalFamilySet = new Set(historicalFamilyIds);
      const profileIdsForClaims = (profiles as ProfileRow[]).map(
        (profile) => profile.id,
      );
      const [profileLinkClaims, profileLegacyClaims] =
        profileIdsForClaims.length
          ? await Promise.all([
              (read.householdMemberAccountLink as any).findMany({
                where: { member_id: { in: profileIdsForClaims } },
                select: { member_id: true, user_id: true, family_id: true },
              }),
              (read.householdMemberLegacyMapping as any).findMany({
                where: { member_id: { in: profileIdsForClaims } },
                select: { member_id: true, user_id: true, family_id: true },
              }),
            ])
          : [[], []];
      return {
        actor,
        family,
        members,
        profiles,
        links,
        legacy,
        profileClaims: [
          ...(profileLinkClaims as Array<{
            member_id: string;
            user_id: string;
            family_id: string;
          }>),
          ...(profileLegacyClaims as Array<{
            member_id: string;
            user_id: string;
            family_id: string;
          }>),
        ],
        grants,
        devices,
        uploads,
        attachments,
        messages,
        routines: routines as RoutineRow[],
        stacks: [
          ...(stacks as RoutineStackRow[]),
          ...(historicalStacks as RoutineStackRow[]),
        ].filter(
          (stack, index, all) =>
            stack.schedule_config != null &&
            all.findIndex((candidate) => candidate.id === stack.id) === index,
        ),
        historicalRoutines: (historicalRoutines as RoutineRow[]).filter((row) =>
          historicalFamilySet.has(row.family_id),
        ),
        historicalMembers: historicalMembers as UserRow[],
        historicalProfiles: historicalProfiles as ProfileRow[],
        historicalMessages: historicalMessages as HistoricalMessageRow[],
        historicalAttachments: historicalAttachments as Array<{
          id: string;
          family_id: string;
          filename: string;
          message_id: string | null;
        }>,
        historicalAudits: historicalAudits as HistoricalAuditRow[],
        historicalDevices: historicalDevices as HistoricalDeviceRow[],
        historicalPairings: historicalPairings as HistoricalPairingRow[],
        historicalInvites: historicalInvites as HistoricalInviteRow[],
        historicalImports: historicalImports as HistoricalImportedRow[],
        historicalContentFamilies,
        historicalOwnerFamilies,
        legacyPhotos,
        foreignLegacyPhotos: [
          ...new Set(
            [...foreignChores, ...foreignAssignments]
              .map((row: { photo_url: string }) =>
                legacyPhotoName(row.photo_url),
              )
              .filter((name: string | null): name is string => Boolean(name)),
          ),
        ],
        foreignUploadNames: [
          ...new Set(
            (foreignUploads as Array<{ filename: string }>).map(
              (row) => row.filename,
            ),
          ),
        ],
        idempotency,
      };
    },
    db as unknown as NativeD1,
  );
}

function successorFor(pre: Preflight, actor: UserRow): UserRow | null {
  const others = pre.members.filter((member) => member.id !== actor.id);
  return others.find((member) => member.role === "parent") ?? others[0] ?? null;
}

function profileIds(
  pre: Preflight,
  userId: string,
  familyId: string,
): string[] {
  return [
    ...new Set(
      [...pre.links, ...pre.legacy]
        .filter((row) => row.user_id === userId && row.family_id === familyId)
        .map((row) => row.member_id),
    ),
  ].sort();
}

function readByIncludes(raw: unknown, userId: string): boolean {
  const value =
    typeof raw === "string"
      ? (() => {
          try {
            return JSON.parse(raw);
          } catch {
            return [];
          }
        })()
      : raw;
  return Array.isArray(value) && value.some((entry) => entry === userId);
}

function historicalFamilyIds(
  pre: Preflight,
  userId: string,
  currentFamily: string | null,
): string[] {
  const families = new Set<string>();
  const add = (familyId: string | null | undefined) => {
    if (familyId && familyId !== currentFamily) families.add(familyId);
  };
  for (const familyId of pre.historicalContentFamilies) add(familyId);
  for (const row of pre.historicalProfiles) add(row.family_id);
  for (const row of pre.historicalRoutines) add(row.family_id);
  for (const row of pre.historicalMessages)
    if (row.sender_id === userId || readByIncludes(row.read_by, userId))
      add(row.family_id);
  for (const row of pre.historicalAudits)
    if (row.actor_user_id === userId || row.target_id === userId)
      add(row.family_id);
  for (const row of pre.historicalDevices)
    if (
      [
        row.created_by,
        row.confirmed_by,
        row.revoked_by,
        row.elevated_user_id,
      ].includes(userId)
    )
      add(row.family_id);
  for (const row of pre.historicalPairings)
    if ([row.created_by, row.confirmed_by].includes(userId)) add(row.family_id);
  for (const row of pre.historicalInvites)
    if (row.created_by === userId) add(row.family_id);
  const personalImportModels = new Set([
    "Chore",
    "ChoreAssignment",
    "HabitLog",
    "EarnedBadge",
    "RewardRedemption",
    "WishlistItem",
  ]);
  for (const row of pre.historicalImports)
    if (personalImportModels.has(row.target_model)) add(row.family_id);
  return [...families].sort();
}

function assertOneProfile(
  pre: Preflight,
  userId: string,
  familyId: string,
): string[] {
  const ids = profileIds(pre, userId, familyId);
  const claims = [...pre.links, ...pre.legacy];
  const ownsAProfileElsewhere = claims.some(
    (claim) => claim.user_id === userId && claim.family_id !== familyId,
  );
  const profileIsClaimedByAnotherAccount = pre.profileClaims.some(
    (claim) => claim.user_id !== userId && ids.includes(claim.member_id),
  );
  if (
    ids.length > 1 ||
    ownsAProfileElsewhere ||
    profileIsClaimedByAnotherAccount ||
    ids.some(
      (id) =>
        !pre.profiles.some(
          (profile) => profile.id === id && profile.family_id === familyId,
        ),
    )
  ) {
    throw new NativeAccountDeletionError(
      "IDENTITY_CONFLICT",
      409,
      "Household member identity needs review before this change.",
    );
  }
  return ids;
}

function assertAccountCanLeave(pre: Preflight, actor: UserRow): UserRow {
  const successor = successorFor(pre, actor);
  if (
    actor.role === "parent" &&
    !pre.members.some(
      (member) => member.id !== actor.id && member.role === "parent",
    )
  ) {
    throw new NativeAccountDeletionError(
      "LAST_PARENT",
      409,
      "You are the only parent in this household. Add another parent first, or delete the whole household.",
    );
  }
  if (!successor)
    throw new NativeAccountDeletionError(
      "NO_SUCCESSOR",
      409,
      "You are the last member of this household. Ask a parent to delete the household instead.",
    );
  return successor;
}

function ownerStatements(
  session: Pick<D1Store, "prepare">,
  familyId: string,
  leaving: string,
  successor: string,
): D1Statement[] {
  const statements: D1Statement[] = [];
  const owners: Array<[string, string]> = [
    ["Chore", "created_by"],
    ["Event", "created_by"],
    ["List", "created_by"],
    ["Reward", "created_by"],
    ["Transaction", "user_id"],
    ["BudgetCategory", "created_by"],
    ["Project", "created_by"],
    ["FamilyMeal", "created_by"],
    ["PinnedNote", "created_by"],
    ["FamilyLocation", "user_id"],
    ["Pickup", "created_by"],
    ["Allowance", "from_user_id"],
    ["Handoff", "created_by"],
    ["SickDay", "created_by"],
    ["Medication", "created_by"],
    ["CalendarSubscription", "created_by"],
    ["ImportJob", "started_by"],
    ["Recipe", "created_by"],
    ["MealPlan", "created_by"],
    ["ShoppingList", "created_by"],
    ["Habit", "created_by"],
    ["FamilyGoal", "created_by"],
  ];
  for (const [table, column] of owners) {
    statements.push(
      session
        .prepare(
          `UPDATE "${table}" SET "${column}"=?1 WHERE family_id=?2 AND "${column}"=?3`,
        )
        .bind(successor, familyId, leaving),
    );
  }
  statements.push(
    session
      .prepare(
        'UPDATE "ListItem" SET added_by=?1 WHERE list_id IN (SELECT id FROM "List" WHERE family_id=?2) AND added_by=?3',
      )
      .bind(successor, familyId, leaving),
  );
  // Routine stacks intentionally keep their original creator as provenance;
  // the FK is nullable, so clear it before the User row is removed.
  statements.push(
    session
      .prepare(
        'UPDATE "RoutineStack" SET created_by=NULL WHERE family_id=?1 AND created_by=?2',
      )
      .bind(familyId, leaving),
  );
  return statements;
}

function referenceStatements(
  session: Pick<D1Store, "prepare">,
  familyId: string,
  leaving: string,
): D1Statement[] {
  const statements: D1Statement[] = [];
  const refs: Array<[string, string]> = [
    ["ListItem", "checked_by"],
    ["Reward", "claimed_by"],
    ["Reward", "approved_by"],
    ["ProjectTask", "assigned_to"],
    ["FamilyMeal", "cook_id"],
    ["MealBatch", "cook_id"],
    ["Anniversary", "person_id"],
    ["Anniversary", "created_by"],
    ["EmergencyContact", "person_id"],
    ["Pickup", "assigned_to"],
    ["WishlistItem", "status_changed_by"],
    ["ChoreAssignment", "completed_by"],
    ["ChoreAssignment", "approved_by"],
    ["RewardRedemption", "approved_by"],
    ["InventoryItem", "added_by"],
    ["InventoryAdjustment", "actor_id"],
    ["InventoryAdjustment", "undone_by"],
    ["GrocerySectionPreference", "updated_by"],
    ["DeviceAuditEvent", "actor_user_id"],
    ["AuditLog", "actor_user_id"],
  ];
  for (const [table, column] of refs) {
    // These child tables derive household ownership through their parent and
    // intentionally do not carry a family_id column in D1. Keep the scope
    // equivalent to householdContentScope() instead of preparing invalid SQL.
    const scope =
      table === "ListItem"
        ? 'list_id IN (SELECT id FROM "List" WHERE family_id=?1)'
        : table === "ProjectTask"
          ? 'project_id IN (SELECT id FROM "Project" WHERE family_id=?1)'
          : "family_id=?1";
    statements.push(
      session
        .prepare(
          `UPDATE "${table}" SET "${column}"=NULL WHERE ${scope} AND "${column}"=?2`,
        )
        .bind(familyId, leaving),
    );
  }
  return statements;
}

function routineStatements(
  session: Pick<D1Store, "prepare">,
  pre: Preflight,
  familyId: string,
  userId: string,
  memberIds: string[],
  kind: "erase" | "invalidate",
): D1Statement[] {
  const statements: D1Statement[] = [];
  for (const row of pre.routines) {
    if (row.family_id !== familyId || row.recurrence_id !== row.id) continue;
    const rewrite = rewriteRoutineFutureSubject(row.routine_series_config, {
      kind,
      userId,
      memberIds,
    });
    if (!rewrite) continue;
    const oldValue =
      typeof row.routine_series_config === "string"
        ? row.routine_series_config
        : JSON.stringify(row.routine_series_config);
    statements.push(
      session
        .prepare(
          'UPDATE "Chore" SET routine_series_config=?1 WHERE id=?2 AND family_id=?3 AND recurrence_id=id AND routine_series_config=?4',
        )
        .bind(JSON.stringify(rewrite.value), row.id, familyId, oldValue),
    );
    statements.push(d1WriteCheck(session, "changes()=1"));
  }
  return statements;
}

function routineControlConfig(
  raw: unknown,
  userId: string,
  memberIds: string[],
  mode: "erase" | "invalidate",
): Record<string, unknown> | null {
  const rewritten =
    mode === "erase"
      ? rewriteRoutineFutureSubject(raw, { kind: "erase", userId, memberIds })
          ?.value
      : rewriteRoutineFutureSubject(raw, {
          kind: "invalidate",
          userId,
          memberIds,
        })?.value;
  const parsed = routineStepSeriesConfig.safeParse(rewritten ?? raw);
  if (!parsed.success) return null;
  return {
    ...parsed.data,
    revision: Math.min(2147483647, parsed.data.revision + 1),
    anchor_retired: true,
    once_pending:
      parsed.data.schedule.frequency === "once" &&
      parsed.data.state !== "stopped",
  };
}

function routineControlHandoverStatements(
  session: Pick<D1Store, "prepare">,
  rows: RoutineRow[],
  stacks: RoutineStackRow[],
  familyId: string,
  userId: string,
  successorId: string,
  memberIds: string[],
  mode: "erase" | "invalidate",
  now: Date,
): { statements: D1Statement[]; replacements: Map<string, string> } {
  const statements: D1Statement[] = [];
  const replacements = new Map<string, string>();
  const roots = rows
    .filter(
      (row) =>
        row.family_id === familyId &&
        row.assigned_to === userId &&
        row.recurrence_id === row.id &&
        row.routine_series_config != null,
    )
    .sort((a, b) => a.id.localeCompare(b.id));
  for (const root of roots) {
    const config = routineControlConfig(
      root.routine_series_config,
      userId,
      memberIds,
      mode,
    );
    if (!config) continue;
    const series = rows.filter(
      (row) => row.family_id === familyId && row.recurrence_id === root.id,
    );
    const oldest = series.reduce<RoutineRow | null>((current, row) => {
      if (!current) return row;
      const currentTime =
        current.due_date instanceof Date
          ? current.due_date.getTime()
          : Number(current.due_date);
      const rowTime =
        row.due_date instanceof Date
          ? row.due_date.getTime()
          : Number(row.due_date);
      return rowTime < currentTime ||
        (rowTime === currentTime && row.id < current.id)
        ? row
        : current;
    }, null);
    if (!oldest) continue;
    const due =
      oldest.due_date instanceof Date
        ? oldest.due_date.getTime()
        : Number(oldest.due_date);
    if (!Number.isFinite(due)) continue;
    const controlDate = due - 86400000;
    if (!Number.isFinite(controlDate)) continue;
    const newId = randomUUID();
    const content = (
      config.content && typeof config.content === "object" ? config.content : {}
    ) as Record<string, any>;
    const schedule = (
      config.schedule && typeof config.schedule === "object"
        ? config.schedule
        : {}
    ) as Record<string, any>;
    statements.push(
      session
        .prepare(
          `INSERT INTO "Chore" (id,family_id,created_by,title,description,points,difficulty,icon,due_date,recurrence_id,is_template,frequency,status,assigned_to,assigned_member_id,member_subject_erased,created_at,routine_stack_id,routine_anchor,routine_duration_minutes,routine,routine_order,weekly_days,routine_series_config)
      VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?1,?10,?11,'pending',NULL,NULL,1,?12,NULL,NULL,NULL,NULL,NULL,?13,?14)`,
        )
        .bind(
          newId,
          familyId,
          successorId,
          String(content.title ?? root.title),
          content.description == null ? null : String(content.description),
          Number.isInteger(content.points) ? content.points : root.points,
          typeof content.difficulty === "string"
            ? content.difficulty
            : root.difficulty,
          content.icon == null ? root.icon : String(content.icon),
          controlDate,
          config.state !== "stopped" && schedule.frequency !== "once" ? 1 : 0,
          schedule.frequency === "once"
            ? "once"
            : String(schedule.frequency ?? root.frequency),
          now.getTime(),
          JSON.stringify(
            Array.isArray(schedule.weekly_days) ? schedule.weekly_days : [],
          ),
          JSON.stringify(config),
        ),
      d1WriteCheck(session, "changes()=1"),
    );
    statements.push(
      session
        .prepare(
          'UPDATE "Chore" SET recurrence_id=?1 WHERE family_id=?2 AND recurrence_id=?3 AND id<>?3',
        )
        .bind(newId, familyId, root.id),
    );
    replacements.set(root.id, newId);
  }
  if (!replacements.size) return { statements, replacements };
  for (const stack of stacks.filter((row) => row.family_id === familyId)) {
    const schedule = routineScheduleConfig.safeParse(stack.schedule_config);
    if (!schedule.success) continue;
    let changed = false;
    const steps = schedule.data.steps.map((step) => {
      const replacement = replacements.get(step.template_id);
      if (!replacement) return step;
      changed = true;
      return { template_id: replacement };
    });
    if (!changed) continue;
    const config = { ...schedule.data, steps };
    const version = Math.min(2147483647, stack.version + 1);
    const fingerprint = createHash("sha256")
      .update(JSON.stringify({ label: stack.label, version, config }))
      .digest("hex");
    statements.push(
      session
        .prepare(
          'UPDATE "RoutineStack" SET version=?1,fingerprint=?2,schedule_config=?3,updated_at=?4 WHERE id=?5 AND family_id=?6 AND version=?7',
        )
        .bind(
          version,
          fingerprint,
          JSON.stringify(config),
          now.getTime(),
          stack.id,
          familyId,
          stack.version,
        ),
      d1WriteCheck(session, "changes()=1"),
    );
  }
  return { statements, replacements };
}

function rotationMemberIds(raw: unknown): string[] {
  const value =
    typeof raw === "string"
      ? (() => {
          try {
            return JSON.parse(raw);
          } catch {
            return [];
          }
        })()
      : raw;
  return Array.isArray(value)
    ? value.filter((id): id is string => typeof id === "string")
    : [];
}

function rotationStatements(
  session: Pick<D1Store, "prepare">,
  rows: RoutineRow[],
  familyId: string,
  userId: string,
): D1Statement[] {
  const statements: D1Statement[] = [];
  for (const root of rows.filter(
    (row) => row.family_id === familyId && row.recurrence_id === row.id,
  )) {
    const rotation = rotationMemberIds(root.rotation_member_ids);
    const removedAt = rotation.indexOf(userId);
    if (removedAt < 0) continue;
    const rest = rotation.filter((id) => id !== userId);
    statements.push(
      session
        .prepare(
          'UPDATE "Chore" SET rotation_member_ids=?1 WHERE id=?2 AND family_id=?3 AND rotation_member_ids=?4',
        )
        .bind(
          JSON.stringify(rest),
          root.id,
          familyId,
          typeof root.rotation_member_ids === "string"
            ? root.rotation_member_ids
            : JSON.stringify(rotation),
        ),
    );
    if (removedAt === 0)
      statements.push(
        session
          .prepare(
            'UPDATE "Chore" SET rotation_index=NULL WHERE family_id=?1 AND recurrence_id=?2 AND rotation_index=0',
          )
          .bind(familyId, root.id),
      );
    else
      statements.push(
        session
          .prepare(
            'UPDATE "Chore" SET rotation_index=NULL WHERE family_id=?1 AND recurrence_id=?2 AND rotation_index=?3',
          )
          .bind(familyId, root.id, removedAt),
      );
    if (rest.length > 0)
      statements.push(
        session
          .prepare(
            'UPDATE "Chore" SET rotation_index=rotation_index-1 WHERE family_id=?1 AND recurrence_id=?2 AND rotation_index>?3',
          )
          .bind(familyId, root.id, removedAt),
      );
    else
      statements.push(
        session
          .prepare(
            'UPDATE "Chore" SET rotation_index=NULL WHERE family_id=?1 AND recurrence_id=?2',
          )
          .bind(familyId, root.id),
      );
  }
  return statements;
}

type HistoricalStatementPlan = {
  statements: D1Statement[];
  routineRootIds: string[];
};

function historicalStatements(
  session: Pick<D1Store, "prepare">,
  pre: Preflight,
  familyId: string,
  userId: string,
  successor: UserRow | null,
  profileIdsForFamily: string[],
  role: string,
  now: Date,
): HistoricalStatementPlan {
  const statements: D1Statement[] = [];
  const routineRootIds: string[] = [];
  if (successor) {
    statements.push(
      ...ownerStatements(session, familyId, userId, successor.id),
    );
  }
  // ImportedRecord has no FK to personal rows; capture this exact ownership
  // before the canonical personal chore cascade below removes its targets.
  statements.push(...personalImportStatements(session, familyId, userId));
  statements.push(...referenceStatements(session, familyId, userId));
  statements.push(
    ...routineStatements(
      session,
      { ...pre, routines: pre.historicalRoutines },
      familyId,
      userId,
      profileIdsForFamily,
      "erase",
    ),
  );
  statements.push(
    ...rotationStatements(session, pre.historicalRoutines, familyId, userId),
  );
  if (successor) {
    const handover = routineControlHandoverStatements(
        session,
        pre.historicalRoutines,
        pre.stacks,
        familyId,
        userId,
        successor.id,
        profileIdsForFamily,
        "erase",
        now,
      );
    statements.push(...handover.statements);
    routineRootIds.push(...handover.replacements.values());
  }
  // Personal assignments/occurrences are deleted by the canonical account
  // cascade. Do this explicitly for former families after routine control
  // handover has captured the surviving future series.
  statements.push(
    session
      .prepare(
        'DELETE FROM "ChoreAssignment" WHERE family_id=?1 AND (assigned_to=?2 OR chore_id IN (SELECT id FROM "Chore" WHERE family_id=?1 AND assigned_to=?2))',
      )
      .bind(familyId, userId),
  );
  statements.push(
    session
      .prepare('DELETE FROM "Chore" WHERE family_id=?1 AND assigned_to=?2')
      .bind(familyId, userId),
  );
  if (profileIdsForFamily.length) {
    const marks = profileIdsForFamily
      .map((_, index) => `?${index + 2}`)
      .join(",");
    statements.push(
      session
        .prepare(
          `UPDATE "Activity" SET subject_member_id=NULL,subject_member_erased=1 WHERE family_id=?1 AND subject_member_id IN (${marks})`,
        )
        .bind(familyId, ...profileIdsForFamily),
    );
    statements.push(
      session
        .prepare(
          `UPDATE "DeviceAuditEvent" SET subject_member_id=NULL,subject_member_erased=1 WHERE family_id=?1 AND subject_member_id IN (${marks})`,
        )
        .bind(familyId, ...profileIdsForFamily),
    );
    statements.push(
      session
        .prepare(
          `UPDATE "ChoreAssignment" SET assigned_member_id=NULL,member_subject_erased=1 WHERE family_id=?1 AND assigned_member_id IN (${marks})`,
        )
        .bind(familyId, ...profileIdsForFamily),
    );
    statements.push(
      session
        .prepare(
          `UPDATE "Chore" SET assigned_member_id=NULL,member_subject_erased=1 WHERE family_id=?1 AND assigned_member_id IN (${marks})`,
        )
        .bind(familyId, ...profileIdsForFamily),
    );
    statements.push(
      session
        .prepare(
          `UPDATE "ResponsibilityState" SET backup_member_id=NULL,primary_subject_member_id=NULL WHERE family_id=?1 AND (backup_member_id IN (${marks}) OR primary_subject_member_id IN (${marks}))`,
        )
        .bind(familyId, ...profileIdsForFamily),
    );
    statements.push(
      session
        .prepare(
          `DELETE FROM "HouseholdProfileLinkChallenge" WHERE family_id=?1 AND member_id IN (${marks})`,
        )
        .bind(familyId, ...profileIdsForFamily),
    );
    statements.push(
      session
        .prepare(
          `DELETE FROM "HouseholdMemberAccountLink" WHERE family_id=?1 AND member_id IN (${marks}) AND user_id=?${profileIdsForFamily.length + 2}`,
        )
        .bind(familyId, ...profileIdsForFamily, userId),
    );
    statements.push(
      session
        .prepare(
          `DELETE FROM "HouseholdMemberLegacyMapping" WHERE family_id=?1 AND member_id IN (${marks}) AND user_id=?${profileIdsForFamily.length + 2}`,
        )
        .bind(familyId, ...profileIdsForFamily, userId),
    );
    statements.push(
      session
        .prepare(
          `DELETE FROM "HouseholdMember" WHERE family_id=?1 AND id IN (${marks})`,
        )
        .bind(familyId, ...profileIdsForFamily),
    );
  }
  // read_by is a JSON array in D1. Strip only this account while retaining
  // every other reader and keeping malformed legacy values unchanged.
  statements.push(
    session
      .prepare(
        `UPDATE "Message" SET read_by=(SELECT COALESCE(json_group_array(value),'[]') FROM json_each("Message".read_by) WHERE value IS NOT ?2) WHERE family_id=?1 AND json_valid(read_by) AND json_type(read_by)='array' AND EXISTS (SELECT 1 FROM json_each("Message".read_by) WHERE value=?2)`,
      )
      .bind(familyId, userId),
  );
  statements.push(
    session
      .prepare(
        `UPDATE "AuditLog" SET summary=?1,target_id=NULL WHERE family_id=?2 AND target_type='member' AND target_id=?3 AND action='member.joined'`,
      )
      .bind(auditSummary.memberJoined(null, role), familyId, userId),
  );
  statements.push(
    session
      .prepare(
        `UPDATE "AuditLog" SET summary=?1,target_id=NULL WHERE family_id=?2 AND target_type='member' AND target_id=?3 AND action='member.removed'`,
      )
      .bind(auditSummary.memberRemoved(null, role), familyId, userId),
  );
  statements.push(
    session
      .prepare(
        `UPDATE "AuditLog" SET summary=?1,target_id=NULL WHERE family_id=?2 AND target_type='member' AND target_id=?3 AND action='member.left'`,
      )
      .bind(auditSummary.memberLeft(role), familyId, userId),
  );
  statements.push(
    session
      .prepare(
        `UPDATE "AuditLog" SET summary=?1,target_id=NULL WHERE family_id=?2 AND target_type='member' AND target_id=?3 AND action NOT IN ('member.joined','member.removed','member.left')`,
      )
      .bind(auditSummary.memberRedacted(), familyId, userId),
  );
  statements.push(
    session
      .prepare(
        'UPDATE "AuditLog" SET actor_user_id=NULL WHERE family_id=?1 AND actor_user_id=?2',
      )
      .bind(familyId, userId),
  );
  statements.push(
    session
      .prepare('DELETE FROM "Message" WHERE family_id=?1 AND sender_id=?2')
      .bind(familyId, userId),
  );
  statements.push(
    session
      .prepare(
        'UPDATE "DevicePairing" SET confirmed_by=NULL WHERE family_id=?1 AND confirmed_by=?2',
      )
      .bind(familyId, userId),
  );
  statements.push(
    session
      .prepare(
        'DELETE FROM "DevicePairing" WHERE family_id=?1 AND created_by=?2',
      )
      .bind(familyId, userId),
  );
  statements.push(
    session
      .prepare(
        'DELETE FROM "FamilyInvite" WHERE family_id=?1 AND created_by=?2',
      )
      .bind(familyId, userId),
  );
  statements.push(
    session
      .prepare(
        'UPDATE "HouseholdDevice" SET created_by=NULL,confirmed_by=NULL,revoked_by=NULL,elevation_token_hash=CASE WHEN elevated_user_id=?2 THEN NULL ELSE elevation_token_hash END,elevated_user_id=CASE WHEN elevated_user_id=?2 THEN NULL ELSE elevated_user_id END,elevated_token_version=CASE WHEN elevated_user_id=?2 THEN NULL ELSE elevated_token_version END,elevation_method=CASE WHEN elevated_user_id=?2 THEN NULL ELSE elevation_method END,elevation_started_at=CASE WHEN elevated_user_id=?2 THEN NULL ELSE elevation_started_at END,elevation_last_used_at=CASE WHEN elevated_user_id=?2 THEN NULL ELSE elevation_last_used_at END,elevation_expires_at=CASE WHEN elevated_user_id=?2 THEN NULL ELSE elevation_expires_at END WHERE family_id=?1 AND (created_by=?2 OR confirmed_by=?2 OR revoked_by=?2 OR elevated_user_id=?2)',
      )
      .bind(familyId, userId),
  );
  return { statements, routineRootIds };
}

function responsibilityStatements(
  session: Pick<D1Store, "prepare">,
  familyId: string,
  leaving: string,
  memberIds: string[],
  successor: string | null,
): D1Statement[] {
  const statements = [
    "coordinator_id",
    "backup_account_id",
    "primary_subject_account_id",
    "primary_by_id",
    "backup_by_id",
  ].map((column) =>
    session
      .prepare(
        `UPDATE "ResponsibilityState" SET "${column}"=?1 WHERE family_id=?2 AND "${column}"=?3`,
      )
      .bind(successor, familyId, leaving),
  );
  if (memberIds.length) {
    const marks = memberIds.map(() => "?").join(",");
    statements.push(
      session
        .prepare(
          `UPDATE "ResponsibilityState" SET backup_member_id=NULL WHERE family_id=?1 AND backup_member_id IN (${marks})`,
        )
        .bind(familyId, ...memberIds),
    );
    statements.push(
      session
        .prepare(
          `UPDATE "ResponsibilityState" SET primary_subject_member_id=NULL WHERE family_id=?1 AND primary_subject_member_id IN (${marks})`,
        )
        .bind(familyId, ...memberIds),
    );
  }
  return statements;
}

/** ImportedRecord has no foreign key to the personal row it describes. Keep
 * the canonical model/id ownership predicates in SQL so historical imported
 * provenance is erased before the User cascade removes those rows. */
function personalImportStatements(
  session: Pick<D1Store, "prepare">,
  familyId: string,
  userId: string,
): D1Statement[] {
  return [
    session
      .prepare(
        `DELETE FROM "ImportedRecord" WHERE family_id=?1 AND (
    (target_model='Chore' AND target_id IN (SELECT id FROM "Chore" WHERE family_id=?1 AND assigned_to=?2))
    OR (target_model='ChoreAssignment' AND target_id IN (SELECT id FROM "ChoreAssignment" WHERE family_id=?1 AND (assigned_to=?2 OR chore_id IN (SELECT id FROM "Chore" WHERE family_id=?1 AND assigned_to=?2))))
    OR (target_model='HabitLog' AND target_id IN (SELECT id FROM "HabitLog" WHERE family_id=?1 AND user_id=?2))
    OR (target_model='EarnedBadge' AND target_id IN (SELECT id FROM "EarnedBadge" WHERE family_id=?1 AND user_id=?2))
    OR (target_model='RewardRedemption' AND target_id IN (SELECT id FROM "RewardRedemption" WHERE family_id=?1 AND requested_by=?2))
    OR (target_model='WishlistItem' AND target_id IN (SELECT id FROM "WishlistItem" WHERE family_id=?1 AND requested_by=?2))
  )`,
      )
      .bind(familyId, userId),
  ];
}

async function revokeGrants(
  grants: NativeCalendarGrant[],
  deps: NativeDeletionDeps,
): Promise<void> {
  const revoke =
    deps.revokeCalendarGrant ??
    ((grant: NativeCalendarGrant, familyId: string) =>
      revokeProviderGrant(grant as any, familyId));
  for (const grant of grants) {
    try {
      await revoke(grant, grant.family_id);
    } catch {
      /* provider cleanup is best effort after commit */
    }
  }
}

async function removeObjects(
  rows: Array<{ family_id: string; filename: string; id: string }>,
  namespace: "chores" | "messages",
  deps: NativeDeletionDeps,
) {
  const remove =
    deps.removeObject ??
    (async () => {
      // R2 is an HTTP/runtime adapter, so native callers must inject it. This
      // keeps the D1 kernel importable by a bare Worker fixture and fails
      // closed if a production route forgets to provide cleanup.
      throw new Error("Native deletion requires private object cleanup");
    });
  const keys = new Set<string>();
  let filesNotRemoved = 0;
  for (const row of rows) {
    try {
      keys.add(
        privateObjectGenerationKey(
          row.family_id,
          namespace,
          row.filename,
          row.id,
        ),
      );
      keys.add(privateObjectKey(row.family_id, namespace, row.filename));
    } catch {
      filesNotRemoved += 1;
    }
  }
  let filesRemoved = 0;
  for (const key of keys) {
    try {
      await remove(key);
      filesRemoved += 1;
    } catch {
      filesNotRemoved += 1;
    }
  }
  return { filesRemoved, filesNotRemoved };
}

/** Remove legacy chore-photo keys only after the household batch commits. A
 * legacy photo has no Upload row/generation id; the immutable generation form
 * is therefore not guessed, while the old family-scoped key is still removed
 * with the same injected cleanup callback used by ordinary uploads. */
async function removeLegacyPhotoObjects(
  familyId: string,
  names: string[],
  deps: NativeDeletionDeps,
) {
  const remove =
    deps.removeObject ??
    (async () => {
      throw new Error("Native deletion requires private object cleanup");
    });
  const keys = new Set<string>();
  let filesNotRemoved = 0;
  for (const name of names) {
    try {
      keys.add(privateObjectKey(familyId, "chores", name));
    } catch {
      filesNotRemoved += 1;
    }
  }
  let filesRemoved = 0;
  for (const key of keys) {
    try {
      await remove(key);
      filesRemoved += 1;
    } catch {
      filesNotRemoved += 1;
    }
  }
  return { filesRemoved, filesNotRemoved };
}

/** Top up replacement routine roots with the canonical native planner after
 * the deletion batch commits. The planner is idempotent and performs its own
 * witnessed D1 batch; a foreground visit can recover if an edge retry is
 * interrupted after the account effect has already committed. */
async function expandRoutineRootsAfterCommit(
  database: D1Store,
  roots: Array<{ familyId: string; rootId: string }>,
  now: Date,
): Promise<void> {
  if (!roots.length) return;
  const { expandD1RecurringSeries } = await import("./recurring-chores");
  for (const root of roots) {
    try {
      await expandD1RecurringSeries(root.rootId, root.familyId, now, database);
    } catch {
      // Expansion is additive and retried by the next foreground top-up. The
      // committed deletion must not be reported as failed because that later
      // recovery visit is temporarily unavailable.
    }
  }
}

export async function readD1DeletionOptions(
  userId: string,
  database: D1Store,
): Promise<DeletionOptions | null> {
  const pre = (await readPreflight(database, userId)).value;
  if (!pre.actor) return null;
  if (!pre.actor.family_id || !pre.family)
    return {
      role: pre.actor.role,
      household: null,
      isOnlyParent: false,
      canDeleteAccount: true,
      canDeleteHousehold: false,
    };
  const others = pre.members.filter((member) => member.id !== userId);
  const otherParents = others.filter(
    (member) => member.role === "parent",
  ).length;
  return {
    role: pre.actor.role,
    household: {
      id: pre.family.id,
      name: pre.family.name,
      memberCount: pre.members.length,
      parentCount: pre.members.filter((member) => member.role === "parent")
        .length,
    },
    isOnlyParent: pre.actor.role === "parent" && otherParents === 0,
    canDeleteAccount:
      pre.actor.role === "parent" ? otherParents > 0 : others.length > 0,
    canDeleteHousehold: pre.actor.role === "parent" && otherParents === 0,
  };
}

/** Delete one account while retaining household content for the selected
 * successor. The read witness covers membership, identity links, calendar
 * grants, routine roots, and private-object ownership used by the effect. */
export async function deleteD1MemberAccount(
  userId: string,
  deps: NativeDeletionDeps,
): Promise<{
  mode: "account";
  deleted: boolean;
  successorId: string | null;
  filesRemoved: number;
  filesNotRemoved: number;
}> {
  const db = databaseOf(deps);
  const now = nowOf(deps);
  const session = db.withSession("first-primary");
  for (let attempt = 0; attempt < 8; attempt++) {
    const capture = await readPreflight(
      db,
      userId,
      undefined,
      "account.delete",
      deps.idempotencyKey,
    );
    const pre = capture.value;
    if (!pre.actor) {
      if (attempt > 0)
        throw new NativeAccountDeletionError(
          "IDENTITY_CONFLICT",
          409,
          "The account was changed by another deletion request.",
        );
      return {
        mode: "account",
        deleted: false,
        successorId: null,
        filesRemoved: 0,
        filesNotRemoved: 0,
      };
    }
    const actor = pre.actor;
    const familyId = actor.family_id;
    if (
      pre.idempotency &&
      (pre.idempotency.family_id !== familyId ||
        pre.idempotency.user_id !== userId ||
        pre.idempotency.action !== "account.delete" ||
        pre.idempotency.request_hash !==
          hashIdempotentRequest("account.delete", { mode: "account" }))
    ) {
      throw new NativeAccountDeletionError(
        "IDENTITY_CONFLICT",
        409,
        "That idempotency key was already used for another deletion request.",
      );
    }
    if (pre.idempotency)
      throw new NativeAccountDeletionError(
        "IDENTITY_CONFLICT",
        409,
        "A deletion request with that idempotency key is already in progress.",
      );
    const successor = familyId ? assertAccountCanLeave(pre, actor) : null;
    if (!familyId && (pre.links.length > 0 || pre.legacy.length > 0))
      throw new NativeAccountDeletionError(
        "IDENTITY_CONFLICT",
        409,
        "Household member identity needs review before this change.",
      );
    const ids = familyId
      ? [
          ...new Set([
            ...assertOneProfile(pre, userId, familyId),
            ...pre.historicalProfiles
              .filter((profile) => profile.family_id === familyId)
              .map((profile) => profile.id),
          ]),
        ].sort()
      : [];
    const grants = pre.grants.filter(
      (grant) => !familyId || grant.user_id === userId,
    );
    const sentIds = new Set(
      pre.messages
        .filter((message) => message.sender_id === userId)
        .map((message) => message.id),
    );
    const historicalSentIds = new Set(
      pre.historicalMessages
        .filter((message) => message.sender_id === userId)
        .map((message) => message.id),
    );
    const attachments = [
      ...pre.attachments.filter((attachment) =>
        sentIds.has(attachment.message_id ?? ""),
      ),
      ...pre.historicalAttachments.filter((attachment) =>
        historicalSentIds.has(attachment.message_id ?? ""),
      ),
    ].filter(
      (attachment, index, all) =>
        all.findIndex((candidate) => candidate.id === attachment.id) === index,
    );
    const routineExpansionRoots: Array<{ familyId: string; rootId: string }> =
      [];
    const statements: D1Statement[] = [
      d1WriteCheck(
        session,
        'EXISTS (SELECT 1 FROM "User" WHERE id=?1 AND token_version=?2)',
        [userId, actor.token_version],
      ),
    ];
    if (familyId && successor) {
      if (deps.idempotencyKey)
        statements.push(
          session
            .prepare(
              'INSERT INTO "IdempotencyRecord"(id,scope,key,family_id,user_id,action,request_hash,response_status,response_body,created_at,expires_at) VALUES (?1,?2,?3,?4,?5,?6,?7,NULL,NULL,?8,?9)',
            )
            .bind(
              randomId(),
              `user:${userId}`,
              deps.idempotencyKey,
              familyId,
              userId,
              "account.delete",
              hashIdempotentRequest("account.delete", { mode: "account" }),
              now.getTime(),
              now.getTime() + IDEMPOTENCY_TTL_MS,
            ),
        );
      statements.push(
        d1WriteCheck(
          session,
          `EXISTS (SELECT 1 FROM "User" WHERE id=?1 AND family_id=?2 AND role=?3 AND token_version=?4)`,
          [successor.id, familyId, successor.role, successor.token_version],
        ),
      );
      statements.push(
        ...ownerStatements(session, familyId, userId, successor.id),
      );
      statements.push(...referenceStatements(session, familyId, userId));
      statements.push(
        ...routineStatements(session, pre, familyId, userId, ids, "erase"),
      );
      statements.push(
        ...rotationStatements(session, pre.routines, familyId, userId),
      );
      const routineHandover = routineControlHandoverStatements(
        session,
        pre.routines,
        pre.stacks,
        familyId,
        userId,
        successor.id,
        ids,
        "erase",
        now,
      );
      statements.push(...routineHandover.statements);
      routineExpansionRoots.push(
        ...[...routineHandover.replacements.values()].map((rootId) => ({
          familyId,
          rootId,
        })),
      );
      statements.push(...personalImportStatements(session, familyId, userId));
      if (ids.length) {
        const marks = ids.map(() => "?").join(",");
        // Preserve historic audit rows but remove identifying profile links.
        statements.push(
          session
            .prepare(
              `UPDATE "Activity" SET subject_member_id=NULL,subject_member_erased=1 WHERE family_id=?1 AND subject_member_id IN (${marks})`,
            )
            .bind(familyId, ...ids),
        );
        statements.push(
          session
            .prepare(
              `UPDATE "DeviceAuditEvent" SET subject_member_id=NULL,subject_member_erased=1 WHERE family_id=?1 AND subject_member_id IN (${marks})`,
            )
            .bind(familyId, ...ids),
        );
        statements.push(
          session
            .prepare(
              `UPDATE "ChoreAssignment" SET assigned_member_id=NULL,member_subject_erased=1 WHERE family_id=?1 AND assigned_member_id IN (${marks})`,
            )
            .bind(familyId, ...ids),
        );
        statements.push(
          session
            .prepare(
              `UPDATE "Chore" SET assigned_member_id=NULL,member_subject_erased=1 WHERE family_id=?1 AND assigned_member_id IN (${marks})`,
            )
            .bind(familyId, ...ids),
        );
        statements.push(
          session
            .prepare(
              `DELETE FROM "HouseholdMemberAccountLink" WHERE family_id=?1 AND member_id IN (${marks})`,
            )
            .bind(familyId, ...ids),
        );
        statements.push(
          session
            .prepare(
              `DELETE FROM "HouseholdMemberLegacyMapping" WHERE family_id=?1 AND member_id IN (${marks})`,
            )
            .bind(familyId, ...ids),
        );
        statements.push(
          session
            .prepare(
              `DELETE FROM "HouseholdMember" WHERE family_id=?1 AND id IN (${marks})`,
            )
            .bind(familyId, ...ids),
        );
      }
      // Permanent account deletion removes the member's own chores and
      // occurrences. Ordinary member detachment is the path that reassigns
      // open work; retaining these rows here would leave personal history in
      // the household and diverge from the canonical transaction.
      statements.push(
        session
          .prepare(
            'DELETE FROM "ChoreAssignment" WHERE family_id=?1 AND (assigned_to=?2 OR chore_id IN (SELECT id FROM "Chore" WHERE family_id=?1 AND assigned_to=?2))',
          )
          .bind(familyId, userId),
      );
      statements.push(
        session
          .prepare('DELETE FROM "Chore" WHERE family_id=?1 AND assigned_to=?2')
          .bind(familyId, userId),
      );
      statements.push(
        ...responsibilityStatements(
          session,
          familyId,
          userId,
          ids,
          successor.id,
        ),
      );
      statements.push(
        session
          .prepare(
            'DELETE FROM "CalendarEventLink" WHERE family_id=?1 AND connection_id IN (SELECT id FROM "CalendarConnection" WHERE user_id=?2)',
          )
          .bind(familyId, userId),
      );
      statements.push(
        session
          .prepare(
            'DELETE FROM "CalendarConnection" WHERE family_id=?1 AND user_id=?2',
          )
          .bind(familyId, userId),
      );
      statements.push(
        session
          .prepare(
            'DELETE FROM "CalendarOAuthState" WHERE family_id=?1 AND user_id=?2',
          )
          .bind(familyId, userId),
      );
      statements.push(
        session
          .prepare(
            'DELETE FROM "AppFeedback" WHERE family_id=?1 AND user_id=?2',
          )
          .bind(familyId, userId),
      );
      statements.push(
        session
          .prepare(
            'UPDATE "NotificationRecipientDecision" SET user_id=NULL WHERE family_id=?1 AND user_id=?2',
          )
          .bind(familyId, userId),
      );
      statements.push(
        session
          .prepare('DELETE FROM "Notification" WHERE user_id=?1')
          .bind(userId),
      );
      statements.push(
        session
          .prepare(
            'DELETE FROM "PushSubscription" WHERE family_id=?1 AND user_id=?2',
          )
          .bind(familyId, userId),
      );
      statements.push(
        session
          .prepare('DELETE FROM "Activity" WHERE family_id=?1 AND user_id=?2')
          .bind(familyId, userId),
      );
      statements.push(
        session
          .prepare('DELETE FROM "Message" WHERE family_id=?1 AND sender_id=?2')
          .bind(familyId, userId),
      );
      statements.push(
        session
          .prepare('DELETE FROM "HabitLog" WHERE family_id=?1 AND user_id=?2')
          .bind(familyId, userId),
      );
      statements.push(
        session
          .prepare(
            'DELETE FROM "EarnedBadge" WHERE family_id=?1 AND user_id=?2',
          )
          .bind(familyId, userId),
      );
      statements.push(
        session
          .prepare(
            'DELETE FROM "HouseholdProfileLinkChallenge" WHERE family_id=?1 AND (issued_by=?2 OR claimed_by=?2)',
          )
          .bind(familyId, userId),
      );
      statements.push(
        session
          .prepare(
            'DELETE FROM "ParentElevationPin" WHERE family_id=?1 AND user_id=?2',
          )
          .bind(familyId, userId),
      );
      statements.push(
        session
          .prepare(
            'DELETE FROM "IdempotencyRecord" WHERE family_id=?1 AND user_id=?2',
          )
          .bind(familyId, userId),
      );
      statements.push(
        session
          .prepare(
            'DELETE FROM "FamilyInvite" WHERE family_id=?1 AND created_by=?2 AND accepted_at IS NULL',
          )
          .bind(familyId, userId),
      );
      statements.push(
        session
          .prepare(
            'UPDATE "FamilyInvite" SET created_by=?1 WHERE family_id=?2 AND created_by=?3',
          )
          .bind(successor.id, familyId, userId),
      );
      statements.push(
        session
          .prepare(
            'DELETE FROM "DevicePairing" WHERE family_id=?1 AND created_by=?2 AND device_id IS NULL',
          )
          .bind(familyId, userId),
      );
      statements.push(
        session
          .prepare(
            'UPDATE "DevicePairing" SET created_by=?1 WHERE family_id=?2 AND created_by=?3',
          )
          .bind(successor.id, familyId, userId),
      );
      statements.push(
        session
          .prepare(
            'UPDATE "DevicePairing" SET confirmed_by=NULL WHERE family_id=?1 AND confirmed_by=?2',
          )
          .bind(familyId, userId),
      );
      statements.push(
        session
          .prepare(
            'UPDATE "HouseholdDevice" SET created_by=NULL,confirmed_by=NULL,revoked_by=NULL,elevation_token_hash=CASE WHEN elevated_user_id=?2 THEN NULL ELSE elevation_token_hash END,elevated_user_id=CASE WHEN elevated_user_id=?2 THEN NULL ELSE elevated_user_id END,elevated_token_version=CASE WHEN elevated_user_id=?2 THEN NULL ELSE elevated_token_version END,elevation_method=CASE WHEN elevated_user_id=?2 THEN NULL ELSE elevation_method END,elevation_started_at=CASE WHEN elevated_user_id=?2 THEN NULL ELSE elevation_started_at END,elevation_last_used_at=CASE WHEN elevated_user_id=?2 THEN NULL ELSE elevation_last_used_at END,elevation_expires_at=CASE WHEN elevated_user_id=?2 THEN NULL ELSE elevation_expires_at END WHERE family_id=?1 AND (created_by=?2 OR confirmed_by=?2 OR revoked_by=?2 OR elevated_user_id=?2)',
          )
          .bind(familyId, userId),
      );
      statements.push(
        session
          .prepare(
            "UPDATE \"AuditLog\" SET summary=?1,target_id=NULL WHERE family_id=?2 AND action='member.joined' AND target_type='member' AND target_id=?3",
          )
          .bind(auditSummary.memberJoined(null, actor.role), familyId, userId),
      );
      statements.push(
        session
          .prepare(
            "UPDATE \"AuditLog\" SET summary=?1,target_id=NULL WHERE family_id=?2 AND action='member.removed' AND target_type='member' AND target_id=?3",
          )
          .bind(auditSummary.memberRemoved(null, actor.role), familyId, userId),
      );
      statements.push(
        session
          .prepare(
            "UPDATE \"AuditLog\" SET summary=?1,target_id=NULL WHERE family_id=?2 AND action='member.left' AND target_type='member' AND target_id=?3",
          )
          .bind(auditSummary.memberLeft(actor.role), familyId, userId),
      );
      statements.push(
        session
          .prepare(
            "UPDATE \"AuditLog\" SET summary=?1,target_id=NULL WHERE family_id=?2 AND target_type='member' AND target_id=?3 AND action NOT IN ('member.joined','member.removed','member.left')",
          )
          .bind(auditSummary.memberRedacted(), familyId, userId),
      );
      statements.push(
        session
          .prepare(
            'UPDATE "AuditLog" SET actor_user_id=NULL WHERE family_id=?1 AND actor_user_id=?2',
          )
          .bind(familyId, userId),
      );
      statements.push(
        session
          .prepare(
            `UPDATE "Message" SET read_by=(SELECT COALESCE(json_group_array(value),'[]') FROM json_each("Message".read_by) WHERE value IS NOT ?2) WHERE family_id=?1 AND json_valid(read_by) AND json_type(read_by)='array' AND EXISTS (SELECT 1 FROM json_each("Message".read_by) WHERE value=?2)`,
          )
          .bind(familyId, userId),
      );
      for (const historicalFamilyId of historicalFamilyIds(
        pre,
        userId,
        familyId,
      )) {
        const historicalMembers = pre.historicalMembers.filter(
          (member) =>
            member.family_id === historicalFamilyId && member.id !== userId,
        );
        const historicalSuccessor =
          historicalMembers.find((member) => member.role === "parent") ??
          historicalMembers[0] ??
          null;
        const historicalRows = pre.historicalRoutines.filter(
          (row) => row.family_id === historicalFamilyId,
        );
        const needsSuccessor =
          pre.historicalOwnerFamilies.includes(historicalFamilyId) ||
          historicalRows.some(
            (row) =>
              row.assigned_to === userId ||
              routineSubjectUser(row.routine_series_config) === userId,
          );
        if (needsSuccessor && !historicalSuccessor)
          throw new NativeAccountDeletionError(
            "HISTORICAL_SUCCESSOR_REQUIRED",
            409,
            "A former household needs a remaining member before your shared content can be preserved.",
          );
        const historicalPlan = historicalStatements(
            session,
            pre,
            historicalFamilyId,
            userId,
            historicalSuccessor,
            pre.historicalProfiles
              .filter((profile) => profile.family_id === historicalFamilyId)
              .map((profile) => profile.id),
            actor.role,
            now,
          );
        statements.push(...historicalPlan.statements);
        routineExpansionRoots.push(
          ...historicalPlan.routineRootIds.map((rootId) => ({
            familyId: historicalFamilyId,
            rootId,
          })),
        );
      }
      statements.push(
        session
          .prepare(
            'UPDATE "User" SET family_id=NULL,token_version=token_version+1,reset_token=NULL,reset_token_expires=NULL,verify_token=NULL,verify_token_expires=NULL WHERE id=?1 AND family_id=?2',
          )
          .bind(userId, familyId),
        d1WriteCheck(session, "changes()=1"),
      );
      statements.push(
        ...prepareD1AuditLog(
          session,
          {
            familyId,
            actorUserId: null,
            actorKind: "person",
            action: "member.left",
            targetType: "member",
            targetId: null,
            summary: auditSummary.memberLeft(actor.role),
          },
          now,
        ),
      );
      // Account deletion is permanent. Keep the token-generation update above
      // as defence in depth for any concurrent reader, then remove the User
      // row in this same primary-session batch after every NO ACTION reference
      // has been transferred or cleared. Cascading personal rows (allowance
      // recipients, medications, notifications, and similar) are therefore
      // removed by the same database transaction as the account.
      statements.push(
        session
          .prepare('DELETE FROM "User" WHERE id=?1 AND family_id IS NULL')
          .bind(userId),
        d1WriteCheck(session, "changes()=1"),
      );
    } else {
      // Profiles from a former household are still NO ACTION subjects. Erase
      // their identifying links before removing the account, even when the
      // account no longer belongs to a current family.
      for (const historicalFamilyId of historicalFamilyIds(pre, userId, null)) {
        const members = pre.historicalMembers.filter(
          (member) =>
            member.family_id === historicalFamilyId && member.id !== userId,
        );
        const successor =
          members.find((member) => member.role === "parent") ??
          members[0] ??
          null;
        const historicalRows = pre.historicalRoutines.filter(
          (row) => row.family_id === historicalFamilyId,
        );
        const needsSuccessor =
          pre.historicalOwnerFamilies.includes(historicalFamilyId) ||
          historicalRows.some(
            (row) =>
              row.assigned_to === userId ||
              routineSubjectUser(row.routine_series_config) === userId,
          );
        if (needsSuccessor && !successor)
          throw new NativeAccountDeletionError(
            "HISTORICAL_SUCCESSOR_REQUIRED",
            409,
            "A former household needs a remaining member before your shared content can be preserved.",
          );
        const historicalPlan = historicalStatements(
            session,
            pre,
            historicalFamilyId,
            userId,
            successor,
            pre.historicalProfiles
              .filter((profile) => profile.family_id === historicalFamilyId)
              .map((profile) => profile.id),
            actor.role,
            now,
          );
        statements.push(...historicalPlan.statements);
        routineExpansionRoots.push(
          ...historicalPlan.routineRootIds.map((rootId) => ({
            familyId: historicalFamilyId,
            rootId,
          })),
        );
      }
      for (const profile of pre.profiles) {
        statements.push(
          session
            .prepare(
              'UPDATE "Activity" SET subject_member_id=NULL,subject_member_erased=1 WHERE family_id=?1 AND subject_member_id=?2',
            )
            .bind(profile.family_id, profile.id),
        );
        statements.push(
          session
            .prepare(
              'UPDATE "DeviceAuditEvent" SET subject_member_id=NULL,subject_member_erased=1 WHERE family_id=?1 AND subject_member_id=?2',
            )
            .bind(profile.family_id, profile.id),
        );
        statements.push(
          session
            .prepare(
              'UPDATE "ChoreAssignment" SET assigned_member_id=NULL,member_subject_erased=1 WHERE family_id=?1 AND assigned_member_id=?2',
            )
            .bind(profile.family_id, profile.id),
        );
        statements.push(
          session
            .prepare(
              'UPDATE "Chore" SET assigned_member_id=NULL,member_subject_erased=1 WHERE family_id=?1 AND assigned_member_id=?2',
            )
            .bind(profile.family_id, profile.id),
        );
        statements.push(
          session
            .prepare(
              'UPDATE "ResponsibilityState" SET backup_member_id=NULL,primary_subject_member_id=NULL WHERE family_id=?1 AND (backup_member_id=?2 OR primary_subject_member_id=?2)',
            )
            .bind(profile.family_id, profile.id),
        );
        statements.push(
          session
            .prepare(
              'DELETE FROM "HouseholdProfileLinkChallenge" WHERE family_id=?1 AND member_id=?2',
            )
            .bind(profile.family_id, profile.id),
        );
        statements.push(
          session
            .prepare(
              'DELETE FROM "HouseholdMemberAccountLink" WHERE member_id=?1 AND user_id=?2',
            )
            .bind(profile.id, userId),
        );
        statements.push(
          session
            .prepare(
              'DELETE FROM "HouseholdMemberLegacyMapping" WHERE member_id=?1 AND user_id=?2',
            )
            .bind(profile.id, userId),
        );
        statements.push(
          session
            .prepare(
              'DELETE FROM "HouseholdMember" WHERE id=?1 AND family_id=?2',
            )
            .bind(profile.id, profile.family_id),
        );
      }
      statements.push(
        session
          .prepare('DELETE FROM "AppFeedback" WHERE user_id=?1')
          .bind(userId),
      );
      statements.push(
        session
          .prepare(
            'UPDATE "NotificationRecipientDecision" SET user_id=NULL WHERE user_id=?1',
          )
          .bind(userId),
      );
      statements.push(
        session
          .prepare('DELETE FROM "Notification" WHERE user_id=?1')
          .bind(userId),
      );
      statements.push(
        session
          .prepare('DELETE FROM "PushSubscription" WHERE user_id=?1')
          .bind(userId),
      );
      statements.push(
        session.prepare('DELETE FROM "Activity" WHERE user_id=?1').bind(userId),
      );
      statements.push(
        session
          .prepare('DELETE FROM "Message" WHERE sender_id=?1')
          .bind(userId),
      );
      statements.push(
        session.prepare('DELETE FROM "HabitLog" WHERE user_id=?1').bind(userId),
      );
      statements.push(
        session
          .prepare('DELETE FROM "EarnedBadge" WHERE user_id=?1')
          .bind(userId),
      );
      statements.push(
        session
          .prepare('DELETE FROM "CalendarOAuthState" WHERE user_id=?1')
          .bind(userId),
      );
      statements.push(
        session
          .prepare('DELETE FROM "CalendarConnection" WHERE user_id=?1')
          .bind(userId),
      );
      statements.push(
        session
          .prepare('DELETE FROM "ParentElevationPin" WHERE user_id=?1')
          .bind(userId),
      );
      statements.push(
        session
          .prepare('DELETE FROM "IdempotencyRecord" WHERE user_id=?1')
          .bind(userId),
      );
      statements.push(
        session
          .prepare('DELETE FROM "HouseholdMember" WHERE erasure_user_id=?1')
          .bind(userId),
      );
      statements.push(
        session.prepare('DELETE FROM "User" WHERE id=?1').bind(userId),
        d1WriteCheck(session, "changes()=1"),
      );
    }
    try {
      await session.batch([...capture.checks(session), ...statements]);
      await expandRoutineRootsAfterCommit(db, routineExpansionRoots, now);
      await revokeGrants(grants, deps);
      const cleanup = await removeObjects(attachments, "messages", deps);
      return {
        mode: "account",
        deleted: true,
        successorId: successor?.id ?? null,
        ...cleanup,
      };
    } catch (error) {
      if (isD1WriteConflict(error)) continue;
      if (isIdempotencyConflict(error))
        throw new NativeAccountDeletionError(
          "IDENTITY_CONFLICT",
          409,
          "A deletion request with that idempotency key is already in progress.",
        );
      throw error;
    }
  }
  throw new NativeAccountDeletionError(
    "IDENTITY_CONFLICT",
    409,
    "The account changed while deletion was in progress. Please retry.",
  );
}

// Child rows and NO ACTION foreign keys are explicit here rather than relying
// on SQLite cascade behaviour. Keep this list in the same order as the
// PostgreSQL HOUSEHOLD_DELETION_PLAN.
const HOUSEHOLD_DELETE_ORDER = [
  "MessageAttachmentCleanupLease",
  "UploadCleanupLease",
  "NotificationRecipientDecision",
  "NotificationEventOccurrence",
  "EventPreparationStep",
  "EventPreparation",
  "CalendarEventLink",
  "Event",
  "ChoreAssignment",
  "ResponsibilityState",
  "Chore",
  "RoutineStack",
  "ImportedRecord",
  "ImportJob",
  "RecipeCollectionEntry",
  "RecipeCollection",
  "RecipeIngredient",
  "Recipe",
  "Ingredient",
  "MealPlanEntry",
  "MealPlan",
  "ShoppingItem",
  "ShoppingList",
  "InventoryAdjustment",
  "InventoryItem",
  "FoodProduct",
  "GroceryShoppingSession",
  "GrocerySectionPreference",
  "Transaction",
  "FinancialArchiveRecord",
  "ListItem",
  "List",
  "BudgetCategory",
  "ProjectTask",
  "Project",
  "Activity",
  "HabitLog",
  "Habit",
  "EarnedBadge",
  "RewardRedemption",
  "Reward",
  "BadgeDefinition",
  "FamilyGoal",
  "MealBatchConsumption",
  "MealBatch",
  "MealPrepSession",
  "FamilyMeal",
  "MessageAttachment",
  "Message",
  "PinnedNote",
  "Anniversary",
  "FamilyLocation",
  "EmergencyContact",
  "Pickup",
  "Allowance",
  "WishlistItem",
  "Medication",
  "SickDay",
  "Upload",
  "WeatherCache",
  "AppFeedback",
  "AiUsageRequest",
  "AiUsagePolicy",
  "ChoreTopUpCursor",
  "Handoff",
  "CalendarConnection",
  "CalendarSubscription",
  "CalendarOAuthState",
  "FamilyInvite",
  "HouseholdProfileLinkChallenge",
  "HouseholdMemberAccountLink",
  "HouseholdMemberLegacyMapping",
  "DeviceSession",
  "DevicePairing",
  "DeviceAuditEvent",
  "ParentElevationPin",
  "AuditLog",
  "HouseholdDevice",
  "HouseholdMember",
  "PushSubscription",
  "IdempotencyRecord",
  "BetaMetricDaily",
] as const;

export async function deleteD1Household(
  familyId: string,
  actorId: string,
  deps: NativeDeletionDeps,
): Promise<{
  mode: "household";
  deleted: boolean;
  membersRemoved: number;
  filesRemoved: number;
  filesNotRemoved: number;
}> {
  const db = databaseOf(deps);
  const now = nowOf(deps);
  const session = db.withSession("first-primary");
  for (let attempt = 0; attempt < 8; attempt++) {
    const capture = await readPreflight(
      db,
      actorId,
      familyId,
      "household.delete",
      deps.idempotencyKey,
    );
    const pre = capture.value;
    const actor = pre.actor;
    if (!actor && attempt > 0)
      throw new NativeAccountDeletionError(
        "IDENTITY_CONFLICT",
        409,
        "The household was changed by another deletion request.",
      );
    if (!actor || actor.family_id !== familyId)
      throw new NativeAccountDeletionError(
        "FAMILY_REQUIRED",
        400,
        "You must belong to this household.",
      );
    if (actor.role !== "parent")
      throw new NativeAccountDeletionError(
        "PARENT_REQUIRED",
        403,
        "Only a parent can delete the household.",
      );
    if (
      pre.members.some(
        (member) => member.id !== actorId && member.role === "parent",
      )
    )
      throw new NativeAccountDeletionError(
        "OTHER_PARENTS_EXIST",
        409,
        "Remove the other parent before deleting this household.",
      );
    if (!pre.family)
      throw new NativeAccountDeletionError(
        "FAMILY_REQUIRED",
        404,
        "Family not found.",
      );
    if (
      pre.idempotency &&
      (pre.idempotency.family_id !== familyId ||
        pre.idempotency.user_id !== actorId ||
        pre.idempotency.action !== "household.delete" ||
        pre.idempotency.request_hash !==
          hashIdempotentRequest("household.delete", {
            mode: "household",
            familyId,
          }))
    ) {
      throw new NativeAccountDeletionError(
        "IDENTITY_CONFLICT",
        409,
        "That idempotency key was already used for another deletion request.",
      );
    }
    if (pre.idempotency)
      throw new NativeAccountDeletionError(
        "IDENTITY_CONFLICT",
        409,
        "A deletion request with that idempotency key is already in progress.",
      );

    const statements: D1Statement[] = [
      d1WriteCheck(
        session,
        `EXISTS (SELECT 1 FROM "User" WHERE id=?1 AND family_id=?2 AND role='parent' AND token_version=?3)`,
        [actorId, familyId, actor.token_version],
      ),
    ];
    if (deps.idempotencyKey)
      statements.push(
        session
          .prepare(
            'INSERT INTO "IdempotencyRecord"(id,scope,key,family_id,user_id,action,request_hash,response_status,response_body,created_at,expires_at) VALUES (?1,?2,?3,?4,?5,?6,?7,NULL,NULL,?8,?9)',
          )
          .bind(
            randomId(),
            `user:${actorId}`,
            deps.idempotencyKey,
            familyId,
            actorId,
            "household.delete",
            hashIdempotentRequest("household.delete", {
              mode: "household",
              familyId,
            }),
            now.getTime(),
            now.getTime() + IDEMPOTENCY_TTL_MS,
          ),
      );
    // Revoke every household credential and feed before deleting its rows. The
    // final deletes are still explicit, but these writes protect a concurrent
    // verifier/session reader if a later compatibility table interrupts the
    // batch and make the invalidation contract auditable.
    statements.push(
      session
        .prepare(
          'UPDATE "User" SET token_version=token_version+1,reset_token=NULL,reset_token_expires=NULL,verify_token=NULL,verify_token_expires=NULL WHERE family_id=?1',
        )
        .bind(familyId),
    );
    statements.push(
      session
        .prepare('UPDATE "Family" SET feed_token=NULL WHERE id=?1')
        .bind(familyId),
    );
    statements.push(
      session
        .prepare(
          'UPDATE "DeviceSession" SET revoked_at=?1 WHERE family_id=?2 AND revoked_at IS NULL',
        )
        .bind(now.getTime(), familyId),
    );
    for (const table of HOUSEHOLD_DELETE_ORDER) {
      if (table === "ListItem") {
        statements.push(
          session
            .prepare(
              'DELETE FROM "ListItem" WHERE list_id IN (SELECT id FROM "List" WHERE family_id=?1)',
            )
            .bind(familyId),
        );
      } else if (table === "ProjectTask") {
        statements.push(
          session
            .prepare(
              'DELETE FROM "ProjectTask" WHERE project_id IN (SELECT id FROM "Project" WHERE family_id=?1)',
            )
            .bind(familyId),
        );
      } else if (table === "RecipeIngredient") {
        statements.push(
          session
            .prepare(
              'DELETE FROM "RecipeIngredient" WHERE recipe_id IN (SELECT id FROM "Recipe" WHERE family_id=?1) OR ingredient_id IN (SELECT id FROM "Ingredient" WHERE family_id=?1)',
            )
            .bind(familyId),
        );
      } else if (table === "MealPlanEntry") {
        statements.push(
          session
            .prepare(
              'DELETE FROM "MealPlanEntry" WHERE meal_plan_id IN (SELECT id FROM "MealPlan" WHERE family_id=?1)',
            )
            .bind(familyId),
        );
      } else if (table === "ShoppingItem") {
        statements.push(
          session
            .prepare(
              'DELETE FROM "ShoppingItem" WHERE shopping_list_id IN (SELECT id FROM "ShoppingList" WHERE family_id=?1)',
            )
            .bind(familyId),
        );
      } else {
        statements.push(
          session
            .prepare(`DELETE FROM "${table}" WHERE family_id=?1`)
            .bind(familyId),
        );
      }
    }
    // Notification has no family_id by design; scope it through the members
    // before the User rows are removed.
    statements.push(
      session
        .prepare(
          'DELETE FROM "Notification" WHERE user_id IN (SELECT id FROM "User" WHERE family_id=?1)',
        )
        .bind(familyId),
    );
    statements.push(
      session.prepare('DELETE FROM "User" WHERE family_id=?1').bind(familyId),
      d1WriteCheck(session, "changes()=?1", [pre.members.length]),
    );
    statements.push(
      session.prepare('DELETE FROM "Family" WHERE id=?1').bind(familyId),
      d1WriteCheck(session, "changes()=1"),
    );
    try {
      await session.batch([...capture.checks(session), ...statements]);
      await revokeGrants(pre.grants, deps);
      const uploadCleanup = await removeObjects(pre.uploads, "chores", deps);
      const attachmentCleanup = await removeObjects(
        pre.attachments,
        "messages",
        deps,
      );
      const sharedLegacy = new Set([
        ...pre.foreignLegacyPhotos,
        ...pre.foreignUploadNames,
      ]);
      const legacyCleanup = await removeLegacyPhotoObjects(
        familyId,
        pre.legacyPhotos.filter((name) => !sharedLegacy.has(name)),
        deps,
      );
      return {
        mode: "household",
        deleted: true,
        membersRemoved: pre.members.length,
        filesRemoved:
          uploadCleanup.filesRemoved +
          attachmentCleanup.filesRemoved +
          legacyCleanup.filesRemoved,
        filesNotRemoved:
          uploadCleanup.filesNotRemoved +
          attachmentCleanup.filesNotRemoved +
          legacyCleanup.filesNotRemoved,
      };
    } catch (error) {
      if (isD1WriteConflict(error)) continue;
      if (isIdempotencyConflict(error))
        throw new NativeAccountDeletionError(
          "IDENTITY_CONFLICT",
          409,
          "A deletion request with that idempotency key is already in progress.",
        );
      throw error;
    }
  }
  throw new NativeAccountDeletionError(
    "IDENTITY_CONFLICT",
    409,
    "The household changed while deletion was in progress. Please retry.",
  );
}

/** Detach a member while retaining their account and the household's stable
 * profile/history. Unlike account deletion, sent messages and shared history
 * remain; the member's session generation is bumped and device access is
 * revoked in the same D1 batch. */
export async function removeD1HouseholdMember(
  args: { actorId: string; familyId: string; targetId: string },
  deps: NativeDeletionDeps,
): Promise<{ removedId: string; tabletsRevoked: number }> {
  const db = databaseOf(deps);
  const now = nowOf(deps);
  const session = db.withSession("first-primary");
  if (args.actorId === args.targetId)
    throw new NativeMemberRemovalError(
      "CANNOT_REMOVE_SELF",
      400,
      "You cannot remove yourself. To leave, delete your account in Settings.",
    );
  for (let attempt = 0; attempt < 8; attempt++) {
    const capture = await readPreflight(db, args.actorId, args.familyId);
    const pre = capture.value;
    const actor = pre.actor;
    const target = pre.members.find((member) => member.id === args.targetId);
    if (!actor || actor.family_id !== args.familyId || actor.role !== "parent")
      throw new NativeMemberRemovalError(
        "NOT_A_PARENT",
        403,
        "Only a parent of this household can remove a member.",
      );
    if (!target)
      throw new NativeMemberRemovalError(
        "MEMBER_NOT_FOUND",
        404,
        "That person is not in your household.",
      );
    if (
      target.role === "parent" &&
      pre.members.filter(
        (member) => member.role === "parent" && member.id !== target.id,
      ).length === 0
    )
      throw new NativeMemberRemovalError(
        "LAST_PARENT",
        409,
        "A household needs at least one parent.",
      );
    const checkedProfileIds = (memberId: string) => {
      try {
        return assertOneProfile(pre, memberId, args.familyId);
      } catch (error) {
        if (
          error instanceof NativeAccountDeletionError &&
          error.code === "IDENTITY_CONFLICT"
        )
          throw new NativeMemberRemovalError(
            "IDENTITY_CONFLICT",
            409,
            error.message,
          );
        throw error;
      }
    };
    const ids = checkedProfileIds(target.id);
    const actorProfileIds = checkedProfileIds(actor.id);
    const tablets = pre.devices.filter(
      (device) =>
        device.revoked_at === null &&
        (device.created_by === target.id || device.confirmed_by === target.id),
    );
    const statements: D1Statement[] = [
      d1WriteCheck(
        session,
        `EXISTS (SELECT 1 FROM "User" WHERE id=?1 AND family_id=?2 AND role='parent' AND token_version=?3)`,
        [args.actorId, args.familyId, actor.token_version],
      ),
      d1WriteCheck(
        session,
        `EXISTS (SELECT 1 FROM "User" WHERE id=?1 AND family_id=?2 AND token_version=?3)`,
        [target.id, args.familyId, target.token_version],
      ),
      ...(tablets.length
        ? [
            session
              .prepare(
                `UPDATE "DeviceSession" SET revoked_at=?1 WHERE device_id IN (${tablets
                  .map(() => "?")
                  .join(",")}) AND revoked_at IS NULL`,
              )
              .bind(now.getTime(), ...tablets.map((tablet) => tablet.id)),
          ]
        : []),
      ...ownerStatements(session, args.familyId, target.id, args.actorId),
      ...referenceStatements(session, args.familyId, target.id),
      ...routineStatements(
        session,
        pre,
        args.familyId,
        target.id,
        ids,
        "invalidate",
      ),
      ...rotationStatements(session, pre.routines, args.familyId, target.id),
      ...routineControlHandoverStatements(
        session,
        pre.routines,
        pre.stacks,
        args.familyId,
        target.id,
        args.actorId,
        ids,
        "invalidate",
        now,
      ).statements,
    ];
    if (ids.length) {
      const marks = ids.map(() => "?").join(",");
      const responsibilityMarks = ids
        .map((_, index) => `?${index + ids.length + 2}`)
        .join(",");
      statements.push(
        session
          .prepare(
            `UPDATE "HouseholdMember" SET archived_at=?1,erasure_user_id=?2,revision=revision+1,updated_at=?1 WHERE family_id=?3 AND id IN (${marks}) AND archived_at IS NULL`,
          )
          .bind(now.getTime(), target.id, args.familyId, ...ids),
      );
      statements.push(
        session
          .prepare(
            `UPDATE "ResponsibilityState" SET backup_member_id=NULL,primary_subject_member_id=NULL WHERE family_id=?1 AND (backup_member_id IN (${marks}) OR primary_subject_member_id IN (${responsibilityMarks}))`,
          )
          .bind(args.familyId, ...ids, ...ids),
      );
      statements.push(
        session
          .prepare(
            `DELETE FROM "HouseholdMemberAccountLink" WHERE family_id=?1 AND user_id=?2 AND member_id IN (${marks})`,
          )
          .bind(args.familyId, target.id, ...ids),
      );
      statements.push(
        session
          .prepare(
            `DELETE FROM "HouseholdMemberLegacyMapping" WHERE family_id=?1 AND user_id=?2 AND member_id IN (${marks})`,
          )
          .bind(args.familyId, target.id, ...ids),
      );
    }
    // Open assignments are handed to the removing parent. A canonical
    // profile-owned chore keeps the actor's profile identity when one exists;
    // completed history remains attributed to the archived profile.
    if (actorProfileIds.length && ids.length) {
      statements.push(
        session
          .prepare(
            "UPDATE \"Chore\" SET assigned_to=?1,assigned_member_id=?2,member_subject_erased=0 WHERE family_id=?3 AND assigned_to=?4 AND assigned_member_id=?5 AND status NOT IN ('completed','verified','approved')",
          )
          .bind(
            args.actorId,
            actorProfileIds[0],
            args.familyId,
            target.id,
            ids[0],
          ),
      );
    }
    statements.push(
      session
        .prepare(
          "UPDATE \"Chore\" SET assigned_to=?1,assigned_member_id=NULL,member_subject_erased=0 WHERE family_id=?2 AND assigned_to=?3 AND status NOT IN ('completed','verified','approved') AND (assigned_member_id IS NULL OR assigned_member_id<>?4)",
        )
        .bind(args.actorId, args.familyId, target.id, ids[0] ?? ""),
    );
    statements.push(
      session
        .prepare(
          "DELETE FROM \"ChoreAssignment\" WHERE family_id=?1 AND assigned_to=?2 AND status NOT IN ('completed','verified','approved')",
        )
        .bind(args.familyId, target.id),
    );
    statements.push(
      ...responsibilityStatements(
        session,
        args.familyId,
        target.id,
        ids,
        args.actorId,
      ),
    );
    statements.push(
      session
        .prepare(
          'DELETE FROM "HouseholdProfileLinkChallenge" WHERE family_id=?1 AND (issued_by=?2 OR claimed_by=?2)',
        )
        .bind(args.familyId, target.id),
    );
    statements.push(
      session
        .prepare(
          'DELETE FROM "CalendarEventLink" WHERE family_id=?1 AND connection_id IN (SELECT id FROM "CalendarConnection" WHERE user_id=?2)',
        )
        .bind(args.familyId, target.id),
    );
    statements.push(
      session
        .prepare(
          'DELETE FROM "CalendarConnection" WHERE family_id=?1 AND user_id=?2',
        )
        .bind(args.familyId, target.id),
    );
    statements.push(
      session
        .prepare(
          'DELETE FROM "CalendarOAuthState" WHERE family_id=?1 AND user_id=?2',
        )
        .bind(args.familyId, target.id),
    );
    statements.push(
      session
        .prepare(
          'DELETE FROM "FamilyInvite" WHERE family_id=?1 AND created_by=?2 AND accepted_at IS NULL',
        )
        .bind(args.familyId, target.id),
    );
    statements.push(
      session
        .prepare(
          'UPDATE "FamilyInvite" SET created_by=?1 WHERE family_id=?2 AND created_by=?3',
        )
        .bind(args.actorId, args.familyId, target.id),
    );
    statements.push(
      session
        .prepare(
          'DELETE FROM "IdempotencyRecord" WHERE family_id=?1 AND user_id=?2',
        )
        .bind(args.familyId, target.id),
    );
    statements.push(
      session
        .prepare(
          'DELETE FROM "PushSubscription" WHERE family_id=?1 AND user_id=?2',
        )
        .bind(args.familyId, target.id),
    );
    statements.push(
      session
        .prepare('DELETE FROM "AppFeedback" WHERE family_id=?1 AND user_id=?2')
        .bind(args.familyId, target.id),
    );
    statements.push(
      session
        .prepare(
          'UPDATE "NotificationRecipientDecision" SET user_id=NULL WHERE family_id=?1 AND user_id=?2',
        )
        .bind(args.familyId, target.id),
    );
    statements.push(
      session
        .prepare('DELETE FROM "Notification" WHERE user_id=?1')
        .bind(target.id),
    );
    statements.push(
      session
        .prepare('DELETE FROM "Activity" WHERE family_id=?1 AND user_id=?2')
        .bind(args.familyId, target.id),
    );
    statements.push(
      session
        .prepare(
          'UPDATE "Upload" SET uploaded_by=NULL WHERE family_id=?1 AND uploaded_by=?2',
        )
        .bind(args.familyId, target.id),
    );
    statements.push(
      session
        .prepare(
          "UPDATE \"HouseholdDevice\" SET revoked_at=CASE WHEN revoked_at IS NULL AND (created_by=?2 OR confirmed_by=?2) THEN ?1 ELSE revoked_at END,revoked_by=CASE WHEN revoked_at IS NULL AND (created_by=?2 OR confirmed_by=?2) THEN ?3 ELSE revoked_by END,revoke_reason=CASE WHEN revoked_at IS NULL AND (created_by=?2 OR confirmed_by=?2) THEN 'parent' ELSE revoke_reason END,created_by=CASE WHEN created_by=?2 THEN NULL ELSE created_by END,confirmed_by=CASE WHEN confirmed_by=?2 THEN NULL ELSE confirmed_by END,elevation_token_hash=CASE WHEN elevated_user_id=?2 THEN NULL ELSE elevation_token_hash END,elevated_user_id=CASE WHEN elevated_user_id=?2 THEN NULL ELSE elevated_user_id END,elevated_token_version=CASE WHEN elevated_user_id=?2 THEN NULL ELSE elevated_token_version END,elevation_method=CASE WHEN elevated_user_id=?2 THEN NULL ELSE elevation_method END,elevation_started_at=CASE WHEN elevated_user_id=?2 THEN NULL ELSE elevation_started_at END,elevation_last_used_at=CASE WHEN elevated_user_id=?2 THEN NULL ELSE elevation_last_used_at END,elevation_expires_at=CASE WHEN elevated_user_id=?2 THEN NULL ELSE elevation_expires_at END WHERE family_id=?4",
        )
        .bind(now.getTime(), target.id, args.actorId, args.familyId),
    );
    statements.push(
      session
        .prepare(
          'DELETE FROM "ParentElevationPin" WHERE family_id=?1 AND user_id=?2',
        )
        .bind(args.familyId, target.id),
    );
    statements.push(
      session
        .prepare(
          'DELETE FROM "DevicePairing" WHERE family_id=?1 AND created_by=?2 AND device_id IS NULL',
        )
        .bind(args.familyId, target.id),
    );
    statements.push(
      session
        .prepare(
          'UPDATE "DevicePairing" SET created_by=?1 WHERE family_id=?2 AND created_by=?3',
        )
        .bind(args.actorId, args.familyId, target.id),
    );
    statements.push(
      session
        .prepare(
          'UPDATE "DevicePairing" SET confirmed_by=NULL WHERE family_id=?1 AND confirmed_by=?2',
        )
        .bind(args.familyId, target.id),
    );
    statements.push(
      session
        .prepare(
          'UPDATE "User" SET family_id=NULL,token_version=token_version+1,weekly_reset_progress=NULL,weekly_reset_revision=weekly_reset_revision+1 WHERE id=?1 AND family_id=?2',
        )
        .bind(target.id, args.familyId),
      d1WriteCheck(session, "changes()=1"),
    );
    statements.push(
      ...prepareD1AuditLog(
        session,
        [
          {
            familyId: args.familyId,
            actorUserId: args.actorId,
            actorKind: "person",
            action: "member.removed",
            targetType: "member",
            targetId: target.id,
            summary: auditSummary.memberRemoved(target.name, target.role),
          },
          ...tablets.map((tablet) => ({
            familyId: args.familyId,
            actorUserId: args.actorId,
            actorKind: "person" as const,
            action: "device.removed" as const,
            targetType: "device" as const,
            targetId: tablet.id,
            summary: auditSummary.deviceRemoved(tablet.label, "parent"),
          })),
        ],
        now,
      ),
    );
    try {
      await session.batch([...capture.checks(session), ...statements]);
      await revokeGrants(
        pre.grants.filter((grant) => grant.user_id === target.id),
        deps,
      );
      return { removedId: target.id, tabletsRevoked: tablets.length };
    } catch (error) {
      if (isD1WriteConflict(error)) continue;
      throw error;
    }
  }
  throw new NativeMemberRemovalError(
    "IDENTITY_CONFLICT",
    409,
    "The household changed while removing this member. Please retry.",
  );
}
