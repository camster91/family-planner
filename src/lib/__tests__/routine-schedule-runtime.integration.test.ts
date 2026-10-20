/** Authored only. Never run outside an explicitly guarded disposable database. */
import crypto from "node:crypto";
import { prisma } from "@/lib/prisma";
import { assertFixtureTargetAllowed } from "@/lib/fixtures/guard";
import { hashIdempotentRequest, IDEMPOTENCY_TTL_MS } from "@/lib/idempotency";
import {
  persistRoutineSchedule,
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
        expires_at: new Date(now.getTime() + IDEMPOTENCY_TTL_MS),
      },
    });
  }
  async function create() {
    const body = command(),
      record = await reserve(body),
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
      prunedCount: 1,
    });
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
