/** Native D1 current-occurrence routine stack reads and mutation. */
import { randomUUID } from "node:crypto";
import type { EffectResult } from "@/lib/idempotency";
import { hashIdempotentRequest } from "@/lib/idempotency-hash";
import { IDEMPOTENCY_TTL_MS, IDEMPOTENCY_LOCK_TIMEOUT_MS } from "@/lib/idempotency-key";
import { parseDateOnly } from "@/lib/dates";
import {
  afterChoreCursor,
  choreOrderBy,
  encodeChoreCursor,
  CHORE_PAGE_MAX,
  type ChoreCursor,
} from "@/lib/chore-paging";
import {
  normalizeRoutineStackDraft,
  fingerprintRoutineStackSnapshot,
  fingerprintRoutineStackSelectedStep,
  projectRoutineStackResponse,
  type RoutineStackSnapshotStep,
} from "@/lib/routine-stack";
import { compactResponseSchema } from "@/lib/routine-stack-response-contract";
import { isProfileChoreEnabled } from "@/lib/profile-chore-gates";
import {
  profileRoleSchema,
  isProfileAgeAllowed,
} from "@/lib/member-subject-contract";
import { getD1Database, type D1Store } from "./database";
import { captureD1Reads } from "./read-witness";
import type { D1ReadClient, NativeD1 } from "./read-client";
import { d1WriteCheck, isD1WriteConflict } from "./write-check";

type Actor = {
  familyId: string;
  userId: string;
  role: string;
  tokenVersion?: number;
  memberProtocol?: 1 | 2;
};
const fail = (
  status: number,
  code: string,
  message?: string,
): EffectResult => ({
  status,
  body: { error: { code, ...(message ? { message } : {}) } },
});
const json = (value: unknown) => JSON.stringify(value);
const parsedDays = (value: unknown) => {
  if (Array.isArray(value)) return value as number[];
  if (typeof value === "string") {
    try {
      const output = JSON.parse(value);
      return Array.isArray(output) ? (output as number[]) : [];
    } catch {
      return [];
    }
  }
  return [];
};
function bounds(day: string) {
  const start = parseDateOnly(day);
  if (!start) return null;
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 1);
  return { start, end };
}
function subjectState(member: {
  archived_at: Date | null;
  erasure_user_id: string | null;
  legacy_mapping?: unknown;
  account_link?: unknown;
}) {
  return member.erasure_user_id
    ? "erased"
    : member.archived_at
      ? "archived"
      : !member.legacy_mapping && !member.account_link
        ? "dormant"
        : "eligible";
}
function rowSnapshot(row: any): RoutineStackSnapshotStep {
  return {
    ...row,
    due_date: row.due_date,
    weekly_days: parsedDays(row.weekly_days),
    member_subject_erased: Boolean(row.member_subject_erased),
    photo_verified: Boolean(row.photo_verified),
  };
}

async function currentAuthority(db: D1ReadClient, actor: Actor) {
  const [user, family] = await Promise.all([
    db.user.findUnique({ where: { id: actor.userId }, select: { family_id: true, role: true, token_version: true } }),
    db.family.findUnique({ where: { id: actor.familyId }, select: { features: true } }),
  ]);
  const features = family ? (() => { try { return JSON.parse(String(family.features ?? "{}")) as Record<string, unknown>; } catch { return {}; } })() : {};
  return Boolean(user && user.family_id === actor.familyId && user.role === "parent" && (actor.tokenVersion === undefined || user.token_version === actor.tokenVersion) && family && features.chores !== false);
}

