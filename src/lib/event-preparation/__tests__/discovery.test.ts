/** Authored/unrun discovery projection cases; SQL isolation still needs the
 * consolidated disposable PostgreSQL pass. These mocks are not DB evidence. */
import { readPreparationBacklinks } from "../discovery";
import { eventPreparationReady } from "../owner";
import { eventPreparationStorageAvailable } from "../storage";
import { defaultFeatures } from "@/lib/features";
jest.mock("../owner", () => ({ eventPreparationReady: jest.fn(() => true) }));
jest.mock("../storage", () => ({
  eventPreparationStorageAvailable: jest.fn(async () => true),
}));
const input = {
  userId: "parent-a",
  familyId: "family-a",
  role: "parent",
  choreIds: ["task-a"],
};
function fixture(rows: unknown[] = []) {
  return { $queryRaw: jest.fn().mockResolvedValue(rows) };
}
beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(eventPreparationReady).mockReturnValue(true);
  jest.mocked(eventPreparationStorageAvailable).mockResolvedValue(true);
});
it.each(["child", "teen", "device"])(
  "does not probe private metadata for %s",
  async (role) => {
    const db = fixture();
    expect(await readPreparationBacklinks(db, { ...input, role })).toEqual({});
    expect(db.$queryRaw).not.toHaveBeenCalled();
    expect(eventPreparationStorageAvailable).not.toHaveBeenCalled();
  },
);
it("does not query optional tables while paused or absent", async () => {
  const db = fixture();
  jest.mocked(eventPreparationReady).mockReturnValue(false);
  expect(await readPreparationBacklinks(db, input)).toEqual({});
  jest.mocked(eventPreparationReady).mockReturnValue(true);
  jest.mocked(eventPreparationStorageAvailable).mockResolvedValue(false);
  expect(await readPreparationBacklinks(db, input)).toEqual({});
  expect(db.$queryRaw).not.toHaveBeenCalled();
});
it("projects relationship IDs only and refuses rows outside the supplied canonical set", async () => {
  const db = fixture([
    {
      chore_id: "task-a",
      event_id: "event-a",
      features: defaultFeatures(),
      private: "never project",
    },
    {
      chore_id: "task-other",
      event_id: "event-other",
      features: defaultFeatures(),
    },
  ]);
  expect(await readPreparationBacklinks(db, input)).toEqual({
    "task-a": "event-a",
  });
  const [sql, ...values] = db.$queryRaw.mock.calls[0];
  expect(sql.join("")).toContain(`u."role"='parent'`);
  expect(values).toContain(input.familyId);
  expect(values).toContain(input.userId);
});
it("bounds and deduplicates the canonical ID window without claiming an exhaustive summary", async () => {
  const db = fixture();
  const choreIds = Array.from({ length: 400 }, (_, i) => `task-${i}`);
  await readPreparationBacklinks(db, {
    ...input,
    choreIds: [choreIds[0], ...choreIds],
  });
  const bound = db.$queryRaw.mock.calls[0]
    .slice(1)
    .find(
      (value: unknown) => typeof value === "string" && value.startsWith("["),
    );
  expect(JSON.parse(bound)).toHaveLength(300);
  expect(JSON.parse(bound)).not.toContain("task-300");
});

// Child/teen readers never inherit the parent's full relationship projection.
it("returns only own-task read context and no event IDs or edit/source tokens", async () => {
  const db = fixture([
    {
      chore_id: "task-a",
      event_title: "School trip",
      features: defaultFeatures(),
      event_id: "not-projected",
      private: "not-projected",
    },
  ]);
  const { readOwnPreparationContext } = await import("../discovery");
  expect(
    await readOwnPreparationContext(db, { ...input, role: "child" }),
  ).toEqual({ "task-a": { eventTitle: "School trip" } });
  const [sql, ...values] = db.$queryRaw.mock.calls[0];
  expect(sql.join("")).toContain('c."assigned_to"=u."id"');
  expect(sql.join("")).toContain('c."assigned_member_id" IS NULL');
  expect(values).toContain(input.userId);
  expect(values).toContain("child");
});
it("does not treat parent or paired-device context as a child account", async () => {
  const db = fixture();
  const { readOwnPreparationContext } = await import("../discovery");
  expect(await readOwnPreparationContext(db, input)).toEqual({});
  expect(
    await readOwnPreparationContext(db, { ...input, role: "device" }),
  ).toEqual({});
  expect(db.$queryRaw).not.toHaveBeenCalled();
});
