/** Current person/identity/target authority. No provider or background work. */
import type { Prisma, PrismaClient } from "@prisma/client";
import { lockUser, lockHousehold } from "@/lib/household-lock";
import { isFeatureEnabled, normalizeFeatures } from "@/lib/features";
import {
  isProfileAgeAllowed,
  profileRoleSchema,
} from "@/lib/member-subject-contract";
import {
  readChoreSubject,
  isProfileChoreEnabled,
  profileChoreActionAvailability,
} from "@/lib/chore-profile";
import { routineOccurrencePolicyInTx } from "@/lib/routine-occurrence-policy";
import { readResponsibilityStateInTx } from "@/lib/responsibility-state-store";
import {
  readResponsibilitySource,
  responsibilityStorageAvailable,
} from "@/lib/responsibility-storage";
import { responsibilityView } from "@/lib/responsibility-http-contract";
import { responsibilityWritingEnabled } from "@/lib/responsibility-owner";
import {
  ResponsibilityError,
  projectResponsibility,
  type ResponsibilityCommand,
  type ResponsibilityContext,
  type ResponsibilityTarget,
  type ResponsibilitySubject,
  type ResponsibilityState,
} from "@/lib/responsibility";
export type ResponsibilityActor = {
  userId: string;
  familyId: string;
  role: string;
  tokenVersion: number;
};
type UserRow = {
  id: string;
  family_id: string | null;
  role: string;
  token_version: number;
  name: string;
};
const text = (value: string) =>
  Array.from(value.normalize("NFC")).slice(0, 200).join("");
export const subjectKey = (ref: ResponsibilitySubject) =>
  ref.kind === "account"
    ? `account:${ref.accountId}`
    : `profile:${ref.memberId}`;
function assertActor(
  user:
    | Pick<UserRow, "id" | "family_id" | "role" | "token_version">
    | null
    | undefined,
  actor: ResponsibilityActor,
) {
  if (
    !user ||
    user.id !== actor.userId ||
    user.family_id !== actor.familyId ||
    user.token_version !== actor.tokenVersion ||
    user.role !== actor.role ||
    !["parent", "teen", "child"].includes(user.role)
  )
    throw new ResponsibilityError("UNAUTHORIZED");
}
export async function openResponsibilityActorInTx(
  tx: Prisma.TransactionClient,
  actor: ResponsibilityActor,
) {
  await lockUser(tx, actor.userId);
  await lockHousehold(tx, actor.familyId);
  const user = await tx.user.findUnique({
    where: { id: actor.userId },
    select: { id: true, family_id: true, role: true, token_version: true },
  });
  assertActor(user, actor);
}
export async function renewResponsibilityReceiptActorInTx(
  tx: Prisma.TransactionClient,
  actor: ResponsibilityActor,
) {
  const rows = await tx.$queryRaw<
    UserRow[]
  >`SELECT "id", "family_id", "role", "token_version", "name" FROM "User" WHERE "id" = ${actor.userId} FOR SHARE`;
  assertActor(rows[0], actor);
}
function stateRefs(state: ResponsibilityState | null) {
  return [
    state?.coordinator,
    state?.backup?.subject,
    state?.primaryStatement?.subject,
    ...(state?.primaryStatement
      ? [
          {
            kind: "account" as const,
            accountId: state.primaryStatement.byAccountId,
          },
        ]
      : []),
    ...(state?.backup?.statement
      ? [
          {
            kind: "account" as const,
            accountId: state.backup.statement.byAccountId,
          },
        ]
      : []),
  ].filter((ref): ref is ResponsibilitySubject => ref != null);
}
async function primaryRefs(
  tx: Prisma.TransactionClient,
  familyId: string,
  target: ResponsibilityTarget,
): Promise<ResponsibilitySubject[]> {
  if (target.kind === "chore") {
    const row = await tx.chore.findFirst({
      where: { id: target.id, family_id: familyId },
      select: { assigned_to: true, assigned_member_id: true },
    });
    if (!row) throw new ResponsibilityError("NOT_FOUND");
    return [
      ...(row.assigned_to
        ? [{ kind: "account" as const, accountId: row.assigned_to }]
        : []),
      ...(row.assigned_member_id
        ? [{ kind: "profile" as const, memberId: row.assigned_member_id }]
        : []),
    ];
  }
  if (target.kind === "pickup") {
    const row = await tx.pickup.findFirst({
      where: { id: target.id, family_id: familyId },
      select: { assigned_to: true },
    });
    if (!row) throw new ResponsibilityError("NOT_FOUND");
    return row.assigned_to
      ? [{ kind: "account", accountId: row.assigned_to }]
      : [];
  }
  if (
    !(await tx.handoff.findFirst({
      where: { id: target.id, family_id: familyId },
      select: { id: true },
    }))
  )
    throw new ResponsibilityError("NOT_FOUND");
  return [];
}
function profileEligible(
  row: {
    family_id: string;
    archived_at: Date | null;
    erasure_user_id: string | null;
    role: string;
    age: number | null;
    legacy_mapping: unknown;
    account_link: unknown;
  },
  familyId: string,
) {
  const role = profileRoleSchema.safeParse(row.role);
  return (
    row.family_id === familyId &&
    row.archived_at === null &&
    row.erasure_user_id === null &&
    row.legacy_mapping === null &&
    row.account_link === null &&
    role.success &&
    isProfileAgeAllowed(role.data, row.age)
  );
}
/** Initial ID-only snapshot -> stable identity locks -> target/root -> state.
 * A changed relationship outside that locked set is a conflict, never a new
 * out-of-order lock. Even a first (no metadata) confirmation locks its subject. */