async function assignmentAllowed(db: D1ReadClient, actor: Actor, step: { assigned_to: string | null; assigned_member_id?: string | null; frequency: string; recurrence_id?: string | null }) {
  if (step.assigned_to) {
    const account = await db.user.findFirst({ where: { id: step.assigned_to, family_id: actor.familyId }, select: { id: true } });
    if (!account) return false;
    if (!step.assigned_member_id) return true;
    const member = await db.householdMember.findFirst({ where: { id: step.assigned_member_id, family_id: actor.familyId }, select: { id: true, archived_at: true, erasure_user_id: true, legacy_mapping: { select: { user_id: true } }, account_link: { select: { user_id: true } } } });
    return Boolean(member && !member.archived_at && !member.erasure_user_id && (member.account_link?.user_id === step.assigned_to || member.legacy_mapping?.user_id === step.assigned_to));
  }
  if (actor.memberProtocol !== 2 || !isProfileChoreEnabled() || step.frequency !== "once" || step.recurrence_id != null || !step.assigned_member_id) return false;
  const member = await db.householdMember.findFirst({ where: { id: step.assigned_member_id, family_id: actor.familyId }, select: { id: true, role: true, age: true, archived_at: true, erasure_user_id: true, legacy_mapping: { select: { user_id: true } }, account_link: { select: { user_id: true } } } });
  if (!member || member.archived_at || member.erasure_user_id || member.legacy_mapping || member.account_link) return false;
  const role = profileRoleSchema.safeParse(member.role);
  return role.success && isProfileAgeAllowed(role.data, member.age);
}

export async function readD1RoutineStack(
  actor: Actor,
  stackId: string,
  occurrenceDate: string,
  database?: D1Store,
): Promise<EffectResult | null> {
  const range = bounds(occurrenceDate);
  if (!range || actor.role !== "parent") return null;
  const store = database ?? (await getD1Database());
  const capture = await captureD1Reads(
    async (db) => {
      const user = await db.user.findUnique({
        where: { id: actor.userId },
        select: { family_id: true, role: true, token_version: true },
      });
      const family = await db.family.findUnique({ where: { id: actor.familyId }, select: { features: true } });
      let features: Record<string, unknown> = {};
      try { features = JSON.parse(String(family?.features ?? "{}")); } catch { /* invalid feature JSON is unavailable */ }
      if (
        !user ||
        user.family_id !== actor.familyId ||
        user.role !== "parent" ||
        (actor.tokenVersion !== undefined &&
          user.token_version !== actor.tokenVersion) ||
        !family ||
        features.chores === false
      )
        return null;
      const stack = await db.routineStack.findFirst({
        where: { id: stackId, family_id: actor.familyId },
        select: { id: true, family_id: true, label: true, version: true },
      });
      if (!stack) return null;
      const steps = await db.chore.findMany({
        where: {
          family_id: actor.familyId,
          routine_stack_id: stackId,
          due_date: { gte: range.start, lt: range.end },
        },
        select: {
          id: true,
          family_id: true,
          title: true,
          description: true,
          assigned_to: true,
          assigned_member_id: true,
          member_subject_erased: true,
          due_date: true,
          recurrence_id: true,
          is_template: true,
          routine: true,
          routine_order: true,
          status: true,
          frequency: true,
          weekly_days: true,
          difficulty: true,
          icon: true,
          points: true,
          photo_url: true,
          photo_verified: true,
          verified_at: true,
          verified_notes: true,
          completed_at: true,
          created_at: true,
          created_by: true,
          successor_id: true,
          rotation_member_ids: true,
          rotation_index: true,
          routine_stack_id: true,
        },
        orderBy: { routine_order: "asc" },
      });
      const members = await db.householdMember.findMany({
        where: { family_id: actor.familyId },
        select: {
          id: true,
          name: true,
          role: true,
          archived_at: true,
          erasure_user_id: true,
          legacy_mapping: { select: { user_id: true } },
          account_link: { select: { user_id: true } },
        },
        orderBy: { name: "asc" },
      });
      return { stack, steps, members };
    },
    store as unknown as NativeD1,
  );
  if (!capture.value) return null;
  const steps = capture.value.steps.map(rowSnapshot),
    fingerprint = fingerprintRoutineStackSnapshot(steps);
  if (
    actor.memberProtocol !== 2 &&
    steps.some((step) => step.assigned_to === null)
  )
    return { status: 409, body: { code: "MEMBER_PROTOCOL_UNAVAILABLE" } };
  const members = capture.value.members.map((member) => ({
    id: member.id,
    displayName: member.name,
    role: member.role,
    subjectState: subjectState(member),
  }));
  return {
    status: 200,
    body: {
      stack: capture.value.stack,
      occurrence_date: occurrenceDate,
      fingerprint,
      steps: steps.map((step) => ({
        ...step,
        due_date: new Date(step.due_date).toISOString(),
        verified_at: step.verified_at
          ? new Date(step.verified_at).toISOString()
          : null,
        completed_at: step.completed_at
          ? new Date(step.completed_at).toISOString()
          : null,
        weekly_days: parsedDays(step.weekly_days),
      })),
      members,
      compact: projectRoutineStackResponse({
        stack_id: stackId,
        version: capture.value.stack.version,
        fingerprint,
        steps,
        members: capture.value.members.map((member) => ({
          id: member.id,
          role: member.role,
        })),
      }),
    },
  };
}

