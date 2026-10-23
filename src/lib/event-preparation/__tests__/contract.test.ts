/** Authored source cases only. No domain, DB or UI checks have been executed. */
import {
  planEventPreparation,
  preparationDueDay,
  preparationProgress,
  EVENT_PREPARATION_PROTOCOL,
  type PreparationContext,
  type PreparationCommand,
} from "../contract";
const now = new Date("2026-10-20T12:00:00Z"),
  token = "a".repeat(64),
  view = "b".repeat(64),
  taskToken = "c".repeat(64),
  routineToken = "d".repeat(64);
const account = { kind: "account" as const, accountId: "parent-a" },
  profile = { kind: "profile" as const, memberId: "profile-a" };
function fixture() {
  const context: PreparationContext = {
    actor: {
      kind: "person",
      userId: "parent-a",
      familyId: "family-a",
      role: "parent",
      memberProtocol: 2,
    },
    event: {
      id: "event-a",
      familyId: "family-a",
      sourceToken: token,
      start: "2026-10-21T14:00:00Z",
      end: "2026-10-21T15:00:00Z",
      active: true,
    },
    timeZone: "America/Toronto",
    viewToken: view,
    writesEnabled: true,
    pointsEnabled: false,
    profileWritesEnabled: true,
    complete: true,
    current: {
      reviewedEventSourceToken: token,
      links: [{ choreId: "chore-a", cue: null }],
    },
    eligibleSubjects: [account, profile],
    tasks: [
      {
        id: "chore-a",
        sourceToken: taskToken,
        dueDay: "2026-10-20",
        subject: account,
        status: "pending",
        attachedEventId: "event-a",
        linkable: true,
        dateEditable: true,
      },
    ],
    routine: {
      id: "routine-a",
      sourceToken: routineToken,
      occurrenceDay: "2026-10-20",
      complete: true,
      steps: [
        {
          id: "source-step",
          sourceToken: taskToken,
          copyable: true,
          content: {
            title: "Pack bag",
            description: "Packing instructions",
            subject: account,
            points: 20,
            difficulty: "easy",
            icon: null,
            durationMinutes: 5,
          },
        },
      ],
    },
  };
  const command: Extract<PreparationCommand, { action: "set-plan" }> = {
    protocol: EVENT_PREPARATION_PROTOCOL,
    owner: { userId: "parent-a", familyId: "family-a" },
    memberProtocol: 2,
    eventId: "event-a",
    eventSourceToken: token,
    expectedToken: view,
    timeZone: "America/Toronto",
    issuedAt: now.toISOString(),
    eventChangeDecision: null,
    action: "set-plan",
    steps: [
      {
        kind: "existing",
        choreId: "chore-a",
        sourceToken: taskToken,
        cue: null,
        retimeTo: null,
      },
    ],
  };
  return { context, command };
}
it("detaches links without deleting/reassigning/finishing canonical work and never mutates the supplied context", () => {
  const { context, command } = fixture(),
    original = JSON.stringify(context);
  command.steps = [];
  const effect = planEventPreparation(command, context, now);
  expect(effect).toMatchObject({
    detach: ["chore-a"],
    create: [],
    retime: [],
    ordered: [],
    changed: true,
  });
  expect(JSON.stringify(context)).toBe(original);
  expect(effect).not.toHaveProperty("deleteChores");
});
it("copies selected exact routine content into new once-only work with explicit subject and no historical credit/status", () => {
  const { context, command } = fixture();
  const reuse: PreparationCommand = {
    ...command,
    action: "reuse-routine",
    stackId: "routine-a",
    sourceToken: routineToken,
    occurrenceDay: "2026-10-20",
    steps: [
      {
        sourceId: "source-step",
        sourceToken: taskToken,
        clientId: "new-step",
        subject: profile,
        points: null,
        dueDay: "2026-10-21",
        cue: { anchor: "start", direction: "before", minutes: 60 },
      },
    ],
  };
  const effect = planEventPreparation(reuse, context, now);
  expect(effect.create[0]).toMatchObject({
    clientId: "new-step",
    title: "Pack bag",
    subject: profile,
    points: 0,
    dueDay: "2026-10-21",
    origin: {
      stackId: "routine-a",
      sourceChoreId: "source-step",
      occurrenceDay: "2026-10-20",
    },
  });
  expect(effect.create[0]).not.toHaveProperty("status");
  expect(effect.create[0]).not.toHaveProperty("photo_url");
  expect(effect.ordered).toHaveLength(2);
  expect(effect.detach).toEqual([]);
});
it("refuses device/child/foreign/stale/paused and non-explicit profile protocol contexts before producing effects", () => {
  for (const change of [
    (context: PreparationContext) => {
      context.actor = { kind: "device", familyId: "family-a" };
    },
    (context: PreparationContext) => {
      context.actor = {
        kind: "person",
        userId: "parent-a",
        familyId: "family-a",
        role: "child",
        memberProtocol: 2,
      };
    },
    (context: PreparationContext) => {
      context.event.familyId = "other-family";
    },
    (context: PreparationContext) => {
      context.viewToken = "e".repeat(64);
    },
    (context: PreparationContext) => {
      context.writesEnabled = false;
    },
  ]) {
    const { context, command } = fixture();
    change(context);
    expect(() => planEventPreparation(command, context, now)).toThrow();
  }
  const { context, command } = fixture();
  command.steps = [
    {
      kind: "new",
      clientId: "new-a",
      title: "Pack",
      description: null,
      subject: profile,
      points: null,
      difficulty: "easy",
      icon: null,
      durationMinutes: null,
      dueDay: "2026-10-21",
      cue: null,
    },
  ];
  context.profileWritesEnabled = false;
  expect(() => planEventPreparation(command, context, now)).toThrow();
});
it("holds explicit date changes for completed/scheduled tasks and existing work attached to another event", () => {
  const { context, command } = fixture();
  command.steps[0] = {
    kind: "existing",
    choreId: "chore-a",
    sourceToken: taskToken,
    cue: null,
    retimeTo: "2026-10-21",
  };
  context.tasks[0].status = "completed";
  expect(() => planEventPreparation(command, context, now)).toThrow();
  context.tasks[0].status = "pending";
  context.tasks[0].dateEditable = false;
  expect(() => planEventPreparation(command, context, now)).toThrow();
  context.tasks[0].dateEditable = true;
  context.tasks[0].attachedEventId = "other-event";
  expect(() => planEventPreparation(command, context, now)).toThrow();
});
it("requires a changed-event decision and cue agreement; keeping days does not silently retime", () => {
  const { context, command } = fixture();
  context.current!.reviewedEventSourceToken = "e".repeat(64);
  expect(() => planEventPreparation(command, context, now)).toThrow();
  command.eventChangeDecision = "keep-dates";
  expect(planEventPreparation(command, context, now).retime).toEqual([]);
  command.steps[0] = {
    kind: "existing",
    choreId: "chore-a",
    sourceToken: taskToken,
    cue: { anchor: "start", direction: "before", minutes: 60 },
    retimeTo: null,
  };
  expect(() => planEventPreparation(command, context, now)).toThrow();
  command.eventChangeDecision = "retime-selected";
  command.steps[0] = {
    kind: "existing",
    choreId: "chore-a",
    sourceToken: taskToken,
    cue: { anchor: "start", direction: "before", minutes: 60 },
    retimeTo: "2026-10-21",
  };
  expect(planEventPreparation(command, context, now).retime).toEqual([
    {
      choreId: "chore-a",
      sourceToken: taskToken,
      from: "2026-10-20",
      to: "2026-10-21",
    },
  ]);
});
it("derives a canonical day from an actual instant/zone and keeps whole-event checked distinct from marked-done/unknown", () => {
  const { context } = fixture();
  context.event.start = "2026-11-01T06:30:00Z";
  expect(
    preparationDueDay(
      context.event,
      { anchor: "start", direction: "before", minutes: 120 },
      "America/Toronto",
    ),
  ).toBe("2026-11-01");
  const base = {
    unavailable: 0,
    restricted: false,
    capped: false,
    eventChanged: false,
  };
  expect(
    preparationProgress({ ...base, statuses: ["completed", "verified"] }).state,
  ).toBe("marked-done");
  expect(preparationProgress({ ...base, statuses: ["verified"] }).state).toBe(
    "checked",
  );
  expect(
    preparationProgress({ ...base, statuses: ["verified"], restricted: true })
      .state,
  ).toBe("unknown");
  expect(
    preparationProgress({ ...base, statuses: ["verified"], eventChanged: true })
      .state,
  ).toBe("needs-review");
  expect(preparationProgress({ ...base, statuses: [] }).state).toBe(
    "not-configured",
  );
});
