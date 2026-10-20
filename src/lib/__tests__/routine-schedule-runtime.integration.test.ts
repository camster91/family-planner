import { deleteMemberAccount } from "../account-deletion";
import { expandSeriesInTx, topUpHouseholdSeries } from "../recurringChores";
import { rewriteRoutineSubjectsInTx } from "../routine-subject-lifecycle";
import {
  saveIndependentRoutineStep,
  readIndependentRoutineStep,
  reviewIndependentRoutineStep,
} from "../routine-independent-runtime";
import {
  routineIndependentCommand,
  routineIndependentReceipt,
  ROUTINE_INDEPENDENT_PROTOCOL,
} from "../routine-independent";
/** Authored only. Never run outside an explicitly guarded disposable database. */
import crypto from "node:crypto";
import { prisma } from "@/lib/prisma";
import { assertFixtureTargetAllowed } from "@/lib/fixtures/guard";
import { readRoutineScheduleCatalog } from "@/lib/routine-schedule-catalog";
import { readRoutineScheduleHandoff } from "@/lib/routine-schedule-handoff";
import {
  saveRoutineSchedule,
  reviewRoutineSchedule,
} from "@/lib/routine-schedule-api";
import { completeChore, findHouseholdChore } from "@/lib/chore-complete";
import {
  hiddenRoutineOccurrenceIds,
  RoutineOccurrenceUnavailableError,
} from "@/lib/routine-occurrence-policy";
import { hashIdempotentRequest, IDEMPOTENCY_TTL_MS } from "@/lib/idempotency";
import {
  persistRoutineSchedule,
  routineScheduleAuthority,
  readRoutineSchedule,
  ROUTINE_SCHEDULE_ACTION,
  ROUTINE_SCHEDULE_READY_ENV,
  ROUTINE_SCHEDULE_WRITE_ENV,
} from "../routine-schedule-runtime";
import {
  routineScheduleCommand,
  routineScheduleReceipt,
  type RoutineScheduleCommand,
} from "../routine-schedule";
const suite = process.env.RUN_DB_INTEGRATION === "1" ? describe : describe.skip;
suite("canonical scheduled routine commands", () => {
  const suffix = crypto.randomUUID(),
    familyId = `fx_schedule_a_${suffix}`,
    otherFamily = `fx_schedule_b_${suffix}`;
  const parent = `fx_schedule_parent_${suffix}`,
    teen = `fx_schedule_teen_${suffix}`,
    foreignParent = `fx_schedule_foreign_${suffix}`;
  const now = new Date("2026-10-20T16:00:00.000Z");
  const actor = { userId: parent, familyId, tokenVersion: 0 };
  const savedEnv = [ROUTINE_SCHEDULE_READY_ENV, ROUTINE_SCHEDULE_WRITE_ENV].map(
    (key) => [key, process.env[key]] as const,
  );
  const step = (name: string) => ({
    client_step_id: crypto.randomUUID(),
    template_id: null,
    title: name,
    description: null,
    subject: { kind: "account", user_id: parent, member_id: null },
    points: 0,
    difficulty: "easy",
    icon: null,
    duration_minutes: 10,
  });
  const command = () =>
    routineScheduleCommand.parse({
      protocol: "herewoven.routine-schedule.v1",
      expected_user_id: parent,
      expected_family_id: familyId,
      issued_at: now.toISOString(),
      view_day: "2026-10-20",
      view_zone: "America/Toronto",
      action: "create",
      label: "Fixture morning",
      anchor: "After breakfast",
      schedule: {
        frequency: "weekly",
        starts_on: null,
        weekly_days: [1, 3],
        monthly_day: null,
      },
      steps: [step("Fixture breakfast"), step("Fixture bags")],
    });
  async function reserve(body: RoutineScheduleCommand) {
    return prisma!.idempotencyRecord.create({
      data: {
        scope: `user:${body.expected_user_id}`,
        key: crypto.randomUUID(),
        user_id: body.expected_user_id,
        family_id: body.expected_family_id,
        action: ROUTINE_SCHEDULE_ACTION,
        request_hash: hashIdempotentRequest(ROUTINE_SCHEDULE_ACTION, body),
        expires_at: new Date(Date.parse(body.issued_at) + IDEMPOTENCY_TTL_MS),
      },
    });
  }
  async function create(body: RoutineScheduleCommand = command()) {
    const record = await reserve(body),
      result = await persistRoutineSchedule(
        prisma!,
        actor,
        body,
        record.id,
        now,
      );
    expect(result.status).toBe(201);
    return { body, record, proof: routineScheduleReceipt.parse(result.body) };
  }
  beforeAll(async () => {
    assertFixtureTargetAllowed(process.env);
    process.env[ROUTINE_SCHEDULE_READY_ENV] = "1";
    process.env[ROUTINE_SCHEDULE_WRITE_ENV] = "1";
    await prisma!.family.createMany({
      data: [
        { id: familyId, name: "Schedule fixture", features: { chores: true } },
        {
          id: otherFamily,
          name: "Other schedule fixture",
          features: { chores: true },
        },
      ],
    });
    await prisma!.user.createMany({
      data: [
        {
          id: parent,
          email: `schedule-pa-${suffix}@example.invalid`,
          name: "Fixture parent",
          role: "parent",
          family_id: familyId,
        },
        {
          id: teen,
          email: `schedule-ta-${suffix}@example.invalid`,
          name: "Fixture teen",
          role: "teen",
          family_id: familyId,
        },
        {
          id: foreignParent,
          email: `schedule-pb-${suffix}@example.invalid`,
          name: "Other fixture parent",
          role: "parent",
          family_id: otherFamily,
        },
      ],
    });
  });
  afterAll(async () => {
    for (const [key, value] of savedEnv)
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    await prisma!.family.deleteMany({
      where: { id: { in: [familyId, otherFamily] } },
    });
    await prisma!.user.deleteMany({
      where: { id: { in: [parent, teen, foreignParent] } },
    });
    await prisma!.$disconnect();
  });
  it("commits roots/config/receipt once under concurrent same-record retries and confirms while fresh writes are paused", async () => {
    const body = command(),
      record = await reserve(body);
    const results = await Promise.all([
      persistRoutineSchedule(prisma!, actor, body, record.id, now),
      persistRoutineSchedule(prisma!, actor, body, record.id, now),
    ]);
    expect(results.map((row) => row.status)).toEqual([201, 201]);
    const proof = routineScheduleReceipt.parse(results[0].body);
    expect(results[1].body).toEqual(proof);
    expect(
      await prisma!.chore.count({
        where: { id: { in: proof.roots }, family_id: familyId },
      }),
    ).toBe(2);
    process.env[ROUTINE_SCHEDULE_WRITE_ENV] = "0";
    try {
      expect(
        (
          await persistRoutineSchedule(
            prisma!,
            actor,
            body,
            record.id,
            new Date("2026-10-21T16:00:00.000Z"),
          )
        ).body,
      ).toEqual(proof);
      expect(
        (await readRoutineSchedule(prisma!, actor, proof.stackId)).status,
      ).toBe(200);
    } finally {
      process.env[ROUTINE_SCHEDULE_WRITE_ENV] = "1";
    }
  });
  it("reserves and commits one keyed effect atomically, reviews late proof and rolls back a refused reservation", async () => {
    const input = command(),
      key = crypto.randomUUID();
    const results = await Promise.all([
      saveRoutineSchedule(prisma!, actor, input, key, now),
      saveRoutineSchedule(prisma!, actor, input, key, now),
    ]);
    expect(results.map((row) => row.status)).toEqual([201, 201]);
    expect(results[0].body).toEqual(results[1].body);
    expect(
      await prisma!.idempotencyRecord.count({
        where: { scope: `user:${parent}`, key },
      }),
    ).toBe(1);
    expect(
      (
        await saveRoutineSchedule(
          prisma!,
          actor,
          { ...input, label: "Changed request" },
          key,
          now,
        )
      ).status,
    ).toBe(422);
    const entry = {
      kind: "schedule" as const,
      key,
      body: JSON.stringify(input),
    };
    const late = new Date(now.getTime() + 10 * 24 * 60 * 60_000);
    expect(
      (
        await reviewRoutineSchedule(
          prisma!,
          actor,
          entry,
          "a".repeat(64),
          false,
          late,
        )
      ).body,
    ).toMatchObject({
      state: "committed",
      canRetry: false,
      receipt: results[0].body,
    });
    expect(
      (await saveRoutineSchedule(prisma!, actor, input, key, late, false)).body,
    ).toEqual(results[0].body);
    const absent = crypto.randomUUID();
    expect(
      (
        await reviewRoutineSchedule(
          prisma!,
          actor,
          { ...entry, key: absent },
          "a".repeat(64),
          true,
          late,
        )
      ).body,
    ).toMatchObject({ state: "expired", canRetry: false });
    expect(
      (await saveRoutineSchedule(prisma!, actor, input, absent, late)).status,
    ).toBe(409);
    expect(
      await prisma!.idempotencyRecord.findUnique({
        where: { scope_key: { scope: `user:${parent}`, key: absent } },
      }),
    ).toBeNull();
    expect(
      (
        await reviewRoutineSchedule(
          prisma!,
          { ...actor, familyId: otherFamily },
          entry,
          "a".repeat(64),
          true,
          now,
        )
      ).status,
    ).toBe(403);
  });
  it("keeps points out of disabled parent DTOs while preserving hidden future values and scoped catalog authority", async () => {
    const created = await create();
    if (created.body.action !== "create") throw new Error("fixture mismatch");
    const root = created.proof.roots[0];
    await prisma!
      .$executeRaw`UPDATE "Chore" SET "routine_series_config" = jsonb_set("routine_series_config", '{content,points}', '7'::jsonb) WHERE "id" = ${root} AND "family_id" = ${familyId}`;
    const hidden = await readRoutineSchedule(
      prisma!,
      actor,
      created.proof.stackId,
    );
    expect(hidden.body).toMatchObject({ pointsEnabled: false });
    expect(
      (hidden.body as { steps: unknown[] }).steps.every(
        (step) => !Object.prototype.hasOwnProperty.call(step, "points"),
      ),
    ).toBe(true);
    const catalog = await readRoutineScheduleCatalog(prisma!, actor, null);
    expect(catalog.status).toBe(200);
    expect(catalog.body).toMatchObject({
      userId: parent,
      familyId,
      pointsEnabled: false,
    });
    expect(
      (
        await readRoutineScheduleCatalog(
          prisma!,
          { userId: teen, familyId, tokenVersion: 0 },
          null,
        )
      ).status,
    ).toBe(403);
    const replacement = routineScheduleCommand.parse({
      ...created.body,
      action: "replace-future",
      stack_id: created.proof.stackId,
      expected_version: created.proof.version,
      removed_steps: [],
      steps: created.body.steps.map((step, index) => ({
        ...step,
        template_id: created.proof.roots[index],
        points: null,
      })),
    });
    expect(
      (
        await persistRoutineSchedule(
          prisma!,
          actor,
          replacement,
          (await reserve(replacement)).id,
          now,
        )
      ).status,
    ).toBe(200);
    const stored = await prisma!.$queryRaw<
      { points: number }[]
    >`SELECT ("routine_series_config"->'content'->>'points')::integer AS points FROM "Chore" WHERE "id" = ${root} AND "family_id" = ${familyId}`;
    expect(stored[0].points).toBe(7);
    await prisma!.family.update({
      where: { id: familyId },
      data: { features: { chores: true, gamification: true } },
    });
    try {
      expect(
        (await readRoutineSchedule(prisma!, actor, created.proof.stackId)).body,
      ).toMatchObject({
        pointsEnabled: true,
        steps: expect.arrayContaining([
          expect.objectContaining({ template_id: root, points: 7 }),
        ]),
      });
    } finally {
      await prisma!.family.update({
        where: { id: familyId },
        data: { features: { chores: true } },
      });
    }
  });
  it("hands off owned scheduled identities without adopting same-name legacy stacks or redirecting individual copies", async () => {
    const created = await create();
    if (created.body.action !== "create") throw new Error("fixture mismatch");
    const expected = `/dashboard/chores/schedules?stack_id=${created.proof.stackId}`;
    expect(
      await readRoutineScheduleHandoff(
        prisma!,
        familyId,
        "stack",
        created.proof.stackId,
      ),
    ).toBe(expected);
    expect(
      await readRoutineScheduleHandoff(
        prisma!,
        otherFamily,
        "stack",
        created.proof.stackId,
      ),
    ).toBeNull();
    expect(
      await readRoutineScheduleHandoff(
        prisma!,
        familyId,
        "chore",
        created.proof.roots[0],
      ),
    ).toBe(expected);
    const copy = await prisma!.chore.findFirstOrThrow({
      where: {
        family_id: familyId,
        recurrence_id: created.proof.roots[0],
        id: { not: created.proof.roots[0] },
      },
      select: { id: true },
    });
    expect(
      await readRoutineScheduleHandoff(prisma!, familyId, "chore", copy.id),
    ).toBeNull();
    const legacy = await prisma!.routineStack.create({
      data: {
        id: crypto.randomUUID(),
        family_id: familyId,
        created_by: parent,
        label: created.body.label,
        fingerprint: "fixture-legacy",
      },
    });
    expect(
      await readRoutineScheduleHandoff(prisma!, familyId, "stack", legacy.id),
    ).toBeNull();
  });
  it("controls an explicitly unstacked root with revisions, immutable receipts and preserved evidence", async () => {
    const created = await create();
    const [kept, detached] = created.proof.roots;
    const request = (revision: number, action: "pause" | "resume" | "stop") =>
      routineIndependentCommand.parse({
        protocol: ROUTINE_INDEPENDENT_PROTOCOL,
        expected_user_id: parent,
        expected_family_id: familyId,
        issued_at: now.toISOString(),
        view_day: "2026-10-20",
        view_zone: "America/Toronto",
        root_id: detached,
        expected_revision: revision,
        action,
        scope: "future-after-today",
      });
    expect(
      (
        await saveIndependentRoutineStep(
          prisma!,
          actor,
          request(1, "pause"),
          crypto.randomUUID(),
          now,
        )
      ).status,
    ).toBe(409);
    const original = created.body as Extract<
      RoutineScheduleCommand,
      { action: "create" }
    >;
    const replacement = routineScheduleCommand.parse({
      ...original,
      action: "replace-future",
      stack_id: created.proof.stackId,
      expected_version: 1,
      steps: [{ ...original.steps[0], template_id: kept }],
      removed_steps: [{ template_id: detached, disposition: "unstack-future" }],
    });
    expect(
      (
        await saveRoutineSchedule(
          prisma!,
          actor,
          replacement,
          crypto.randomUUID(),
          now,
        )
      ).status,
    ).toBe(200);
    const before = await prisma!.chore.findUniqueOrThrow({
      where: { id: detached },
    });
    expect(
      await readRoutineScheduleHandoff(prisma!, familyId, "chore", detached),
    ).toBe(
      `/dashboard/chores/schedules/independent?root_id=${encodeURIComponent(detached)}`,
    );
    expect(
      await readRoutineScheduleHandoff(prisma!, otherFamily, "chore", detached),
    ).toBeNull();

    const evidence = crypto.randomUUID();
    await prisma!.chore.create({
      data: {
        id: evidence,
        family_id: familyId,
        created_by: parent,
        assigned_to: parent,
        title: "Original evidence snapshot",
        recurrence_id: detached,
        routine_stack_id: null,
        due_date: new Date("2026-10-22T00:00:00.000Z"),
        photo_url: "fixture-proof.jpg",
        status: "pending",
      },
    });
    const key = crypto.randomUUID(),
      pause = request(2, "pause");
    const results = await Promise.all([
      saveIndependentRoutineStep(prisma!, actor, pause, key, now),
      saveIndependentRoutineStep(prisma!, actor, pause, key, now),
    ]);
    expect(results[0].body).toEqual(results[1].body);
    const proof = routineIndependentReceipt.parse(results[0].body);
    expect(proof).toMatchObject({
      revision: 3,
      rootId: detached,
      state: "paused",
    });
    const recoveryEntry = {
      kind: "independent" as const,
      key,
      body: JSON.stringify(pause),
    };
    const reviewed = await reviewIndependentRoutineStep(
      prisma!,
      actor,
      recoveryEntry,
      "a".repeat(64),
      false,
      new Date(now.getTime() + 10 * 86400000),
    );
    expect(reviewed.body).toMatchObject({
      state: "committed",
      canRetry: false,
      receipt: proof,
    });
    const expiredKey = crypto.randomUUID();
    expect(
      (
        await reviewIndependentRoutineStep(
          prisma!,
          actor,
          { ...recoveryEntry, key: expiredKey },
          "a".repeat(64),
          true,
          new Date(now.getTime() + 16 * 60000),
        )
      ).body,
    ).toMatchObject({ state: "expired", canRetry: false });
    expect(
      await prisma!.idempotencyRecord.findUnique({
        where: { scope_key: { scope: `user:${parent}`, key: expiredKey } },
      }),
    ).toBeNull();

    expect(
      await prisma!.chore.findUnique({ where: { id: evidence } }),
    ).toMatchObject({
      title: "Original evidence snapshot",
      photo_url: "fixture-proof.jpg",
    });
    expect(
      await prisma!.chore.findUnique({ where: { id: detached } }),
    ).toMatchObject({ title: before.title, due_date: before.due_date });
    const late = new Date(now.getTime() + 10 * 86400000);
    expect(
      (
        await saveIndependentRoutineStep(
          prisma!,
          actor,
          pause,
          key,
          late,
          false,
        )
      ).body,
    ).toEqual(proof);
    expect(
      (
        await saveIndependentRoutineStep(
          prisma!,
          actor,
          request(2, "stop"),
          key,
          now,
        )
      ).status,
    ).toBe(422);
    const staleKey = crypto.randomUUID();
    expect(
      (await saveIndependentRoutineStep(prisma!, actor, pause, staleKey, now))
        .status,
    ).toBe(409);
    expect(
      await prisma!.idempotencyRecord.findUnique({
        where: { scope_key: { scope: `user:${parent}`, key: staleKey } },
      }),
    ).toBeNull();
    const state = await readIndependentRoutineStep(prisma!, actor, detached);
    expect(state.body).toMatchObject({
      revision: 3,
      state: "paused",
      pointsEnabled: false,
    });
    expect(JSON.stringify(state.body)).not.toContain('"points":');
    expect(
      (
        await readIndependentRoutineStep(
          prisma!,
          { ...actor, userId: foreignParent, familyId: otherFamily },
          detached,
        )
      ).status,
    ).toBe(404);
    expect(
      (
        await saveIndependentRoutineStep(
          prisma!,
          actor,
          request(3, "resume"),
          crypto.randomUUID(),
          now,
        )
      ).status,
    ).toBe(200);
    // Strict content intentionally contains no editor identity keys.
    const {
      client_step_id: _client,
      template_id: _template,
      ...content
    } = original.steps[1];
    const editable = routineIndependentCommand.parse({
      ...request(4, "pause"),
      action: "replace-future",
      anchor: "After lunch",
      schedule: {
        frequency: "daily",
        starts_on: "2026-10-21",
        weekly_days: [],
        monthly_day: null,
      },
      content: { ...content, title: "Future independent title", points: 999 },
    });
    expect(
      (
        await saveIndependentRoutineStep(
          prisma!,
          actor,
          editable,
          crypto.randomUUID(),
          now,
        )
      ).status,
    ).toBe(200);
    const stored = await prisma!.$queryRaw<
      {
        routine_series_config: {
          revision: number;
          content: { points: number; title: string };
        };
      }[]
    >`SELECT "routine_series_config" FROM "Chore" WHERE "id" = ${detached} AND "family_id" = ${familyId}`;
    expect(stored[0].routine_series_config).toMatchObject({
      revision: 5,
      content: { points: 0, title: "Future independent title" },
    });
    expect(
      await prisma!.chore.findUnique({ where: { id: detached } }),
    ).toMatchObject({ title: before.title });
    expect(
      (
        await saveIndependentRoutineStep(
          prisma!,
          actor,
          request(5, "stop"),
          crypto.randomUUID(),
          now,
        )
      ).status,
    ).toBe(200);
    expect(
      (
        await saveIndependentRoutineStep(
          prisma!,
          actor,
          request(6, "resume"),
          crypto.randomUUID(),
          now,
        )
      ).status,
    ).toBe(409);
    expect(
      (await readRoutineSchedule(prisma!, actor, created.proof.stackId)).body,
    ).toMatchObject({
      version: 2,
      config: { state: "active", steps: [{ template_id: kept }] },
    });
  });
  it("redacts copied future identity while writes pause, invalidates stale versions and preserves occurrence history", async () => {
    const created = await create(),
      target = created.proof.roots[0];
    const before = await prisma!.chore.findUniqueOrThrow({
      where: { id: target },
    });
    await prisma!
      .$executeRaw`UPDATE "Chore" SET "routine_series_config" = jsonb_set("routine_series_config", '{content,subject}', ${JSON.stringify({ kind: "account", user_id: teen, member_id: null })}::jsonb) WHERE "id" = ${target} AND "family_id" = ${familyId}`;
    process.env[ROUTINE_SCHEDULE_WRITE_ENV] = "0";
    try {
      await prisma!.$transaction(async (tx) => {
        await routineScheduleAuthority(tx, actor);
        expect(
          await rewriteRoutineSubjectsInTx(tx, familyId, {
            kind: "erase",
            userId: teen,
            memberIds: [],
          }),
        ).toContain(target);
      });
    } finally {
      process.env[ROUTINE_SCHEDULE_WRITE_ENV] = "1";
    }
    expect(
      await prisma!.chore.findUnique({ where: { id: target } }),
    ).toMatchObject({
      assigned_to: before.assigned_to,
      title: before.title,
      due_date: before.due_date,
      status: before.status,
      points: before.points,
    });
    const state = await readRoutineSchedule(
      prisma!,
      actor,
      created.proof.stackId,
    );
    expect(state.body).toMatchObject({
      version: 2,
      steps: expect.arrayContaining([
        expect.objectContaining({ template_id: target, subject: null }),
      ]),
    });
    expect(JSON.stringify(state.body)).not.toContain(teen);
    const {
      label: _label,
      anchor: _anchor,
      schedule: _schedule,
      steps: _steps,
      ...base
    } = created.body as Extract<RoutineScheduleCommand, { action: "create" }>;
    const stale = routineScheduleCommand.parse({
      ...base,
      action: "pause",
      stack_id: created.proof.stackId,
      expected_version: 1,
      scope: "future-after-today",
    });
    expect(
      (
        await saveRoutineSchedule(
          prisma!,
          actor,
          stale,
          crypto.randomUUID(),
          now,
        )
      ).status,
    ).toBe(409);
    expect(
      (
        await saveRoutineSchedule(
          prisma!,
          actor,
          { ...stale, expected_version: 2 },
          crypto.randomUUID(),
          now,
        )
      ).status,
    ).toBe(200);
    expect(
      (
        await saveRoutineSchedule(
          prisma!,
          actor,
          { ...stale, action: "resume", expected_version: 3 },
          crypto.randomUUID(),
          now,
        )
      ).status,
    ).toBe(409);
  });
  it("deletes personal roots while preserving reassigned future plans, surviving occurrence IDs and stack order", async () => {
    const leaving = `fx_schedule_leaving_${crypto.randomUUID()}`;
    await prisma!.user.create({
      data: {
        id: leaving,
        family_id: familyId,
        email: `${leaving}@example.invalid`,
        name: "Departing fixture",
        role: "child",
      },
    });
    const initial = command() as Extract<
      RoutineScheduleCommand,
      { action: "create" }
    >;
    const input = routineScheduleCommand.parse({
      ...initial,
      steps: [
        {
          ...initial.steps[0],
          subject: { kind: "account", user_id: leaving, member_id: null },
        },
        initial.steps[1],
      ],
    });
    const originalKey = crypto.randomUUID();
    const created = routineScheduleReceipt.parse(
      (await saveRoutineSchedule(prisma!, actor, input, originalKey, now)).body,
    );
    const oldRoot = created.roots[0],
      keptRoot = created.roots[1];
    const edited = routineScheduleCommand.parse({
      ...initial,
      action: "replace-future",
      stack_id: created.stackId,
      expected_version: 1,
      steps: initial.steps.map((step, index) => ({
        ...step,
        template_id: created.roots[index],
      })),
      removed_steps: [],
    });
    expect(
      (
        await saveRoutineSchedule(
          prisma!,
          actor,
          edited,
          crypto.randomUUID(),
          now,
        )
      ).status,
    ).toBe(200);
    const evidenceId = crypto.randomUUID();
    await prisma!.chore.create({
      data: {
        id: evidenceId,
        family_id: familyId,
        created_by: parent,
        assigned_to: parent,
        title: "Surviving evidence",
        recurrence_id: oldRoot,
        routine_stack_id: created.stackId,
        due_date: new Date("2026-10-22T00:00:00Z"),
        status: "in_progress",
        photo_url: "fixture-surviving-proof.jpg",
      },
    });
    const prior = await prisma!.chore.findMany({
      where: {
        family_id: familyId,
        recurrence_id: oldRoot,
        assigned_to: parent,
      },
      orderBy: { id: "asc" },
    });
    expect(prior.length).toBeGreaterThan(0);
    const deleted = await deleteMemberAccount(leaving, {
      db: prisma!,
      uploadDir: "/tmp/fp-routine-deletion-fixture",
      removeFile: async () => {},
      revokeCalendarGrant: async () => {},
      now: () => now,
    });
    expect(deleted.deleted).toBe(true);
    expect(
      await prisma!.user.findUnique({ where: { id: leaving } }),
    ).toBeNull();
    expect(
      await prisma!.chore.findUnique({ where: { id: oldRoot } }),
    ).toBeNull();
    const raw = await prisma!.$queryRaw<
      { schedule_config: { steps: { template_id: string }[] } }[]
    >`SELECT "schedule_config" FROM "RoutineStack" WHERE "id" = ${created.stackId} AND "family_id" = ${familyId}`;
    const replacement = raw[0].schedule_config.steps[0].template_id;
    expect(replacement).not.toBe(oldRoot);
    expect(
      raw[0].schedule_config.steps.map((step) => step.template_id),
    ).toEqual([replacement, keptRoot]);
    const control = await prisma!.chore.findUniqueOrThrow({
      where: { id: replacement },
    });
    expect(control).toMatchObject({
      assigned_to: null,
      assigned_member_id: null,
      member_subject_erased: true,
      points: 0,
      photo_url: null,
      completed_at: null,
      recurrence_id: replacement,
    });
    for (const before of prior) {
      const after = await prisma!.chore.findUniqueOrThrow({
        where: { id: before.id },
      });
      expect(after).toEqual({ ...before, recurrence_id: replacement });
      expect(control.due_date.getTime()).toBeLessThan(
        before.due_date.getTime(),
      );
    }
    expect(await hiddenRoutineOccurrenceIds(prisma!, familyId)).toContain(
      replacement,
    );
    expect(
      (await readRoutineSchedule(prisma!, actor, created.stackId)).status,
    ).toBe(200);
    expect(
      (
        await saveRoutineSchedule(
          prisma!,
          actor,
          input,
          originalKey,
          new Date(now.getTime() + 86400000),
          false,
        )
      ).body,
    ).toMatchObject({ error: { code: "ROUTINE_ORIGINAL_REMOVED" } });
    expect(
      await prisma!.chore.findUnique({ where: { id: oldRoot } }),
    ).toBeNull();
    const late = await saveRoutineSchedule(
      prisma!,
      actor,
      edited,
      crypto.randomUUID(),
      now,
    );
    expect(late.status).toBe(409);
    await prisma!.$transaction((tx) =>
      expandSeriesInTx(tx, replacement, familyId, now),
    );
    expect(
      await prisma!.chore.findFirst({
        where: {
          family_id: familyId,
          recurrence_id: replacement,
          assigned_to: parent,
          due_date: new Date("2026-10-21T00:00:00Z"),
        },
      }),
    ).not.toBeNull();
  });
  it("recovers only a handover-pending once slot after write pause and does not resurrect a later deliberate deletion", async () => {
    const leaving = `fx_schedule_once_leaving_${crypto.randomUUID()}`;
    await prisma!.user.create({
      data: {
        id: leaving,
        family_id: familyId,
        email: `${leaving}@example.invalid`,
        name: "Once departing fixture",
        role: "child",
      },
    });
    const initial = command() as Extract<
      RoutineScheduleCommand,
      { action: "create" }
    >;
    const input = routineScheduleCommand.parse({
      ...initial,
      schedule: {
        frequency: "once",
        starts_on: "2026-10-21",
        weekly_days: [],
        monthly_day: null,
      },
      steps: [
        {
          ...initial.steps[0],
          subject: { kind: "account", user_id: leaving, member_id: null },
        },
        initial.steps[1],
      ],
    });
    const created = await create(input);
    const oldRoot = created.proof.roots[0];
    const replacement = routineScheduleCommand.parse({
      ...input,
      action: "replace-future",
      stack_id: created.proof.stackId,
      expected_version: 1,
      steps: initial.steps.map((step, index) => ({
        ...step,
        template_id: created.proof.roots[index],
      })),
      removed_steps: [],
    });
    expect(
      (
        await saveRoutineSchedule(
          prisma!,
          actor,
          replacement,
          crypto.randomUUID(),
          now,
        )
      ).status,
    ).toBe(200);
    process.env[ROUTINE_SCHEDULE_WRITE_ENV] = "0";
    let controlId: string;
    try {
      expect(
        (
          await deleteMemberAccount(leaving, {
            db: prisma!,
            uploadDir: "/tmp/fp-routine-once-deletion-fixture",
            removeFile: async () => {},
            revokeCalendarGrant: async () => {},
            now: () => now,
          })
        ).deleted,
      ).toBe(true);
      const rows = await prisma!.$queryRaw<
        { schedule_config: { steps: { template_id: string }[] } }[]
      >`SELECT "schedule_config" FROM "RoutineStack" WHERE "id" = ${created.proof.stackId} AND "family_id" = ${familyId}`;
      controlId = rows[0].schedule_config.steps[0].template_id;
      expect(controlId).not.toBe(oldRoot);
      const pending = await prisma!.$queryRaw<
        { routine_series_config: { once_pending: boolean } }[]
      >`SELECT "routine_series_config" FROM "Chore" WHERE "id" = ${controlId} AND "family_id" = ${familyId}`;
      expect(pending[0].routine_series_config.once_pending).toBe(true);
      await topUpHouseholdSeries(familyId, now);
      expect(
        await prisma!.chore.count({
          where: {
            family_id: familyId,
            recurrence_id: controlId,
            id: { not: controlId },
          },
        }),
      ).toBe(0);
    } finally {
      process.env[ROUTINE_SCHEDULE_WRITE_ENV] = "1";
    }
    await topUpHouseholdSeries(familyId, now);
    const copy = await prisma!.chore.findFirstOrThrow({
      where: {
        family_id: familyId,
        recurrence_id: controlId!,
        id: { not: controlId! },
      },
    });
    expect(copy).toMatchObject({
      assigned_to: parent,
      due_date: new Date("2026-10-21T00:00:00Z"),
    });
    const settled = await prisma!.$queryRaw<
      { routine_series_config: { once_pending: boolean } }[]
    >`SELECT "routine_series_config" FROM "Chore" WHERE "id" = ${controlId!} AND "family_id" = ${familyId}`;
    expect(settled[0].routine_series_config.once_pending).toBe(false);
    await topUpHouseholdSeries(familyId, now);
    expect(
      await prisma!.chore.count({
        where: {
          family_id: familyId,
          recurrence_id: controlId!,
          id: { not: controlId! },
        },
      }),
    ).toBe(1);
    await prisma!.chore.delete({ where: { id: copy.id } });
    await topUpHouseholdSeries(familyId, now);
    expect(
      await prisma!.chore.count({
        where: {
          family_id: familyId,
          recurrence_id: controlId!,
          id: { not: controlId! },
        },
      }),
    ).toBe(0);
  });
  it("pause preserves root snapshots and all evidence/today rows, pruning only untouched future copies without reordering steps", async () => {
    const { proof } = await create(),
      root = await prisma!.chore.findUniqueOrThrow({
        where: { id: proof.roots[0] },
      });
    const copies = [
      { id: crypto.randomUUID(), date: "2026-10-20", photo: null },
      {
        id: crypto.randomUUID(),
        date: "2026-10-22",
        photo: "fixture-evidence.jpg",
      },
      { id: crypto.randomUUID(), date: "2026-10-23", photo: null },
    ];
    for (const row of copies)
      await prisma!.chore.create({
        data: {
          id: row.id,
          family_id: familyId,
          title: root.title,
          created_by: parent,
          assigned_to: parent,
          recurrence_id: root.id,
          routine_stack_id: proof.stackId,
          due_date: new Date(`${row.date}T00:00:00.000Z`),
          photo_url: row.photo,
          status: "pending",
        },
      });
    const untouchedCount = await prisma!.chore.count({
      where: {
        family_id: familyId,
        routine_stack_id: proof.stackId,
        id: { notIn: proof.roots },
        is_template: false,
        status: "pending",
        due_date: { gt: new Date("2026-10-20T00:00:00.000Z") },
        photo_url: null,
      },
    });
    const {
      label: _label,
      anchor: _anchor,
      schedule: _schedule,
      steps: _steps,
      ...base
    } = command() as Extract<RoutineScheduleCommand, { action: "create" }>;
    const body = routineScheduleCommand.parse({
      ...base,
      action: "pause",
      stack_id: proof.stackId,
      expected_version: proof.version,
      scope: "future-after-today",
    });
    const record = await reserve(body),
      result = await persistRoutineSchedule(
        prisma!,
        actor,
        body,
        record.id,
        now,
      );
    expect(result.status).toBe(200);
    expect(routineScheduleReceipt.parse(result.body)).toMatchObject({
      state: "paused",
      roots: proof.roots,
      prunedCount: untouchedCount,
    });
    expect(await hiddenRoutineOccurrenceIds(prisma!, familyId)).toEqual(
      expect.arrayContaining(proof.roots),
    );
    const pausedRoot = await findHouseholdChore(prisma!, root.id, familyId);
    await expect(
      completeChore(
        prisma!,
        pausedRoot!,
        { id: parent, name: "Fixture Parent" },
        { now },
      ),
    ).rejects.toBeInstanceOf(RoutineOccurrenceUnavailableError);
    expect(
      await prisma!.chore.findUnique({ where: { id: copies[2].id } }),
    ).toBeNull();
    expect(
      await prisma!.chore.count({
        where: { id: { in: [copies[0].id, copies[1].id] } },
      }),
    ).toBe(2);
    const after = await prisma!.chore.findUniqueOrThrow({
      where: { id: root.id },
    });
    expect({
      title: after.title,
      assigned_to: after.assigned_to,
      due_date: after.due_date,
      points: after.points,
    }).toEqual({
      title: root.title,
      assigned_to: root.assigned_to,
      due_date: root.due_date,
      points: root.points,
    });
    const later = new Date("2026-10-23T18:00:00.000Z");
    const resume = routineScheduleCommand.parse({
      ...base,
      action: "resume",
      stack_id: proof.stackId,
      expected_version: routineScheduleReceipt.parse(result.body).version,
      issued_at: later.toISOString(),
      view_day: "2026-10-23",
      scope: "future-after-today",
    });
    const resumed = await persistRoutineSchedule(
      prisma!,
      actor,
      resume,
      (await reserve(resume)).id,
      later,
    );
    expect(resumed.status).toBe(200);
    // The immutable root's paused date passed; resume must not resurrect it as
    // overdue. Real future copies continue from the next selected weekday.
    expect(await hiddenRoutineOccurrenceIds(prisma!, familyId)).toEqual(
      expect.arrayContaining(proof.roots),
    );
    const future = await prisma!.chore.findMany({
      where: {
        family_id: familyId,
        recurrence_id: root.id,
        id: { not: root.id },
        due_date: { gte: new Date("2026-10-24T00:00:00.000Z") },
      },
      orderBy: { due_date: "asc" },
    });
    expect(future[0].due_date.toISOString().slice(0, 10)).toBe("2026-10-26");
  });
  it("replaces only future definitions and preserves canonical order through pause/resume/stop", async () => {
    const created = await create();
    if (created.body.action !== "create")
      throw new Error("fixture command mismatch");
    const original = await prisma!.chore.findUniqueOrThrow({
      where: { id: created.proof.roots[0] },
    });
    await prisma!.chore.update({
      where: { id: original.id },
      data: { status: "completed", completed_at: now },
    });
    const replace = routineScheduleCommand.parse({
      ...created.body,
      action: "replace-future",
      stack_id: created.proof.stackId,
      expected_version: created.proof.version,
      removed_steps: [],
      steps: created.body.steps
        .map((step, index) => ({
          ...step,
          template_id: created.proof.roots[index],
          title: `Updated ${index}`,
        }))
        .reverse(),
    });
    const saved = await persistRoutineSchedule(
      prisma!,
      actor,
      replace,
      (await reserve(replace)).id,
      now,
    );
    expect(saved.status).toBe(200);
    let proof = routineScheduleReceipt.parse(saved.body);
    expect(proof.roots).toEqual([...created.proof.roots].reverse());
    const after = await prisma!.chore.findUniqueOrThrow({
      where: { id: original.id },
    });
    expect({
      title: after.title,
      due: after.due_date,
      owner: after.assigned_to,
      status: after.status,
    }).toEqual({
      title: original.title,
      due: original.due_date,
      owner: original.assigned_to,
      status: "completed",
    });
    const definitions = await prisma!.$queryRaw<
      { routine_series_config: { content: { title: string } } }[]
    >`SELECT "routine_series_config" FROM "Chore" WHERE "id" = ${original.id}`;
    expect(definitions[0].routine_series_config.content.title).toBe(
      "Updated 0",
    );
    const {
      label: _label,
      anchor: _anchor,
      schedule: _schedule,
      steps: _steps,
      ...scope
    } = created.body;
    for (const action of ["pause", "resume", "stop"] as const) {
      const control = routineScheduleCommand.parse({
        ...scope,
        action,
        stack_id: proof.stackId,
        expected_version: proof.version,
        scope: "future-after-today",
      });
      const result = await persistRoutineSchedule(
        prisma!,
        actor,
        control,
        (await reserve(control)).id,
        now,
      );
      expect(result.status).toBe(200);
      proof = routineScheduleReceipt.parse(result.body);
      expect(proof.roots).toEqual([...created.proof.roots].reverse());
    }
    expect(proof.state).toBe("stopped");
    const resume = routineScheduleCommand.parse({
      ...scope,
      action: "resume",
      stack_id: proof.stackId,
      expected_version: proof.version,
      scope: "future-after-today",
    });
    expect(
      (
        await persistRoutineSchedule(
          prisma!,
          actor,
          resume,
          (await reserve(resume)).id,
          now,
        )
      ).body,
    ).toEqual({ error: { code: "ROUTINE_STOPPED" } });
  });

  it("refuses stale versions, changed actors/households and expired local-day intents before changing definitions", async () => {
    const { proof } = await create();
    const {
      label: _label,
      anchor: _anchor,
      schedule: _schedule,
      steps: _steps,
      ...base
    } = command() as Extract<RoutineScheduleCommand, { action: "create" }>;
    const body = routineScheduleCommand.parse({
      ...base,
      action: "pause",
      stack_id: proof.stackId,
      expected_version: proof.version + 1,
      scope: "future-after-today",
    });
    const record = await reserve(body);
    expect(
      await persistRoutineSchedule(prisma!, actor, body, record.id, now),
    ).toMatchObject({
      status: 409,
      body: { error: { code: "ROUTINE_VERSION_CONFLICT" } },
    });
    expect(
      (
        await readRoutineSchedule(
          prisma!,
          { userId: teen, familyId, tokenVersion: 0 },
          proof.stackId,
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await readRoutineSchedule(
          prisma!,
          { userId: foreignParent, familyId: otherFamily, tokenVersion: 0 },
          proof.stackId,
        )
      ).status,
    ).toBe(404);
    expect(
      (
        await persistRoutineSchedule(
          prisma!,
          { ...actor, tokenVersion: 1 },
          body,
          record.id,
          now,
        )
      ).status,
    ).toBe(401);
    expect(
      (
        await persistRoutineSchedule(
          prisma!,
          actor,
          body,
          record.id,
          new Date("2026-10-21T16:00:00.000Z"),
        )
      ).body,
    ).toEqual({ error: { code: "ROUTINE_INTENT_EXPIRED" } });
  });
});