export async function readD1RoutineStackCandidates(
  actor: Actor,
  occurrenceDate: string,
  page: { limit?: number; cursor?: ChoreCursor | null } = {},
  database?: D1Store,
): Promise<unknown> {
  const range = bounds(occurrenceDate);
  if (!range || actor.role !== "parent") return null;
  const limit = page.limit ?? CHORE_PAGE_MAX;
  if (!Number.isInteger(limit) || limit < 1 || limit > CHORE_PAGE_MAX)
    return null;
  const store = database ?? (await getD1Database());
  const capture = await captureD1Reads(
    async (db) => {
      const user = await db.user.findUnique({
        where: { id: actor.userId },
        select: { family_id: true, role: true, token_version: true },
      });
      const family = await db.family.findUnique({ where: { id: actor.familyId }, select: { features: true } });
      let features: Record<string, unknown> = {};
      try { features = JSON.parse(String(family?.features ?? "{}")); } catch { /* invalid feature JSON is unavailable */ }
      if (
        !user ||
        user.family_id !== actor.familyId ||
        user.role !== "parent" ||
        (actor.tokenVersion !== undefined &&
          user.token_version !== actor.tokenVersion) ||
        !family ||
        features.chores === false
      )
        return null;
      const [users, members, rows] = await Promise.all([
        db.user.findMany({
          where: { family_id: actor.familyId },
          select: { id: true, name: true, role: true },
          orderBy: { name: "asc" },
        }),
        db.householdMember.findMany({
          where: { family_id: actor.familyId },
          select: {
            id: true,
            name: true,
            role: true,
            age: true,
            archived_at: true,
            erasure_user_id: true,
            legacy_mapping: { select: { user_id: true } },
            account_link: { select: { user_id: true } },
          },
          orderBy: { name: "asc" },
        }),
        db.chore.findMany({
          where: {
            family_id: actor.familyId,
            routine_stack_id: null,
            is_template: false,
            due_date: { gte: range.start, lt: range.end },
            ...(page.cursor
              ? { AND: [afterChoreCursor(page.cursor, "asc")] }
              : {}),
          },
          select: {
            id: true,
            title: true,
            description: true,
            assigned_to: true,
            assigned_member_id: true,
            member_subject_erased: true,
            due_date: true,
            recurrence_id: true,
            is_template: true,
            routine: true,
            routine_order: true,
            status: true,
            frequency: true,
            weekly_days: true,
            difficulty: true,
            icon: true,
          },
          orderBy: choreOrderBy("asc"),
          take: limit + 1,
        }),
      ]);
      return { users, members, rows };
    },
    store as unknown as NativeD1,
  );
  if (!capture.value) return null;
  const value = capture.value;
  const eligibleMembers = value.members.filter(
    (member) => !member.archived_at && !member.erasure_user_id,
  );
  const eligibleProfiles =
    actor.memberProtocol === 2 && isProfileChoreEnabled()
      ? eligibleMembers.filter((member) => {
          const role = profileRoleSchema.safeParse(member.role);
          return (
            role.success &&
            isProfileAgeAllowed(role.data, member.age) &&
            !member.legacy_mapping &&
            !member.account_link
          );
        })
      : [];
  const rawRows = value.rows,
    rows = rawRows.slice(0, limit);
  return {
    occurrence_date: occurrenceDate,
    candidates: rows
      .filter(
        (row) =>
          !row.member_subject_erased &&
          (row.assigned_to
            ? value.users.some((user) => user.id === row.assigned_to)
            : eligibleProfiles.some(
                (member) => member.id === row.assigned_member_id,
              )),
      )
      .map((row) => ({
        ...row,
        due_date: row.due_date.toISOString(),
        weekly_days: parsedDays(row.weekly_days),
        is_template: false,
        expected_fingerprint: fingerprintRoutineStackSelectedStep(
          rowSnapshot(row),
        ),
      })),
    assignmentOptions: [
      ...value.users.map((user) => ({
        accountId: user.id,
        name: user.name,
        role: user.role,
      })),
      ...eligibleProfiles.map((member) => ({
        memberId: member.id,
        name: member.name,
        role: member.role!,
      })),
    ],
    hasMore: rawRows.length > limit,
    nextCursor: rawRows.length > limit ? encodeChoreCursor(rows.at(-1)!) : null,
  };
}

