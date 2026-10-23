/** Authored/unrun. Mocked scoped rows do not prove PostgreSQL isolation. */
import {
  preparationCopyFactId,
  recordPreparationRoutineCopyInTx,
  readPreparationRoutineOrigins,
} from "../origin";
import {
  preparationRoutineOrigin,
  preparationOriginHref,
} from "../origin-contract";
import { eventPreparationReady } from "../owner";
import { eventPreparationStorageAvailable } from "../storage";
import { defaultFeatures } from "@/lib/features";
jest.mock("../owner", () => ({ eventPreparationReady: jest.fn(() => true) }));
jest.mock("../storage", () => ({
  eventPreparationStorageAvailable: jest.fn(async () => true),
}));
const now = new Date("2026-10-22T12:00:00Z");
const input = {
  userId: "parent-a",
  familyId: "family-a",
  role: "parent",
  tokenVersion: 7,
  choreIds: ["copy-a"],
};
const origin = {
  stackId: "stack-a",
  sourceChoreId: "source-a",
  occurrenceDay: "2026-10-20",
};
const fact = {
  timeline: 1,
  actorKind: "person",
  target: { kind: "chore", id: "copy-a" },
  routineCopy: origin,
};
const features = defaultFeatures();
function fixture(
  metadata: unknown = fact,
  source: unknown[] = [
    {
      chore_id: "copy-a",
      stack_id: "stack-a",
      source_id: "source-a",
      label: "Current routine",
    },
  ],
  renewed: unknown[] = [{ features }],
) {
  return {
    $queryRaw: jest
      .fn()
      .mockResolvedValueOnce([
        {
          chore_id: "copy-a",
          metadata: JSON.stringify(metadata),
          copied_at: now,
          features,
        },
      ])
      .mockResolvedValueOnce(source)
      .mockResolvedValueOnce(renewed),
  };
}
beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(eventPreparationReady).mockReturnValue(true);
  jest.mocked(eventPreparationStorageAvailable).mockResolvedValue(true);
});
it("binds each fact to the exact household and created chore without a content snapshot", async () => {
  expect(preparationCopyFactId("family-a", "copy-a")).toBe(
    preparationCopyFactId("family-a", "copy-a"),
  );
  expect(preparationCopyFactId("family-a", "copy-a")).not.toBe(
    preparationCopyFactId("family-b", "copy-a"),
  );
  expect(preparationCopyFactId("family-a", "copy-a")).not.toBe(
    preparationCopyFactId("family-a", "copy-b"),
  );
  const tx = {
    activity: { create: jest.fn().mockResolvedValue({ id: "fact-a" }) },
  };
  await recordPreparationRoutineCopyInTx(
    tx as never,
    input,
    "copy-a",
    origin,
    now,
  );
  expect(tx.activity.create).toHaveBeenCalledWith({
    data: {
      id: preparationCopyFactId("family-a", "copy-a"),
      family_id: "family-a",
      user_id: "parent-a",
      type: "preparation_routine_copied",
      title: "Routine step copied for preparation",
      metadata: JSON.stringify(fact),
      created_at: now,
    },
    select: { id: true },
  });
});
it.each(["child", "teen", "device"])(
  "never probes personal provenance for %s",
  async (role) => {
    const db = fixture();
    expect(await readPreparationRoutineOrigins(db, { ...input, role })).toEqual(
      {},
    );
    expect(db.$queryRaw).not.toHaveBeenCalled();
    expect(eventPreparationStorageAvailable).not.toHaveBeenCalled();
  },
);
it("omits context while paused or storage is absent", async () => {
  const db = fixture();
  jest.mocked(eventPreparationReady).mockReturnValue(false);
  expect(await readPreparationRoutineOrigins(db, input)).toEqual({});
  jest.mocked(eventPreparationReady).mockReturnValue(true);
  jest.mocked(eventPreparationStorageAvailable).mockResolvedValue(false);
  expect(await readPreparationRoutineOrigins(db, input)).toEqual({});
  expect(db.$queryRaw).not.toHaveBeenCalled();
});
it("links the exact original occurrence using only the current authorized source label", async () => {
  const db = fixture();
  const result = await readPreparationRoutineOrigins(db, input);
  expect(result).toEqual({
    "copy-a": {
      state: "available",
      ...origin,
      label: "Current routine",
      copiedAt: now.toISOString(),
    },
  });
  const parsed = preparationRoutineOrigin.parse(result["copy-a"]);
  if (parsed.state !== "available") throw new Error("Expected source");
  expect(preparationOriginHref(parsed)).toBe(
    "/dashboard/chores/routines?stack_id=stack-a&occurrence_date=2026-10-20",
  );
  const [sql, ...values] = db.$queryRaw.mock.calls[1];
  expect(sql.join("")).toContain('s."family_id"=c."family_id"');
  expect(sql.join("")).toContain('s."member_subject_erased"=false');
  expect(sql.join("")).toContain('s."routine_stack_id"=r."id"');
  expect(values).toContain(input.familyId);
  expect(values).toContain(input.tokenVersion);
});
it.each([
  { source: [] },
  {
    source: [
      {
        chore_id: "copy-a",
        stack_id: "foreign-stack",
        source_id: "source-a",
        label: "Do not disclose",
      },
    ],
  },
])(
  "withholds source IDs and labels when the exact source is unavailable",
  async ({ source }) => {
    const result = await readPreparationRoutineOrigins(
      fixture(fact, source),
      input,
    );
    expect(result).toEqual({
      "copy-a": { state: "unavailable", copiedAt: now.toISOString() },
    });
    expect(JSON.stringify(result)).not.toMatch(
      /stack-a|source-a|Do not disclose/,
    );
  },
);
it.each([
  { ...fact, target: { kind: "chore", id: "other-copy" } },
  { ...fact, routineCopy: { ...origin, sourceChoreId: "copy-a" } },
  { ...fact, routineCopy: { ...origin, occurrenceDay: "2026-02-31" } },
  { ...fact, prompt: "not a copy fact" },
])(
  "never guesses origin from malformed or wrong-target metadata",
  async (metadata) => {
    const db = fixture(metadata);
    expect(await readPreparationRoutineOrigins(db, input)).toEqual({});
    expect(db.$queryRaw).toHaveBeenCalledTimes(1);
  },
);
it.each([
  { renewed: [] },
  { renewed: [{ features: { ...features, calendar: false } }] },
])(
  "withholds earlier rows when final membership or domain renewal fails",
  async ({ renewed }) => {
    expect(
      await readPreparationRoutineOrigins(fixture(fact, [], renewed), input),
    ).toEqual({});
  },
);
it("rejects unavailable DTOs carrying historical source content or references", () => {
  expect(
    preparationRoutineOrigin.safeParse({
      state: "unavailable",
      copiedAt: now.toISOString(),
      ...origin,
      label: "Old private name",
    }).success,
  ).toBe(false);
});
