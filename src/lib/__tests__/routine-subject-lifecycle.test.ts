/** Authored source only; identity/rollback acceptance remains deferred. */
import type { Prisma } from "@prisma/client";
import {
  routineStepSeriesConfig,
  routineScheduleCommand,
} from "../routine-schedule";
import {
  rewriteRoutineFutureSubject,
  rewriteRoutineSubjectsInTx,
} from "../routine-subject-lifecycle";
const definition = routineStepSeriesConfig.parse({
  protocol: "herewoven.routine-step-series.v1",
  revision: 4,
  stack_id: "stack-a",
  state: "active",
  effective_on: "2026-10-21",
  anchor: "After lunch",
  schedule: {
    frequency: "weekly",
    starts_on: "2026-10-21",
    weekly_days: [1, 3],
    monthly_day: null,
  },
  content: {
    title: "Fixture step",
    description: null,
    subject: { kind: "profile", member_id: "profile-a" },
    points: 7,
    difficulty: "easy",
    icon: null,
    duration_minutes: 5,
  },
});
it("links only an exact known same-person profile/account alias and invalidates its revision", () => {
  const linked = rewriteRoutineFutureSubject(definition, {
    kind: "link",
    userId: "account-a",
    memberId: "profile-a",
  });
  expect(linked).toEqual({
    stackId: "stack-a",
    value: {
      ...definition,
      revision: 5,
      content: {
        ...definition.content,
        subject: {
          kind: "account",
          user_id: "account-a",
          member_id: "profile-a",
        },
      },
    },
  });
  expect(
    rewriteRoutineFutureSubject(definition, {
      kind: "link",
      userId: "other",
      memberId: "other-profile",
    }),
  ).toBeNull();
  expect(
    rewriteRoutineFutureSubject(
      {
        ...definition,
        content: {
          ...definition.content,
          subject: {
            kind: "account",
            user_id: "account-a",
            member_id: "different-person",
          },
        },
      },
      { kind: "link", userId: "account-a", memberId: "profile-a" },
    ),
  ).toBeNull();
});
it("erases the exact private identity without changing content, schedule, state or history", () => {
  const erased = rewriteRoutineFutureSubject(definition, {
    kind: "erase",
    userId: "account-a",
    memberIds: ["profile-a"],
  });
  expect(erased).toEqual({
    stackId: "stack-a",
    value: {
      ...definition,
      revision: 5,
      content: { ...definition.content, subject: { kind: "erased" } },
    },
  });
  expect(JSON.stringify(erased)).not.toContain("profile-a");
  expect(
    rewriteRoutineFutureSubject(erased!.value, {
      kind: "erase",
      userId: "account-a",
      memberIds: ["profile-a"],
    }),
  ).toBeNull();
  expect(
    rewriteRoutineFutureSubject(definition, {
      kind: "erase",
      userId: "other",
      memberIds: ["other-profile"],
    }),
  ).toBeNull();
});
it("redacts known subject slots in unknown protocols without adopting or linking them", () => {
  const unknown = {
    ...definition,
    protocol: "future.unsupported",
    revision: 9,
  };
  expect(
    rewriteRoutineFutureSubject(unknown, {
      kind: "link",
      userId: "account-a",
      memberId: "profile-a",
    }),
  ).toBeNull();
  const erased = rewriteRoutineFutureSubject(unknown, {
    kind: "erase",
    userId: "account-a",
    memberIds: ["profile-a"],
  });
  expect(erased).toMatchObject({
    value: {
      protocol: "future.unsupported",
      revision: 10,
      content: { subject: { kind: "erased" } },
    },
  });
  expect(routineStepSeriesConfig.safeParse(erased!.value).success).toBe(false);
});
it("keeps erased subjects stored-only and cannot accept them as a new command target", () => {
  expect(
    routineScheduleCommand.safeParse({
      protocol: "herewoven.routine-schedule.v1",
      expected_user_id: "parent",
      expected_family_id: "family",
      issued_at: "2026-10-20T16:00:00Z",
      view_day: "2026-10-20",
      view_zone: "America/Toronto",
      action: "create",
      label: "Routine",
      anchor: null,
      schedule: definition.schedule,
      steps: [
        {
          ...definition.content,
          client_step_id: "step-a",
          template_id: null,
          subject: { kind: "erased" },
        },
      ],
    }).success,
  ).toBe(false);
});
it("is inert without migrated root storage and scopes writes by household/root identity", async () => {
  const raw = jest.fn().mockResolvedValueOnce([{ present: false }]),
    write = jest.fn();
  const tx = {
    $queryRaw: raw,
    $executeRaw: write,
  } as unknown as Prisma.TransactionClient;
  expect(
    await rewriteRoutineSubjectsInTx(tx, "family-a", {
      kind: "erase",
      userId: "account-a",
      memberIds: ["profile-a"],
    }),
  ).toEqual([]);
  expect(write).not.toHaveBeenCalled();
  raw
    .mockResolvedValueOnce([{ present: true }])
    .mockResolvedValueOnce([
      { id: "root-a", routine_series_config: definition },
    ])
    .mockResolvedValueOnce([{ present: false }]);
  write.mockResolvedValue(1);
  expect(
    await rewriteRoutineSubjectsInTx(tx, "family-a", {
      kind: "erase",
      userId: "account-a",
      memberIds: ["profile-a"],
    }),
  ).toEqual(["root-a"]);
  expect(raw.mock.calls[2].slice(1)).toEqual([
    "family-a",
    "account-a",
    ["profile-a"],
  ]);
  expect(write.mock.calls[0].slice(1)).toEqual([
    expect.any(String),
    "root-a",
    "family-a",
  ]);
  expect((write.mock.calls[0][0] as TemplateStringsArray).join("?")).toContain(
    '"recurrence_id" = "id"',
  );
});