export async function saveD1RoutineStack(
  actor: Actor,
  raw: unknown,
  key: string,
  now = new Date(),
  database?: D1Store,
): Promise<EffectResult> {
  const draft = normalizeRoutineStackDraft(raw),
    requestHash = hashIdempotentRequest("routine-stack.mutate", draft),
    store = database ?? (await getD1Database()),
    session = store.withSession("first-primary");
  if (draft.steps.length === 0) return fail(400, "ROUTINE_STACK_STEP_REQUIRED");
  if (draft.stack_id === null && draft.remove_chore_ids.length > 0) return fail(400, "ROUTINE_STACK_INVALID_DRAFT");
  if (draft.family_id !== actor.familyId) return fail(404, "ROUTINE_STACK_NOT_FOUND");
  const authority = await captureD1Reads((db) => currentAuthority(db, actor), store as unknown as NativeD1);
  if (!authority.value) return fail(403, "FORBIDDEN");
  let receipt = await session
    .prepare(
      `SELECT id,family_id,user_id,action,request_hash,created_at,response_status,response_body,expires_at FROM "IdempotencyRecord" WHERE scope=?1 AND key=?2`,
    )
    .bind(`user:${actor.userId}`, key)
    .first<any>();
  let expired = Boolean(receipt && receipt.expires_at <= now.getTime());
  if (
    receipt &&
    !expired &&
    (receipt.family_id !== actor.familyId ||
      receipt.user_id !== actor.userId ||
      receipt.action !== "routine-stack.mutate" ||
      receipt.request_hash !== requestHash)
  )
    return fail(
      422,
      "IDEMPOTENCY_KEY_REUSED",
      "This retry contains different routine data.",
    );
  if (!expired && receipt?.response_status != null) {
    await session.batch(authority.checks(session));
    let body: unknown = {};
    try { body = receipt.response_body ? JSON.parse(receipt.response_body) : {}; } catch { return fail(409, "ROUTINE_CONFIRMATION_UNAVAILABLE"); }
    const proof = compactResponseSchema.safeParse(body);
    if (!proof.success) return fail(409, "ROUTINE_CONFIRMATION_UNAVAILABLE");
    return {
      status: receipt.response_status,
      body: proof.data,
    };
  }
  if (!expired && receipt?.response_status === null && receipt.created_at > now.getTime() - IDEMPOTENCY_LOCK_TIMEOUT_MS) return fail(409, "IDEMPOTENCY_IN_PROGRESS");
  const range = bounds(draft.occurrence_date);
  if (!range) return fail(400, "ROUTINE_STACK_INVALID_DATE");
  for (let attempt = 0; attempt < 8; attempt++) {
    try {
      const capture = await captureD1Reads(
        async (db) => {
          const user = await db.user.findUnique({
            where: { id: actor.userId },
            select: { family_id: true, role: true, token_version: true },
          });
          const family = await db.family.findUnique({ where: { id: actor.familyId }, select: { features: true } });
          let features: Record<string, unknown> = {};
          try { features = JSON.parse(String(family?.features ?? "{}")); } catch { /* invalid feature JSON is unavailable */ }
          if (
            !user ||
            user.family_id !== actor.familyId ||
            user.role !== "parent" ||
            (actor.tokenVersion !== undefined &&
              user.token_version !== actor.tokenVersion) ||
            !family ||
            features.chores === false
          )
            return null;
          const stack = draft.stack_id
            ? await db.routineStack.findFirst({
                where: { id: draft.stack_id, family_id: actor.familyId },
                select: {
                  id: true,
                  version: true,
                  label: true,
                  fingerprint: true,
                },
              })
            : null;
          const ids = [
            ...new Set([
              ...draft.steps.flatMap((step) =>
                step.chore_id ? [step.chore_id] : [],
              ),
              ...draft.remove_chore_ids,
            ]),
          ];
          const rows = (ids.length || draft.stack_id)
            ? await db.chore.findMany({
                where: {
                  family_id: actor.familyId,
                  due_date: { gte: range.start, lt: range.end },
                  OR: [
                    ...(draft.stack_id ? [{ routine_stack_id: draft.stack_id }] : []),
                    ...(ids.length ? [{ id: { in: ids } }] : []),
                  ],
                },
                select: {
                  id: true,
                  family_id: true,
                  title: true,
                  description: true,
                  assigned_to: true,
                  assigned_member_id: true,
                  member_subject_erased: true,
                  due_date: true,
                  recurrence_id: true,
                  is_template: true,
                  routine: true,
                  routine_order: true,
                  status: true,
                  frequency: true,
                  weekly_days: true,
                  difficulty: true,
                  icon: true,
                  points: true,
                  photo_url: true,
                  photo_verified: true,
                  verified_at: true,
                  verified_notes: true,
                  completed_at: true,
                  created_at: true,
                  created_by: true,
                  successor_id: true,
                  rotation_member_ids: true,
                  rotation_index: true,
                  routine_stack_id: true,
                },
              })
            : [];
          const assignmentValid = (await Promise.all(draft.steps.map(async (step) => {
            const current = rows.find((row) => row.id === step.chore_id);
            const unchanged = Boolean(current && current.assigned_to === step.assigned_to && (current.assigned_member_id ?? null) === (step.assigned_member_id ?? null));
            return unchanged || assignmentAllowed(db, actor, step);
          }))).every(Boolean);
          const recurrenceIds = [...new Set(rows.flatMap((row) => typeof row.recurrence_id === "string" ? [row.recurrence_id] : []))];
          const anchors = recurrenceIds.length ? await db.chore.findMany({ where: { family_id: actor.familyId, id: { in: recurrenceIds } }, select: { id: true, family_id: true, recurrence_id: true, is_template: true, frequency: true } }) : [];
          return { user, stack, rows, anchors, assignmentValid };
        },
        store as unknown as NativeD1,
      );
      if (!capture.value) return fail(403, "FORBIDDEN");
      if (!capture.value.assignmentValid) return fail(409, "ROUTINE_SUBJECT_UNAVAILABLE");
      const currentRows = capture.value.rows as any[],
        currentStackRows = draft.stack_id ? currentRows.filter((row) => row.routine_stack_id === draft.stack_id) : [],
        selectedIds = new Set([
          ...draft.steps.flatMap((step) => step.chore_id ? [step.chore_id] : []),
          ...draft.remove_chore_ids,
        ]),
        selectedRows = currentRows.filter((row) => selectedIds.has(row.id)),
        snapshot = currentStackRows.map(rowSnapshot),
        oldFingerprint = fingerprintRoutineStackSnapshot(snapshot);
      if (draft.stack_id && oldFingerprint !== draft.expected_fingerprint)
        return fail(
          409,
          "ROUTINE_STACK_CONFLICT",
          "Reload this routine and try again.",
        );
      if (selectedRows.length !== selectedIds.size)
        return fail(404, "ROUTINE_STACK_NOT_FOUND");
      if (draft.stack_id && currentStackRows.some((row) => !selectedIds.has(row.id)))
        return fail(409, "ROUTINE_STACK_CONFLICT", "Every current routine step must be kept or removed explicitly.");
      for (const step of draft.steps) {
        if (!step.chore_id) continue;
        const row = currentRows.find((candidate) => candidate.id === step.chore_id);
        if (!row) return fail(404, "ROUTINE_STACK_NOT_FOUND");
        if (row.member_subject_erased && (row.assigned_to !== step.assigned_to || (row.assigned_member_id ?? null) !== (step.assigned_member_id ?? null))) return fail(409, "ROUTINE_SUBJECT_UNAVAILABLE");
        if (!row.routine_stack_id && (!step.expected_fingerprint || fingerprintRoutineStackSelectedStep(rowSnapshot(row)) !== step.expected_fingerprint))
          return fail(409, "ROUTINE_STACK_CONFLICT", "A selected step changed. Reload the routine and try again.");
        if (row.is_template) return fail(409, "ROUTINE_RECURRENCE_UNSUPPORTED");
      }
      for (const row of currentRows) {
        if (!row.recurrence_id) continue;
        const anchor = capture.value.anchors.find((candidate) => candidate.id === row.recurrence_id);
        const validAnchor = Boolean(anchor && anchor.family_id === actor.familyId && anchor.id === anchor.recurrence_id && ((anchor.is_template && ["daily", "weekly", "monthly"].includes(anchor.frequency)) || (!anchor.is_template && anchor.frequency === "once")));
        if (!validAnchor) return fail(409, "ROUTINE_RECURRENCE_UNAVAILABLE");
      }
      const stackId = draft.stack_id ?? randomUUID(),
        version = (capture.value.stack?.version ?? 0) + 1;
      const allRows = draft.steps.map((step, index) => {
        const row = step.chore_id
          ? currentRows.find((candidate) => candidate.id === step.chore_id)
          : null;
        return { id: step.chore_id ?? randomUUID(), row, step, index };
      });
      const compact = projectRoutineStackResponse({
        stack_id: stackId,
        version,
        fingerprint: fingerprintRoutineStackSnapshot(
          allRows.map(({ row, step, id }) =>
            row
              ? rowSnapshot({ ...row, ...step, id })
              : rowSnapshot({
                  id,
                  family_id: actor.familyId,
                  title: step.title ?? "",
                  description: step.description ?? null,
                  assigned_to: step.assigned_to,
                  assigned_member_id: step.assigned_member_id ?? null,
                  due_date: new Date(`${draft.occurrence_date}T00:00:00Z`),
                  status: "pending",
                  frequency: "once",
                  weekly_days: [],
                  is_template: false,
                  member_subject_erased: false,
                  points: 10,
                  photo_verified: false,
                  routine_stack_id: stackId,
                }),
          ),
        ),
        steps: allRows.map(({ id, step }) => ({
          id,
          assigned_to: step.assigned_to,
          assigned_member_id: step.assigned_member_id ?? null,
        })),
        members: [],
      });
      const receiptId = expired ? randomUUID() : receipt?.id ?? randomUUID();
      const statements = [
        ...capture.checks(session),
        d1WriteCheck(
          session,
          `EXISTS(SELECT 1 FROM "User" WHERE id=?1 AND family_id=?2 AND role='parent' AND token_version=?3)`,
          [actor.userId, actor.familyId, actor.tokenVersion ?? 0],
        ),
        d1WriteCheck(
          session,
          `EXISTS(SELECT 1 FROM "Family" WHERE id=?1 AND COALESCE(json_extract(features,'$.chores'),1)<>0)`,
          [actor.familyId],
        ),
      ];
      if (receipt && !expired)
        statements.push(
          d1WriteCheck(
            session,
            `EXISTS(SELECT 1 FROM "IdempotencyRecord" WHERE id=?1 AND response_status IS NULL AND created_at<=?2)`,
            [receipt.id, now.getTime() - IDEMPOTENCY_LOCK_TIMEOUT_MS],
          ),
        );
      else {
        if (receipt && expired)
          statements.push(
            d1WriteCheck(
              session,
              `EXISTS(SELECT 1 FROM "IdempotencyRecord" WHERE id=?1 AND expires_at<=?2)`,
              [receipt.id, now.getTime()],
            ),
            session.prepare(`DELETE FROM "IdempotencyRecord" WHERE id=?1`).bind(receipt.id),
          );
        receipt = {
          id: receiptId,
          family_id: actor.familyId,
          user_id: actor.userId,
          action: "routine-stack.mutate",
          request_hash: requestHash,
          created_at: now.getTime(),
          response_status: null,
          response_body: null,
          expires_at: now.getTime() + IDEMPOTENCY_TTL_MS,
        };
        statements.push(
          d1WriteCheck(
            session,
            `NOT EXISTS(SELECT 1 FROM "IdempotencyRecord" WHERE scope=?1 AND key=?2)`,
            [`user:${actor.userId}`, key],
          ),
          session
            .prepare(
              `INSERT INTO "IdempotencyRecord" (id,scope,key,family_id,user_id,action,request_hash,created_at,expires_at) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9)`,
            )
            .bind(
              receipt.id,
              `user:${actor.userId}`,
              key,
              actor.familyId,
              actor.userId,
              "routine-stack.mutate",
              requestHash,
              now.getTime(),
              receipt.expires_at,
            ),
        );
      }
      if (capture.value.stack)
        statements.push(
          session
            .prepare(
              `UPDATE "RoutineStack" SET label=?1,version=?2,fingerprint=?3,updated_at=?4 WHERE id=?5 AND family_id=?6`,
            )
            .bind(
              draft.label,
              version,
              compact.fingerprint,
              now.getTime(),
              stackId,
              actor.familyId,
            ),
        );
      else
        statements.push(
          session
            .prepare(
              `INSERT INTO "RoutineStack" (id,family_id,label,version,fingerprint,created_by,created_at,updated_at) VALUES (?1,?2,?3,?4,?5,?6,?7,?7)`,
            )
            .bind(
              stackId,
              actor.familyId,
              draft.label,
              version,
              compact.fingerprint,
              actor.userId,
              now.getTime(),
            ),
        );
      for (const id of draft.remove_chore_ids)
        statements.push(
          session
            .prepare(
              `UPDATE "Chore" SET routine_stack_id=NULL,routine=NULL,routine_order=NULL WHERE id=?1 AND family_id=?2 AND routine_stack_id=?3`,
            )
            .bind(id, actor.familyId, stackId),
        );
      for (const item of allRows) {
        if (item.row)
          statements.push(
            session
              .prepare(
                `UPDATE "Chore" SET assigned_to=?1,assigned_member_id=?2,routine_stack_id=?3,routine=?4,routine_order=?5 WHERE id=?6 AND family_id=?7`,
              )
              .bind(
                item.step.assigned_to,
                item.step.assigned_member_id ?? null,
                stackId,
                item.step.routine ?? draft.label,
                item.step.routine_order ?? item.index + 1,
                item.id,
                actor.familyId,
              ),
          );
        else
          statements.push(
            session
              .prepare(
                `INSERT INTO "Chore" (id,family_id,created_by,title,description,assigned_to,assigned_member_id,due_date,status,frequency,routine_stack_id,routine,routine_order) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,'pending','once',?9,?10,?11)`,
              )
              .bind(
                item.id,
                actor.familyId,
                actor.userId,
                item.step.title ??
                  (() => {
                    throw new Error("New routine step requires a title");
                  })(),
                item.step.description ?? null,
                item.step.assigned_to,
                item.step.assigned_member_id ?? null,
                Date.parse(`${draft.occurrence_date}T00:00:00Z`),
                stackId,
                item.step.routine ?? draft.label,
                item.step.routine_order ?? item.index + 1,
              ),
          );
      }
      statements.push(
        session
          .prepare(
            `UPDATE "IdempotencyRecord" SET response_status=200,response_body=?1 WHERE id=?2 AND response_status IS NULL`,
          )
          .bind(json(compact), receipt.id),
      );
      await session.batch(statements);
      return { status: 200, body: compact };
    } catch (error) {
      if (isD1WriteConflict(error) || (error instanceof Error && /UNIQUE|constraint/i.test(error.message))) {
        receipt = await session.prepare(`SELECT id,family_id,user_id,action,request_hash,created_at,response_status,response_body,expires_at FROM "IdempotencyRecord" WHERE scope=?1 AND key=?2`).bind(`user:${actor.userId}`, key).first<any>();
        expired = Boolean(receipt && receipt.expires_at <= now.getTime());
        if (receipt && !expired && (receipt.family_id !== actor.familyId || receipt.user_id !== actor.userId || receipt.action !== "routine-stack.mutate" || receipt.request_hash !== requestHash)) return fail(422, "IDEMPOTENCY_KEY_REUSED", "This retry contains different routine data.");
        if (receipt && !expired && receipt.response_status != null) {
          const live = await captureD1Reads((db) => currentAuthority(db, actor), store as unknown as NativeD1);
          if (!live.value) return fail(403, "FORBIDDEN");
          await session.batch(live.checks(session));
          let body: unknown = {};
          try { body = receipt.response_body ? JSON.parse(receipt.response_body) : {}; } catch { return fail(409, "ROUTINE_CONFIRMATION_UNAVAILABLE"); }
          const proof = compactResponseSchema.safeParse(body);
          if (!proof.success) return fail(409, "ROUTINE_CONFIRMATION_UNAVAILABLE");
          return { status: receipt.response_status, body: proof.data };
        }
        continue;
      }
      throw error;
    }
  }
  return fail(409, "ROUTINE_STACK_CONFLICT");
}
