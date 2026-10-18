/**
 * Transactional Project writes with optional idempotency receipts.
 *
 * Project creation and task creation are available to every household member,
 * so this helper deliberately does not add a parent check. It repeats the
 * household, membership and effective feature checks inside the transaction;
 * a keyed retry must not outlive the actor's current household or the
 * Projects feature. A task and its project's timestamp are one commit.
 */
import type { Prisma, PrismaClient } from "@prisma/client";
import type { z } from "zod";
import type {
  createProjectSchema,
  createProjectTaskSchema,
} from "@/lib/validations";
import type { EffectResult } from "@/lib/idempotency";
import { isFeatureEnabled, normalizeFeatures } from "@/lib/features";
import { lockHousehold, lockUser } from "@/lib/household-lock";

type ProjectTx = Prisma.TransactionClient;
type ProjectDb = Pick<PrismaClient, "$transaction">;
type CreateProjectInput = z.infer<typeof createProjectSchema>;
type CreateProjectTaskInput = z.infer<typeof createProjectTaskSchema>;
type Actor = { familyId: string; userId: string };
type Mutation = "create" | "task.create";

type CurrentActor = { id: string; family_id: string | null; role: string };
type Prepared = { actor: CurrentActor } | { result: EffectResult };

const PROJECT_ACTIONS: Record<Mutation, string> = {
  create: "projects.create",
  "task.create": "projects.task.create",
};

const projectInclude = {
  creator: { select: { id: true, name: true, avatar_url: true } },
  _count: { select: { tasks: true } },
} as const;

const taskInclude = {
  assignee: { select: { id: true, name: true, avatar_url: true } },
} as const;

const inProgress = (): EffectResult => ({
  status: 409,
  body: {
    error: {
      code: "IDEMPOTENCY_IN_PROGRESS",
      message: "Please retry this project request.",
      retryable: true,
    },
  },
});

function featureOff(): EffectResult {
  return {
    status: 403,
    body: { error: "This feature is turned off for your family" },
  };
}

function noFamily(): EffectResult {
  return { status: 400, body: { error: "No family" } };
}

function notFound(message: string): EffectResult {
  return { status: 404, body: { error: message } };
}

function forbidden(): EffectResult {
  return { status: 403, body: { error: "Forbidden" } };
}

function bodyRecord(body: unknown): Record<string, unknown> | null {
  return body && typeof body === "object" && !Array.isArray(body)
    ? (body as Record<string, unknown>)
    : null;
}

function nestedId(body: unknown, key: "project" | "task"): string | null {
  const record = bodyRecord(body);
  const nested = record?.[key];
  const id = bodyRecord(nested)?.id;
  return typeof id === "string" ? id : null;
}

async function prepare(
  tx: ProjectTx,
  actor: Actor,
  recordId: string | null,
): Promise<Prepared> {
  await lockUser(tx, actor.userId);
  await lockHousehold(tx, actor.familyId);

  const [currentActor, family] = await Promise.all([
    tx.user.findUnique({
      where: { id: actor.userId },
      select: { id: true, family_id: true, role: true },
    }),
    tx.family.findUnique({
      where: { id: actor.familyId },
      select: { id: true, features: true },
    }),
  ]);

  if (!family || !currentActor || currentActor.family_id !== actor.familyId) {
    return { result: noFamily() };
  }
  if (!isFeatureEnabled(normalizeFeatures(family.features), "projects")) {
    return { result: featureOff() };
  }

  if (!recordId) return { actor: currentActor };

  await tx.$queryRaw`
    SELECT "id"
    FROM "IdempotencyRecord"
    WHERE "id" = ${recordId}
    FOR UPDATE
  `;
  const receipt = await tx.idempotencyRecord.findFirst({
    where: {
      id: recordId,
      family_id: actor.familyId,
      user_id: actor.userId,
    },
    select: { response_status: true, response_body: true },
  });
  if (!receipt) return { result: inProgress() };
  if (receipt.response_status != null) {
    return {
      result: {
        status: receipt.response_status,
        body: receipt.response_body,
      },
    };
  }

  return { actor: currentActor };
}

async function storeReceipt(
  tx: ProjectTx,
  recordId: string | null,
  result: EffectResult,
): Promise<void> {
  if (!recordId || result.status < 200 || result.status >= 300) return;
  await tx.idempotencyRecord.update({
    where: { id: recordId },
    data: {
      response_status: result.status,
      response_body: JSON.parse(
        JSON.stringify(result.body),
      ) as Prisma.InputJsonObject,
    },
  });
}

async function currentProjectForReplay(
  tx: ProjectTx,
  actor: Actor,
  body: unknown,
): Promise<EffectResult | null> {
  const id = nestedId(body, "project");
  if (!id) return notFound("Project not found");
  const project = await tx.project.findUnique({
    where: { id },
    select: { family_id: true, created_by: true },
  });
  if (!project) return notFound("Project not found");
  if (project.family_id !== actor.familyId) return forbidden();
  if (project.created_by !== actor.userId) return forbidden();
  return null;
}

