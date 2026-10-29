/** Canonical new account/profile chore, repeat copies and exact receipt in one
 * native D1 batch. UI compatibility projections are separate current reads. */
import { randomUUID } from "node:crypto";
import type { z } from "zod";
import type { createChoreSchema } from "@/lib/validations";
import type { ProfileChoreCreateInput } from "@/lib/profile-chore-create-contract";
import {
  ProfileChoreError,
  isProfileChoreEnabled,
  isProfileChoreRecurrenceSupported,
  profileChoreProtocolRefusal,
  readChoreSubject,
} from "@/lib/chore-profile";
import {
  profileRoleSchema,
  isProfileAgeAllowed,
} from "@/lib/member-subject-contract";
import {
  eligibleChoreAssigneeFromReads,
  type ChoreAssigneeReadDb,
} from "@/lib/chore-member-subject";
import { HouseholdMemberIdentityConflict } from "@/lib/household-member-lifecycle";
import {
  resolveChorePhotoForWrite,
  type ChorePhotoReadDb,
} from "@/lib/chore-photos";
import { normalizeDateOnlyInput } from "@/lib/dates";
import { nextSelectedWeekday } from "@/lib/chore-weekdays";
import {
  readChoreCreateReceiptIdentity,
  isChoreBirthGeneration,
} from "@/lib/chore-create-receipt-identity";
import {
  AssistantSourceRefused,
  readAssistantSourceProof,
  type AssistantSourceGuard,
} from "@/lib/assistant-source-proof";
import { hashIdempotentRequest } from "@/lib/idempotency-hash";
import {
  IDEMPOTENCY_TTL_MS,
  IDEMPOTENCY_LOCK_TIMEOUT_MS,
  IDEMPOTENCY_PRUNE_PROBABILITY,
} from "@/lib/idempotency-key";
import { isFeatureEnabled, normalizeFeatures } from "@/lib/features";
import { notificationDeliveryDecision } from "@/lib/notification-delivery-policy";
import { QUIET_HOURS_SELECT } from "@/lib/quiet-hours";
import { choreCreateNotificationDispatchWindow } from "@/lib/chore-create-notification-event";
import type { EffectResult } from "@/lib/idempotency";
import { getD1Database, type D1Store, type D1Statement } from "./database";
import { captureD1Reads } from "./read-witness";
import type { D1ReadClient, NativeD1 } from "./read-client";
import { d1WriteCheck, isD1WriteConflict } from "./write-check";
import {
  prepareD1RecurringSeries,
  type NewRecurringChore,
} from "./recurring-chores";
import { prepareD1ChoreCreateNotification } from "./chore-create-notifications";
import { d1AssistantSourceChecks } from "./assistant-source";
import { pruneD1ExpiredReceipts } from "./notification-preferences";
export type ChoreCreateActor = {
  userId: string;
  familyId: string;
  generation: number;
};
export type ChoreCreateCommand =
  | { kind: "account"; input: z.infer<typeof createChoreSchema> }
  | {
      kind: "profile";
      input: ProfileChoreCreateInput;
      expectedRevision?: number;
    };