export async function prepareResponsibilityInTx(
  tx: Prisma.TransactionClient,
  actor: ResponsibilityActor,
  target: ResponsibilityTarget,
  command?: ResponsibilityCommand,
  now = new Date(),
) {
  if (target.kind === "handoff" && actor.role === "child")
    throw new ResponsibilityError("FORBIDDEN");
  if (
    command &&
    ((["set-backup", "set-coordinator"].includes(command.action) &&
      actor.role !== "parent") ||
      (command.action === "state-intent" &&
        command.method === "parent-recorded" &&
        actor.role !== "parent"))
  )
    throw new ResponsibilityError("FORBIDDEN");
  if (!(await responsibilityStorageAvailable(tx)))
    throw new ResponsibilityError("UNAVAILABLE");
  const before = await readResponsibilityStateInTx(
    tx,
    actor.familyId,
    target,
    false,
  );
  const initialPrimary = await primaryRefs(tx, actor.familyId, target);
  if (
    target.kind === "chore" &&
    actor.role !== "parent" &&
    ![
      ...initialPrimary.filter((r) => r.kind === "account"),
      before?.state.backup?.subject,
    ].some((r) => r?.kind === "account" && r.accountId === actor.userId)
  )
    throw new ResponsibilityError("NOT_FOUND");
  const refs: ResponsibilitySubject[] = [
    { kind: "account", accountId: actor.userId },
    ...initialPrimary,
    ...stateRefs(before?.state ?? null),
    ...(command && "subject" in command && command.subject
      ? [command.subject]
      : []),
  ];
  const userIds = [
    ...new Set(
      refs.flatMap((r) => (r.kind === "account" ? [r.accountId] : [])),
    ),
  ].sort();
  const memberIds = [
    ...new Set(refs.flatMap((r) => (r.kind === "profile" ? [r.memberId] : []))),
  ].sort();
  const users = await tx.$queryRaw<
    UserRow[]
  >`SELECT "id", "family_id", "role", "token_version", "name" FROM "User" WHERE "family_id" = ${actor.familyId} AND "id" = ANY(${userIds}::text[]) ORDER BY "id" FOR SHARE`;
  assertActor(
    users.find((u) => u.id === actor.userId),
    actor,
  );
  if (memberIds.length)
    await tx.$queryRaw`SELECT "id" FROM "HouseholdMember" WHERE "family_id" = ${actor.familyId} AND "id" = ANY(${memberIds}::text[]) ORDER BY "id" FOR UPDATE`;
  const families = await tx.$queryRaw<
    Array<{ features: unknown }>
  >`SELECT "features" FROM "Family" WHERE "id" = ${actor.familyId} FOR SHARE`;
  if (!families[0]) throw new ResponsibilityError("NOT_FOUND");
  const features = normalizeFeatures(families[0].features);
  if (
    !isFeatureEnabled(
      features,
      target.kind === "chore"
        ? "chores"
        : target.kind === "pickup"
          ? "pickups"
          : "handoff",
    )
  )
    throw new ResponsibilityError("UNAVAILABLE");
  const sourceToken = await readResponsibilitySource(
    tx,
    actor.familyId,
    target,
  );
  const current = await readResponsibilityStateInTx(tx, actor.familyId, target);
  const currentPrimaryRefs = await primaryRefs(tx, actor.familyId, target);
  for (const proof of [
    current?.state.primaryStatement,
    current?.state.backup?.statement,
  ]) {
    if (
      proof?.method === "parent-recorded" &&
      users.find((u) => u.id === proof.byAccountId)?.role !== "parent"
    )
      throw new ResponsibilityError("SUBJECT_UNAVAILABLE");
  }
  const lockedKeys = new Set(refs.map(subjectKey));
  if (
    [...currentPrimaryRefs, ...stateRefs(current?.state ?? null)].some(
      (r) => !lockedKeys.has(subjectKey(r)),
    )
  )
    throw new ResponsibilityError("CONFLICT");
  const profiles = memberIds.length
    ? await tx.householdMember.findMany({
        where: { id: { in: memberIds }, family_id: actor.familyId },
        select: {
          id: true,
          family_id: true,
          name: true,
          role: true,
          age: true,
          archived_at: true,
          erasure_user_id: true,
          legacy_mapping: { select: { user_id: true } },
          account_link: { select: { user_id: true } },
        },
      })
    : [];
  const eligibleUsers = users.filter(
    (u) =>
      ["parent", "teen", "child"].includes(u.role) &&
      (target.kind !== "handoff" || u.role !== "child"),
  );
  const eligibleProfiles =
    target.kind === "chore" && isProfileChoreEnabled()
      ? profiles.filter((p) => profileEligible(p, actor.familyId))
      : [];
  const names = new Map<string, string>([
    ...eligibleUsers.map((u) => [`account:${u.id}`, text(u.name)] as const),
    ...eligibleProfiles.map((p) => [`profile:${p.id}`, text(p.name)] as const),
  ]);
  let primary: ResponsibilitySubject | null = null,
    title = "",
    active = false;
  if (target.kind === "chore") {
    const row = await tx.chore.findFirst({
      where: { id: target.id, family_id: actor.familyId },
      select: {
        id: true,
        title: true,
        status: true,
        frequency: true,
        recurrence_id: true,
        assigned_to: true,
        assigned_member_id: true,
        member_subject_erased: true,
      },
    });
    if (!row) throw new ResponsibilityError("NOT_FOUND");
    const withSubjects = {
      ...row,
      assignee: users.find((u) => u.id === row.assigned_to) ?? null,
      assigneeMember:
        profiles.find((p) => p.id === row.assigned_member_id) ?? null,
    };
    const subject = readChoreSubject(withSubjects, actor.familyId);
    if (
      row.member_subject_erased ||
      (!subject &&
        (row.assigned_to !== null || row.assigned_member_id !== null))
    )
      throw new ResponsibilityError("SUBJECT_UNAVAILABLE");
    primary =
      subject?.kind === "account"
        ? { kind: "account", accountId: subject.accountId }
        : subject?.kind === "profile"
          ? { kind: "profile", memberId: subject.memberId }
          : null;
    const policy = await routineOccurrencePolicyInTx(
      tx,
      actor.familyId,
      target.id,
    );
    active =
      ["pending", "in_progress", "overdue"].includes(row.status) &&
      !["inactive", "unsupported"].includes(policy) &&
      profileChoreActionAvailability(withSubjects, policy)?.state !== "paused";
    title = text(row.title);
  } else if (target.kind === "pickup") {
    const row = await tx.pickup.findFirst({
      where: { id: target.id, family_id: actor.familyId },
      select: { title: true, completed: true, assigned_to: true },
    });
    if (!row) throw new ResponsibilityError("NOT_FOUND");
    primary = row.assigned_to
      ? { kind: "account", accountId: row.assigned_to }
      : null;
    title = text(row.title);
    active = !row.completed;
  } else {
    const row = await tx.handoff.findFirst({
      where: { id: target.id, family_id: actor.familyId },
      select: { sitter_name: true, departure_time: true },
    });
    if (!row) throw new ResponsibilityError("NOT_FOUND");
    title = text(row.sitter_name);
    active = row.departure_time === null || row.departure_time >= now;
  }
  const context: ResponsibilityContext = {
    actor: {
      kind: "person",
      userId: actor.userId,
      familyId: actor.familyId,
      role: actor.role,
    },
    target: {
      ...target,
      familyId: actor.familyId,
      sourceToken,
      active,
      primary,
    },
    eligibleSubjects: [
      ...eligibleUsers.map((u) => ({
        kind: "account" as const,
        accountId: u.id,
      })),
      ...eligibleProfiles.map((p) => ({
        kind: "profile" as const,
        memberId: p.id,
      })),
    ],
    eligibleCoordinators: eligibleUsers
      .filter((u) => u.role !== "child")
      .map((u) => ({ kind: "account" as const, accountId: u.id })),
    statementActorIds: users
      .filter((u) => ["parent", "teen", "child"].includes(u.role))
      .map((u) => u.id),
    writesEnabled: responsibilityWritingEnabled(),
  };
  return {
    current,
    context,
    names,
    title,
    projection: projectResponsibility(current?.state ?? null, context),
  };
}
export async function readResponsibilityView(
  db: PrismaClient,
  actor: ResponsibilityActor,
  target: ResponsibilityTarget,
  query = "",
) {
  return db.$transaction(async (tx) => {
    await openResponsibilityActorInTx(tx, actor);
    const opened = await prepareResponsibilityInTx(tx, actor, target);
    const { context, names, projection } = opened;
    type Named = { subject: ResponsibilitySubject; name: string };
    const choices: Named[] = [];
    let moreChoices = false;
    if (actor.role === "parent") {
      const users = await tx.user.findMany({
        where: {
          family_id: actor.familyId,
          role: {
            in:
              target.kind === "handoff"
                ? ["parent", "teen"]
                : ["parent", "teen", "child"],
          },
          ...(query
            ? { name: { contains: query, mode: "insensitive" as const } }
            : {}),
        },
        select: { id: true, name: true },
        orderBy: [{ name: "asc" }, { id: "asc" }],
        take: 51,
      });
      choices.push(
        ...users.map((u) => ({
          subject: { kind: "account" as const, accountId: u.id },
          name: text(u.name),
        })),
      );
      if (target.kind === "chore" && isProfileChoreEnabled()) {
        const profiles = await tx.householdMember.findMany({
          where: {
            family_id: actor.familyId,
            archived_at: null,
            erasure_user_id: null,
            legacy_mapping: { is: null },
            account_link: { is: null },
            role: { in: ["parent", "teen", "child"] },
            ...(query
              ? { name: { contains: query, mode: "insensitive" as const } }
              : {}),
          },
          select: {
            id: true,
            family_id: true,
            name: true,
            role: true,
            age: true,
            archived_at: true,
            erasure_user_id: true,
            legacy_mapping: { select: { user_id: true } },
            account_link: { select: { user_id: true } },
          },
          orderBy: [{ name: "asc" }, { id: "asc" }],
          take: 51,
        });
        choices.push(
          ...profiles
            .filter((p) => profileEligible(p, actor.familyId))
            .map((p) => ({
              subject: { kind: "profile" as const, memberId: p.id },
              name: text(p.name),
            })),
        );
        moreChoices ||= profiles.length > 50;
      }
      moreChoices ||= users.length > 50 || choices.length > 50;
      choices.sort(
        (a, b) =>
          a.name.localeCompare(b.name) ||
          subjectKey(a.subject).localeCompare(subjectKey(b.subject)),
      );
    }
    const named = (subject: ResponsibilitySubject) => ({
      subject,
      name: names.get(subjectKey(subject)) ?? "",
    });
    const statement = (value: ResponsibilityState["primaryStatement"]) =>
      value
        ? {
            decision: value.decision,
            method: value.method,
            at: value.at,
            byAccountId: value.byAccountId,
            byName: names.get(`account:${value.byAccountId}`) ?? "",
          }
        : null;
    return responsibilityView.parse({
      protocol: "herewoven.responsibility.v1",
      owner: { userId: actor.userId, familyId: actor.familyId },
      target,
      title: opened.title,
      href:
        target.kind === "chore"
          ? actor.role === "parent"
            ? "/dashboard/chores"
            : "/dashboard/today"
          : target.kind === "pickup"
            ? "/dashboard/pickups"
            : "/dashboard/handoff",
      sourceToken: context.target.sourceToken,
      revision: projection.stored.revision,
      active: context.target.active,
      writesEnabled: context.writesEnabled && context.target.active,
      role: actor.role,
      primary: projection.primary
        ? {
            member: named(projection.primary),
            statement: statement(projection.primaryStatement),
          }
        : null,
      backup: projection.backup
        ? {
            member: named(projection.backup.subject),
            statement: statement(projection.backup.statement),
          }
        : null,
      sourceChanged: projection.sourceChanged || projection.duplicateBackup,
      choices: choices.slice(0, 50),
      moreChoices,
    });
  });
}
