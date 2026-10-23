import {
  loadAssistantTodayRows,
  type AssistantTodayLoaderDb,
} from "@/lib/assistant-today-loader";

const NOW = new Date("2026-10-11T15:30:00.000Z");
const FEATURES = {
  calendar: true,
  chores: true,
  lists: true,
  meals: true,
  inventory: true,
};

function dbFor(): AssistantTodayLoaderDb {
  return {
    user: {
      findMany: jest.fn().mockResolvedValue([
        { id: "parent-id", name: "Parent" },
        { id: "sibling-id", name: "Sibling" },
      ]),
    },
    event: {
      findMany: jest.fn().mockResolvedValue([
        {
          title: `<instruction>${"é".repeat(400)}</instruction>`,
          start_time: new Date("2026-10-11T14:00:00.000Z"),
          end_time: new Date("2026-10-11T16:00:00.000Z"),
          is_task: false,
          source_subscription: { id: "subscription-id" },
          source_connection: null,
        },
      ]),
    },
    chore: {
      findMany: jest.fn().mockResolvedValue([
        {
          title: "Sibling private chore",
          due_date: new Date("2026-10-11T00:00:00.000Z"),
          status: "pending",
          assigned_to: "sibling-id",
        },
        {
          title: "Own chore",
          due_date: new Date("2026-10-11T00:00:00.000Z"),
          status: "completed",
          assigned_to: "teen-id",
        },
      ]),
    },
    familyMeal: {
      findMany: jest.fn().mockResolvedValue([]),
    },
    listItem: {
      findMany: jest.fn().mockResolvedValue([
        {
          content: "Milk",
          quantity: 1,
          list: { name: "Groceries" },
        },
      ]),
    },
    inventoryItem: {
      findMany: jest.fn().mockResolvedValue([]),
    },
  } as unknown as AssistantTodayLoaderDb;
}