export class D1ChoreCreateReceiptError extends Error {
  constructor(
    readonly code:
      | "IDEMPOTENCY_KEY_REUSED"
      | "IDEMPOTENCY_IN_PROGRESS"
      | "IDEMPOTENCY_KEY_REQUIRED",
  ) {
    super(code);
  }
}
type CreateEffect = {
  id: string;
  title: string;
  due_date: Date;
  created_at: Date;
  notifiedInTx: boolean;
  assignee: { id: string; name: string } | null;
  creator: { id: string; name: string };
};
export type D1ChoreCreateResult = EffectResult & {
  replayed: boolean;
  created?: CreateEffect;
};
const failure = (status: number, code: string): EffectResult => ({
  status,
  body: { error: { code } },
});
const profileUnavailable = () => ({
  status: 409,
  body: {
    error: "MEMBER_PROTOCOL_UNAVAILABLE",
    ...profileChoreProtocolRefusal(),
  },
});
export async function readD1ChoreCreateAuthority(
  db: D1ReadClient,
  actor: ChoreCreateActor,
) {
  const user = await db.user.findUnique({
    where: { id: actor.userId },
    select: {
      id: true,
      name: true,
      family_id: true,
      role: true,
      token_version: true,
    },
  });
  if (!user || user.token_version !== actor.generation)
    return { denied: failure(401, "UNAUTHORIZED") };
  if (user.family_id !== actor.familyId || user.role !== "parent")
    return { denied: failure(403, "FORBIDDEN") };
  const family = await db.family.findUnique({
    where: { id: actor.familyId },
    select: { features: true },
  });
  if (!family) return { denied: failure(403, "FORBIDDEN") };
  return { user, family };
}
async function profileTarget(db: D1ReadClient, familyId: string, id: string) {
  const member = await db.householdMember.findFirst({
    where: { id, family_id: familyId },
    select: {
      id: true,
      family_id: true,
      name: true,
      role: true,
      age: true,
      revision: true,
      archived_at: true,
      erasure_user_id: true,
    },
  });
  if (!member) return null;
  const [legacy_mapping, account_link] = await Promise.all([
    db.householdMemberLegacyMapping.findFirst({
      where: { member_id: id },
      select: { user_id: true },
    }),
    db.householdMemberAccountLink.findFirst({
      where: { member_id: id },
      select: { user_id: true },
    }),
  ]);
  return { ...member, legacy_mapping, account_link };
}
function profileDto(
  row: Pick<
    NewRecurringChore,
    | "id"
    | "title"
    | "description"
    | "due_date"
    | "frequency"
    | "weekly_days"
    | "recurrence_id"
    | "is_template"
    | "difficulty"
    | "icon"
    | "routine"
    | "routine_order"
  > & { status: string; created_at: Date },
  subject: {
    kind: "profile";
    memberId: string;
    name: string;
    role: "child" | "teen" | "parent";
  },
) {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    due_date: row.due_date,
    status: row.status,
    frequency: row.frequency,
    weekly_days: row.weekly_days,
    recurrence_id: row.recurrence_id,
    is_template: row.is_template,
    difficulty: row.difficulty,
    icon: row.icon,
    routine: row.routine,
    routine_order: row.routine_order,
    subject,
    created_at: row.created_at,
  };
}
export async function createD1Chore(
  actor: ChoreCreateActor,
  command: ChoreCreateCommand,
  key: string | null,
  options: {
    database?: D1Store;
    now?: Date;
    sourceGuard?: AssistantSourceGuard;
    compact?: boolean;
    clock?: () => Date;
  } = {},
): Promise<D1ChoreCreateResult> {
  const store = options.database ?? (await getD1Database()),
    session = store.withSession("first-primary"),
    clock = options.clock ?? (() => new Date()),
    now = options.now ?? clock(),
    input = command.input;
  if (!Number.isFinite(now.getTime()))
    throw new Error("Invalid chore creation clock");
  const profile = command.kind === "profile",
    source = options.sourceGuard,
    proofActor = { ...actor, role: "parent" },
    action = profile ? "chore.profile.create" : "chore.create",
    scope = `user:${actor.userId}`;
  if (profile && !key)
    throw new D1ChoreCreateReceiptError("IDEMPOTENCY_KEY_REQUIRED");
  if (source) {
    if (
      !source.d1 ||
      source.d1.kind !== "chore_create" ||
      !source.actor ||
      source.actor.userId !== actor.userId ||
      source.actor.familyId !== actor.familyId ||
      source.actor.generation !== actor.generation ||
      source.actor.role !== "parent" ||
      (profile && command.expectedRevision === undefined)
    )
      throw new AssistantSourceRefused();
    readAssistantSourceProof(source.d1.token, proofActor, "chore_create");
  }
  const hash = hashIdempotentRequest(
    action,
    profile && command.expectedRevision !== undefined
      ? { ...input, assistant_profile_revision: command.expectedRevision }
      : input,
  );
  let prune = key !== null && Math.random() < IDEMPOTENCY_PRUNE_PROBABILITY;
  for (let attempt = 0; attempt < 16; attempt++) {
    if (
      profile &&
      (!isProfileChoreEnabled() ||
        (input.frequency !== "once" && !isProfileChoreRecurrenceSupported()))
    )
      return { ...profileUnavailable(), replayed: false };
    const capture = await captureD1Reads(
      async (db) => {
        const authority = await readD1ChoreCreateAuthority(db, actor);
        if ("denied" in authority)
          return { reply: { ...authority.denied!, replayed: false } };
        const { user, family } = authority;
        if (!isFeatureEnabled(normalizeFeatures(family.features), "chores"))
          return {
            reply: {
              status: 403,
              body: { error: "This feature is turned off for your family" },
              replayed: false,
            },
          };
        const rotation =
            command.kind === "account"
              ? (command.input.rotation ?? null)
              : null,
          assigned =
            command.kind === "account"
              ? (rotation?.[0] ?? command.input.assigned_to!)
              : null;
        const recipient = assigned
          ? await db.user.findFirst({
              where: { id: assigned, family_id: actor.familyId },
              select: {
                id: true,
                name: true,
                notify_chores: true,
                ...QUIET_HOURS_SELECT,
              },
            })
          : null;
        if (command.kind === "account" && !recipient)
          return {
            reply: {
              status: 400,
              body: { error: "Assigned user must be in your family" },
              replayed: false,
            },
          };
        if (rotation) {
          const members = await db.user.findMany({
            where: { id: { in: rotation }, family_id: actor.familyId },
            select: { id: true },
          });
          if (members.length !== rotation.length)
            return {
              reply: {
                status: 400,
                body: { error: "Everyone taking turns must be in your family" },
                replayed: false,
              },
            };
        }
        const photo = await resolveChorePhotoForWrite(
          actor.familyId,
          input.photo_url,
          undefined,
          db as unknown as ChorePhotoReadDb,
        );
        if (!photo.ok)
          return {
            reply: {
              status: 400,
              body: { error: photo.error },
              replayed: false,
            },
          };
        const prior =
          key === null
            ? null
            : await db.idempotencyRecord.findUnique({
                where: { scope_key: { scope, key } },
              });
        if (prior && prior.expires_at.getTime() > now.getTime()) {
          if (
            prior.family_id !== actor.familyId ||
            prior.action !== action ||
            prior.request_hash !== hash
          )
            throw new D1ChoreCreateReceiptError("IDEMPOTENCY_KEY_REUSED");
          if (prior.response_status !== null) {
            if (prior.response_body === null)
              throw new D1ChoreCreateReceiptError("IDEMPOTENCY_IN_PROGRESS");
            return {
              reply: {
                status: prior.response_status,
                body: prior.response_body,
                replayed: true,
              },
            };
          }
          if (
            prior.created_at.getTime() >
            now.getTime() - IDEMPOTENCY_LOCK_TIMEOUT_MS
          )
            throw new D1ChoreCreateReceiptError("IDEMPOTENCY_IN_PROGRESS");
        }
        let memberId: string | null = null,
          subject: {
            kind: "profile";
            memberId: string;
            name: string;
            role: "child" | "teen" | "parent";
          } | null = null;
        if (command.kind === "profile") {
          const target = await profileTarget(
            db,
            actor.familyId,
            command.input.selection.memberId,
          );
          if (!target)
            throw new ProfileChoreError("PROFILE_TARGET_UNAVAILABLE");
          const role = profileRoleSchema.safeParse(target.role);
          if (
            !role.success ||
            !isProfileAgeAllowed(role.data, target.age) ||
            target.archived_at ||
            target.erasure_user_id ||
            target.legacy_mapping ||
            target.account_link
          )
            throw new ProfileChoreError("PROFILE_TARGET_CONFLICT");
          if (
            command.expectedRevision !== undefined &&
            target.revision !== command.expectedRevision
          )
            throw new ProfileChoreError("PROFILE_TARGET_CONFLICT");
          memberId = target.id;
          subject = {
            kind: "profile",
            memberId: target.id,
            name: target.name,
            role: role.data,
          };
        } else {
          const assignee = await eligibleChoreAssigneeFromReads(
            db as unknown as ChoreAssigneeReadDb,
            actor.familyId,
            assigned!,
          );
          if (!assignee) throw new HouseholdMemberIdentityConflict();
          memberId = assignee.assigned_member_id ?? null;
        }
        const start = normalizeDateOnlyInput(input.due_date),
          dueDate =
            start && input.frequency === "weekly" && input.weekly_days?.length
              ? nextSelectedWeekday(start, input.weekly_days, true)
              : start;
        if (!dueDate)
          return {
            reply: {
              status: 400,
              body: { error: "Invalid date" },
              replayed: false,
            },
          };
        const id = randomUUID(),
          generation = randomUUID(),
          root: NewRecurringChore = {
            id,
            family_id: actor.familyId,
            created_by: actor.userId,
            title: input.title,
            description: profile
              ? (input.description ?? null)
              : input.description || null,
            points: input.points,
            difficulty: input.difficulty,
            due_date: dueDate,
            frequency: input.frequency,
            weekly_days: input.weekly_days ?? [],
            assigned_to: assigned,
            assigned_member_id: memberId,
            member_subject_erased: false,
            recurrence_id: input.frequency === "once" ? null : id,
            is_template: input.frequency !== "once",
            rotation_member_ids: rotation ?? [],
            rotation_index: rotation ? 0 : null,
            icon: input.icon ?? null,
            routine: input.routine ?? null,
            routine_order: input.routine_order ?? null,
            routine_series_config: null,
          };
        return {
          root,
          generation,
          photo: photo.value ?? null,
          prior,
          user,
          recipient,
          subject,
        };
      },
      store as unknown as NativeD1,
    );
    if ("reply" in capture.value) {
      try {
        await session.batch(capture.checks(session));
        return capture.value.reply!;
      } catch (cause) {
        if (!isD1WriteConflict(cause)) throw cause;
        continue;
      }
    }
    if (prune) {
      prune = false;
      try {
        await pruneD1ExpiredReceipts(session, now.getTime());
      } catch {
        console.warn("[idempotency] Expired receipt cleanup could not finish");
      }
    }
    const { root, generation, photo, prior, user, recipient, subject } =
        capture.value,
      checks = capture.checks(session);
    try {
      if (source)
        checks.push(
          ...(
            await d1AssistantSourceChecks(
              store,
              proofActor,
              "chore_create",
              source,
            )
          ).checks(session),
        );
    } catch (cause) {
      if (
        cause instanceof AssistantSourceRefused &&
        key !== null &&
        (await session
          .prepare(
            `SELECT id FROM "IdempotencyRecord" WHERE scope=?1 AND key=?2 AND family_id=?3 AND action=?4 AND request_hash=?5 AND response_status IS NOT NULL AND expires_at>?6`,
          )
          .bind(scope, key, actor.familyId, action, hash, now.getTime())
          .first())
      )
        continue;
      throw cause;
    }
    const series =
      root.frequency === "once"
        ? null
        : await prepareD1RecurringSeries(
            root.id,
            actor.familyId,
            now,
            store,
            root,
          );
    if (series) checks.push(...series.checks(session));
    const effects: D1Statement[] = [];
    if (prior)
      effects.push(
        session
          .prepare('DELETE FROM "IdempotencyRecord" WHERE id=?1')
          .bind(prior.id),
      );
    effects.push(
      session
        .prepare(
          `INSERT INTO "Chore"(id,family_id,created_by,title,description,points,difficulty,due_date,frequency,weekly_days,assigned_to,assigned_member_id,photo_url,icon,routine,routine_order,responsibility_generation,created_at) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17,?18)`,
        )
        .bind(
          root.id,
          actor.familyId,
          actor.userId,
          root.title,
          root.description,
          root.points,
          root.difficulty,
          root.due_date.getTime(),
          root.frequency,
          JSON.stringify(root.weekly_days),
          root.assigned_to,
          root.assigned_member_id,
          photo,
          root.icon,
          root.routine,
          root.routine_order,
          generation,
          now.getTime(),
        ),
    );
    if (series)
      effects.push(
        session
          .prepare(
            `UPDATE "Chore" SET recurrence_id=id,is_template=1,rotation_member_ids=?1,rotation_index=?2 WHERE id=?3 AND family_id=?4`,
          )
          .bind(
            JSON.stringify(root.rotation_member_ids),
            root.rotation_index,
            root.id,
            actor.familyId,
          ),
        d1WriteCheck(session, "changes()=1"),
        ...series.writes(session).statements,
      );
    effects.push(
      session
        .prepare(
          `INSERT INTO "Activity"(id,family_id,user_id,type,title,metadata,created_at) VALUES (?1,?2,?3,'chore_created','Household record changed',?4,?5)`,
        )
        .bind(
          randomUUID(),
          actor.familyId,
          actor.userId,
          JSON.stringify({
            timeline: 1,
            actorKind: "person",
            target: { kind: "chore", id: root.id },
          }),
          now.getTime(),
        ),
    );
    const windowMs = profile ? null : choreCreateNotificationDispatchWindow();
    if (windowMs !== null && recipient) {
      if (
        clock().getTime() < now.getTime() ||
        clock().getTime() >= now.getTime() + windowMs
      )
        throw new Error("Chore creation notification deadline expired");
      effects.push(
        ...prepareD1ChoreCreateNotification(session, {
          id: root.id,
          familyId: actor.familyId,
          actorId: actor.userId,
          actorName: user.name,
          recipientId: recipient.id,
          generation,
          title: root.title,
          dueDate: root.due_date,
          createdAt: now,
          windowMs,
          policy: notificationDeliveryDecision(recipient, "chore", clock()),
        }),
      );
    }
    const identity = { choreId: root.id, choreGeneration: generation },
      body =
        subject && !options.compact
          ? {
              chore: profileDto(
                { ...root, status: "pending", created_at: now },
                subject,
              ),
              ...identity,
            }
          : identity;
    if (key !== null)
      effects.push(
        session
          .prepare(
            `INSERT INTO "IdempotencyRecord"(id,scope,key,family_id,user_id,action,request_hash,response_status,response_body,created_at,expires_at) VALUES (?1,?2,?3,?4,?5,?6,?7,200,?8,?9,?10)`,
          )
          .bind(
            prior && prior.expires_at.getTime() > now.getTime()
              ? prior.id
              : randomUUID(),
            scope,
            key,
            actor.familyId,
            actor.userId,
            action,
            hash,
            JSON.stringify(body),
            now.getTime(),
            prior && prior.expires_at.getTime() > now.getTime()
              ? prior.expires_at.getTime()
              : now.getTime() + IDEMPOTENCY_TTL_MS,
          ),
      );
    try {
      await session.batch([...checks, ...effects]);
      return {
        status: 200,
        body,
        replayed: false,
        ...(!profile
          ? {
              created: {
                id: root.id,
                title: root.title,
                due_date: root.due_date,
                created_at: now,
                assignee: recipient
                  ? { id: recipient.id, name: recipient.name }
                  : null,
                creator: { id: user.id, name: user.name },
                notifiedInTx: windowMs !== null,
              },
            }
          : {}),
      };
    } catch (cause) {
      if (!isD1WriteConflict(cause)) throw cause;
    }
  }
  throw new D1ChoreCreateReceiptError("IDEMPOTENCY_IN_PROGRESS");
}
/** Live disclosure and content-free original receipt recovery. No cached title,
 * assignment or profile details are used as current content or authority. */