async function currentTaskProjectForReplay(
  tx: ProjectTx,
  actor: Actor,
  projectId: string,
): Promise<EffectResult | null> {
  const project = await tx.project.findUnique({
    where: { id: projectId },
    select: { family_id: true },
  });
  if (!project) return notFound("Project not found");
  if (project.family_id !== actor.familyId) return forbidden();
  return null;
}

async function lockProject(tx: ProjectTx, projectId: string): Promise<void> {
  await tx.$queryRaw`
    SELECT "id"
    FROM "Project"
    WHERE "id" = ${projectId}
    FOR UPDATE
  `;
}

export async function createProjectWithReceipt(
  db: ProjectDb,
  input: CreateProjectInput,
  actor: Actor,
  recordId: string | null,
): Promise<EffectResult> {
  return db.$transaction(async (tx) => {
    const prepared = await prepare(tx, actor, recordId);
    if ("result" in prepared) {
      if (
        recordId &&
        prepared.result.status >= 200 &&
        prepared.result.status < 300
      ) {
        const replayRefusal = await currentProjectForReplay(
          tx,
          actor,
          prepared.result.body,
        );
        if (replayRefusal) return replayRefusal;
      }
      return prepared.result;
    }

    const project = await tx.project.create({
      data: {
        family_id: actor.familyId,
        name: input.name,
        description: input.description || null,
        color: input.color || "#3B82F6",
        status: input.status || "active",
        created_by: actor.userId,
      },
      include: projectInclude,
    });
    const result: EffectResult = { status: 201, body: { project } };
    await storeReceipt(tx, recordId, result);
    return result;
  });
}

export async function createProjectTaskWithReceipt(
  db: ProjectDb,
  projectId: string,
  input: CreateProjectTaskInput,
  actor: Actor,
  recordId: string | null,
): Promise<EffectResult> {
  return db.$transaction(async (tx) => {
    const prepared = await prepare(tx, actor, recordId);
    if ("result" in prepared) {
      if (
        recordId &&
        prepared.result.status >= 200 &&
        prepared.result.status < 300
      ) {
        const replayRefusal = await currentTaskProjectForReplay(
          tx,
          actor,
          projectId,
        );
        if (replayRefusal) return replayRefusal;
      }
      return prepared.result;
    }

    await lockProject(tx, projectId);
    const project = await tx.project.findFirst({
      where: { id: projectId, family_id: actor.familyId },
      select: { status: true },
    });
    if (!project) return notFound("Project not found");
    if (project.status !== "active") {
      return {
        status: 400,
        body: { error: "Cannot add tasks to a completed or archived project" },
      };
    }

    if (input.assigned_to) {
      const assignee = await tx.user.findFirst({
        where: { id: input.assigned_to, family_id: actor.familyId },
        select: { id: true },
      });
      if (!assignee) return notFound("Assigned user not found");
    }

    const maxPosition = await tx.projectTask.aggregate({
      where: { project_id: projectId },
      _max: { position: true },
    });
    const task = await tx.projectTask.create({
      data: {
        project_id: projectId,
        title: input.title,
        description: input.description || null,
        assigned_to: input.assigned_to || null,
        due_date: input.due_date ? new Date(input.due_date) : null,
        position: (maxPosition._max.position ?? -1) + 1,
      },
      include: taskInclude,
    });
    await tx.project.update({
      where: { id: projectId },
      data: { updated_at: new Date() },
    });

    const result: EffectResult = { status: 201, body: { task } };
    await storeReceipt(tx, recordId, result);
    return result;
  });
}

export async function authorizeProjectReplay(
  db: ProjectDb,
  mutation: Mutation,
  actor: Actor,
  projectId?: string,
  replayKey?: string | null,
): Promise<EffectResult | null> {
  return db.$transaction(async (tx) => {
    await lockUser(tx, actor.userId);
    await lockHousehold(tx, actor.familyId);
    const [currentActor, family] = await Promise.all([
      tx.user.findUnique({
        where: { id: actor.userId },
        select: { id: true, family_id: true },
      }),
      tx.family.findUnique({
        where: { id: actor.familyId },
        select: { id: true, features: true },
      }),
    ]);
    if (!family || !currentActor || currentActor.family_id !== actor.familyId) {
      return noFamily();
    }
    if (!isFeatureEnabled(normalizeFeatures(family.features), "projects")) {
      return featureOff();
    }
    if (mutation === "create" && replayKey) {
      const receipt = await tx.idempotencyRecord.findFirst({
        where: {
          scope: `user:${actor.userId}`,
          key: replayKey,
          family_id: actor.familyId,
          user_id: actor.userId,
          action: projectAction("create"),
        },
        select: { response_body: true },
      });
      const refusal = await currentProjectForReplay(
        tx,
        actor,
        receipt?.response_body,
      );
      return refusal;
    }
    if (mutation === "task.create" && projectId) {
      return currentTaskProjectForReplay(tx, actor, projectId);
    }
    return null;
  });
}

export function projectAction(mutation: Mutation, projectId?: string): string {
  return projectId
    ? `${PROJECT_ACTIONS[mutation]}:${projectId}`
    : PROJECT_ACTIONS[mutation];
}