describe("loadAssistantTodayRows", () => {
  it("handles profile-only chores without assigning them to an account viewer", async () => {
    const db = dbFor();
    (db.chore.findMany as jest.Mock).mockResolvedValue([
      {
        title: "Profile chore",
        due_date: new Date("2026-10-11T00:00:00.000Z"),
        status: "pending",
        assigned_to: null,
      },
    ]);
    const input = {
      familyId: "family-a",
      userId: "parent-id",
      features: FEATURES,
      serverNow: NOW,
      viewerTimeZone: "America/Toronto",
    };
    const parent = await loadAssistantTodayRows(db, {
      ...input,
      role: "parent",
    });
    expect(parent.chores).toHaveLength(1);
    expect(parent.chores[0].assignee).toBe("A household member");
    const teen = await loadAssistantTodayRows(db, {
      ...input,
      userId: "teen-id",
      role: "teen",
    });
    expect(teen.chores).toEqual([]);
  });

  it("uses family-scoped allowlisted selects and projects no ids or private text", async () => {
    const db = dbFor();
    const loaded = await loadAssistantTodayRows(db, {
      familyId: "family-a",
      userId: "parent-id",
      role: "parent",
      features: FEATURES,
      serverNow: NOW,
      viewerTimeZone: "America/Toronto",
    });

    expect(loaded.events[0]).toMatchObject({ source: "Subscribed calendar" });
    expect(
      Buffer.byteLength(loaded.events[0].title, "utf8"),
    ).toBeLessThanOrEqual(512);
    expect(loaded.chores.map((chore) => chore.assignee)).toEqual([
      "Sibling",
      "A household member",
    ]);
    expect(JSON.stringify(loaded)).not.toContain("sibling-id");
    expect(JSON.stringify(loaded)).not.toContain("secret calendar URL");

    const namesQuery = (db.user.findMany as jest.Mock).mock.calls[0][0];
    const eventQuery = (db.event.findMany as jest.Mock).mock.calls[0][0];
    const choreQuery = (db.chore.findMany as jest.Mock).mock.calls[0][0];
    const dinnerQuery = (db.familyMeal.findMany as jest.Mock).mock.calls[0][0];
    const groceryQuery = (db.listItem.findMany as jest.Mock).mock.calls[0][0];
    const inventoryQuery = (db.inventoryItem.findMany as jest.Mock).mock
      .calls[0][0];
    const eventSelect = eventQuery.select;
    const choreSelect = choreQuery.select;
    const dinnerSelect = dinnerQuery.select;
    const grocerySelect = groceryQuery.select;
    const inventorySelect = inventoryQuery.select;
    expect(eventQuery.where).toEqual(
      expect.objectContaining({ family_id: "family-a" }),
    );
    expect(choreQuery.where).toEqual(
      expect.objectContaining({ family_id: "family-a" }),
    );
    expect(groceryQuery.where).toEqual(
      expect.objectContaining({
        list: { family_id: "family-a", type: "grocery" },
      }),
    );
    expect(namesQuery.select).toEqual({ id: true, name: true });
    expect(eventSelect).not.toHaveProperty("id");
    expect(choreSelect).not.toHaveProperty("id");
    expect(dinnerSelect).not.toHaveProperty("id");
    expect(grocerySelect).not.toHaveProperty("id");
    expect(inventorySelect).not.toHaveProperty("id");
    expect(eventQuery.orderBy).toEqual([{ start_time: "asc" }, { id: "asc" }]);
    expect(choreQuery.orderBy).toEqual([
      { due_date: "asc" },
      { created_at: "asc" },
      { id: "asc" },
    ]);
    expect(dinnerQuery.orderBy).toEqual([
      { date: "asc" },
      { created_at: "asc" },
      { id: "asc" },
    ]);
    expect(groceryQuery.orderBy).toEqual([
      { created_at: "asc" },
      { id: "asc" },
    ]);
    expect(inventoryQuery.orderBy).toEqual([
      { expires_on: "asc" },
      { date_kind: "desc" },
      { name: "asc" },
      { id: "asc" },
    ]);
    expect(eventSelect).not.toEqual(
      expect.objectContaining({
        description: true,
        location: true,
        created_by: true,
      }),
    );
    expect(choreSelect).not.toEqual(
      expect.objectContaining({
        description: true,
        points: true,
        notes: true,
      }),
    );
    expect(grocerySelect).not.toEqual(
      expect.objectContaining({
        notes: true,
        price: true,
      }),
    );
    expect(eventSelect.source_subscription).toEqual({ select: { id: true } });
    expect(eventSelect.source_connection).toEqual({ select: { id: true } });
    expect(dinnerSelect.cook).toEqual({
      select: { id: true, name: true, family_id: true },
    });
  });

  it("applies the authenticated teen predicate and filters any mismatched fixture row", async () => {
    const db = dbFor();
    const loaded = await loadAssistantTodayRows(db, {
      familyId: "family-a",
      userId: "teen-id",
      role: "teen",
      features: FEATURES,
      serverNow: NOW,
      viewerTimeZone: "America/Toronto",
    });

    expect(db.user.findMany).not.toHaveBeenCalled();
    expect(db.chore.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          family_id: "family-a",
          assigned_to: "teen-id",
        }),
      }),
    );
    expect(loaded.chores).toEqual([
      {
        title: "Own chore",
        dueDay: "2026-10-11",
        status: "done",
        assignee: "You",
      },
    ]);
  });

  it("keeps a local-time boundary correct without widening the household query", async () => {
    const db = dbFor();
    (db.event.findMany as jest.Mock).mockResolvedValue([
      {
        title: "Late local event",
        start_time: new Date("2026-10-12T00:15:00.000Z"),
        end_time: new Date("2026-10-12T01:00:00.000Z"),
        is_task: true,
        source_subscription: null,
        source_connection: null,
      },
      {
        title: "Next local day",
        start_time: new Date("2026-10-12T04:30:00.000Z"),
        end_time: new Date("2026-10-12T05:00:00.000Z"),
        is_task: false,
        source_subscription: null,
        source_connection: null,
      },
    ]);
    const loaded = await loadAssistantTodayRows(db, {
      familyId: "family-a",
      userId: "parent-id",
      role: "parent",
      features: FEATURES,
      serverNow: new Date("2026-10-12T00:30:00.000Z"),
      viewerTimeZone: "America/Toronto",
    });

    expect(loaded.events.map((event) => event.title)).toEqual([
      "Late local event",
    ]);
    expect(db.event.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ family_id: "family-a" }),
      }),
    );
  });

  it("does not query disabled sections", async () => {
    const db = dbFor();
    await loadAssistantTodayRows(db, {
      familyId: "family-a",
      userId: "parent-id",
      role: "parent",
      features: {
        calendar: false,
        chores: false,
        lists: false,
        meals: false,
        inventory: false,
      },
      serverNow: NOW,
      viewerTimeZone: "America/Toronto",
    });

    expect(db.user.findMany).not.toHaveBeenCalled();
    expect(db.event.findMany).not.toHaveBeenCalled();
    expect(db.chore.findMany).not.toHaveBeenCalled();
    expect(db.familyMeal.findMany).not.toHaveBeenCalled();
    expect(db.listItem.findMany).not.toHaveBeenCalled();
    expect(db.inventoryItem.findMany).not.toHaveBeenCalled();
  });
});

/** Authored/unrun: optional raw identity stays in a server-only sidecar. */
it("collects source identity/version for the exact projected event without changing provider context", async () => {
  const db = dbFor();
  (db.event.findMany as jest.Mock).mockResolvedValue([
    {
      id: "event-canonical-a",
      created_at: NOW,
      updated_at: NOW,
      schedule_generation: "fixture-generation",
      schedule_epoch: 2,
      title: "School trip",
      start_time: new Date("2026-10-11T14:00:00.000Z"),
      end_time: new Date("2026-10-11T16:00:00.000Z"),
      is_task: false,
      source_subscription: null,
      source_connection: null,
    },
  ]);
  const onSources = jest.fn();
  const context = await loadAssistantTodayRows(db, {
    familyId: "family-a",
    userId: "parent-id",
    role: "parent",
    features: {
      calendar: true,
      chores: false,
      lists: false,
      meals: false,
      inventory: false,
    },
    serverNow: NOW,
    viewerTimeZone: "America/Toronto",
    onSources,
  });
  expect(onSources).toHaveBeenCalledWith([
    expect.objectContaining({
      kind: "event",
      id: "event-canonical-a",
      index: 0,
      label: "School trip",
      versionInput: expect.objectContaining({
        row: expect.objectContaining({ schedule_epoch: 2 }),
      }),
    }),
  ]);
  expect(JSON.stringify(context)).not.toMatch(
    /event-canonical-a|fixture-generation|schedule_epoch|updated_at/,
  );
});