export async function readD1CreatedChore(
  actor: ChoreCreateActor,
  identity: { choreId: string; choreGeneration: string },
  expectedMemberId?: string,
  database?: D1Store,
): Promise<EffectResult> {
  const store = database ?? (await getD1Database()),
    session = store.withSession("first-primary");
  const capture = await captureD1Reads(
    async (db) => {
      const authority = await readD1ChoreCreateAuthority(db, actor);
      if ("denied" in authority) return authority.denied!;
      if (!isChoreBirthGeneration(identity.choreGeneration))
        return failure(409, "CHORE_CREATE_SOURCE_UNKNOWN");
      const row = await db.chore.findFirst({
        where: {
          id: identity.choreId,
          family_id: actor.familyId,
          responsibility_generation: identity.choreGeneration,
          created_by: actor.userId,
          member_subject_erased: false,
          ...(expectedMemberId
            ? { assigned_to: null, assigned_member_id: expectedMemberId }
            : {}),
        },
      });
      if (!row) return failure(409, "CHORE_CREATE_REMOVED");
      if (expectedMemberId) {
        const member = await profileTarget(
            db,
            actor.familyId,
            expectedMemberId,
          ),
          subject = readChoreSubject(
            { ...row, assignee: null, assigneeMember: member },
            actor.familyId,
          );
        if (
          !subject ||
          subject.kind !== "profile" ||
          !Array.isArray(row.weekly_days) ||
          !row.weekly_days.every((d) => typeof d === "number")
        )
          return failure(409, "CHORE_CREATE_REMOVED");
        return {
          status: 200,
          body: {
            chore: profileDto(
              { ...row, weekly_days: row.weekly_days as number[] },
              subject,
            ),
          },
        };
      }
      const people = await db.user.findMany({
        where: {
          family_id: actor.familyId,
          id: {
            in: [row.created_by, ...(row.assigned_to ? [row.assigned_to] : [])],
          },
        },
        select: { id: true, name: true, avatar_url: true, role: true },
      });
      const exposed = {
        ...row,
        assignee: people.find((p) => p.id === row.assigned_to) ?? null,
        creator: people.find((p) => p.id === row.created_by) ?? null,
      };
      if (
        !isFeatureEnabled(
          normalizeFeatures(authority.family.features),
          "gamification",
        )
      ) {
        const { points: _points, ...privatePoints } = exposed;
        return { status: 200, body: { chore: privatePoints } };
      }
      return { status: 200, body: { chore: exposed } };
    },
    store as unknown as NativeD1,
  );
  try {
    await session.batch(capture.checks(session));
    return capture.value;
  } catch (cause) {
    if (!isD1WriteConflict(cause)) throw cause;
    return failure(409, "CHORE_CREATE_CHANGED");
  }
}
export async function readD1ChoreCreateReceipt(
  actor: ChoreCreateActor,
  key: string,
  hash: string,
  action: "chore.create" | "chore.profile.create",
  database?: D1Store,
  now = new Date(),
): Promise<EffectResult> {
  const store = database ?? (await getD1Database()),
    session = store.withSession("first-primary");
  const capture = await captureD1Reads(
    async (db) => {
      const authority = await readD1ChoreCreateAuthority(db, actor);
      if ("denied" in authority) return authority.denied!;
      const record = await db.idempotencyRecord.findFirst({
        where: {
          scope: `user:${actor.userId}`,
          key,
          family_id: actor.familyId,
          user_id: actor.userId,
        },
        select: {
          action: true,
          request_hash: true,
          response_status: true,
          response_body: true,
          expires_at: true,
        },
      });
      if (!record) return { status: 200, body: { state: "absent" } };
      if (record.action !== action || record.request_hash !== hash)
        return { status: 409, body: { error: "CHORE_RECEIPT_CONFLICT" } };
      if (record.expires_at <= now)
        return { status: 200, body: { state: "expired" } };
      if (record.response_status === null)
        return { status: 200, body: { state: "pending" } };
      const identity = readChoreCreateReceiptIdentity(record.response_body);
      if (
        record.response_status < 200 ||
        record.response_status >= 300 ||
        !identity
      )
        return {
          status: 200,
          body: { state: "committed", current: "unknown" },
        };
      const present = await db.chore.findFirst({
        where: {
          id: identity.choreId,
          family_id: actor.familyId,
          responsibility_generation: identity.choreGeneration,
          created_by: actor.userId,
          member_subject_erased: false,
        },
        select: { id: true },
      });
      return {
        status: 200,
        body: { state: "committed", current: present ? "present" : "removed" },
      };
    },
    store as unknown as NativeD1,
  );
  try {
    await session.batch(capture.checks(session));
    return capture.value;
  } catch (cause) {
    if (!isD1WriteConflict(cause)) throw cause;
    return failure(409, "CHORE_RECEIPT_CHANGED");
  }
}
export async function renewD1ChoreCreateActor(
  actor: ChoreCreateActor,
  database?: D1Store,
): Promise<EffectResult | null> {
  const store = database ?? (await getD1Database()),
    session = store.withSession("first-primary");
  const capture = await captureD1Reads(
    async (db) => {
      const authority = await readD1ChoreCreateAuthority(db, actor);
      return "denied" in authority ? authority.denied! : null;
    },
    store as unknown as NativeD1,
  );
  try {
    await session.batch(capture.checks(session));
    return capture.value;
  } catch {
    return failure(401, "UNAUTHORIZED");
  }
}
