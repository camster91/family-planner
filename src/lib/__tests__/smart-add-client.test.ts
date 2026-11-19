// Smart Add browser helpers (#144): the offline comma split, canonical save
// and undo requests, and row readiness. No network.
import {
  createdIdOf,
  fallbackGroceryRows,
  rowProblem,
  savePlanFor,
  sendKeyed,
  splitGroceryText,
  undoPlanFor,
  type SmartRow,
} from "../smart-add-client";

describe("splitGroceryText (offline / AI-off fallback)", () => {
  it("splits commas, semicolons, new lines and a final 'and', with leading quantities", () => {
    expect(
      splitGroceryText("milk, 2 eggs; bread\n3x apples and  cheese ,,"),
    ).toEqual([
      { title: "milk", quantity: 1 },
      { title: "eggs", quantity: 2 },
      { title: "bread", quantity: 1 },
      { title: "apples", quantity: 3 },
      { title: "cheese", quantity: 1 },
    ]);
  });

  it("caps the number of items and becomes grocery draft rows", () => {
    expect(
      splitGroceryText(Array.from({ length: 30 }, (_, i) => `x${i}`).join(",")),
    ).toHaveLength(20);
    expect(fallbackGroceryRows("milk, eggs")).toEqual([
      { id: "g0", kind: "grocery", title: "milk", quantity: 1, list: null },
      { id: "g1", kind: "grocery", title: "eggs", quantity: 1, list: null },
    ]);
  });
});

const event: SmartRow = {
  id: "r0",
  kind: "event",
  title: " Dentist ",
  date: "2026-11-24",
  startTime: "15:30",
  endTime: "16:30",
  people: [{ kind: "account", id: "child-a", name: "Casey" }],
  checkPeople: false,
};

describe("savePlanFor", () => {
  it("uses the existing canonical create routes", () => {
    const plan = savePlanFor(event, {
      peopleOnEvents: true,
      today: "2026-11-19",
    });
    expect(plan.url).toBe("/api/events");
    expect(plan.body).toMatchObject({
      title: "Dentist",
      event_type: "other",
      participants: [{ kind: "account", id: "child-a" }],
    });
    expect(typeof (plan.body as { start_time: string }).start_time).toBe(
      "string",
    );
    expect(
      savePlanFor(event, { peopleOnEvents: false, today: "2026-11-19" }).body,
    ).not.toHaveProperty("participants");
    expect(
      savePlanFor(
        { id: "r1", kind: "grocery", title: "milk", quantity: 2, list: null },
        { peopleOnEvents: false, today: "x" },
      ),
    ).toEqual({
      url: "/api/capture/grocery",
      method: "POST",
      body: { content: "milk", quantity: 2 },
    });
    expect(
      savePlanFor(
        {
          id: "r1",
          kind: "grocery",
          title: "cake",
          quantity: 1,
          list: { id: "l1", name: "Party" },
        },
        { peopleOnEvents: false, today: "x" },
      ),
    ).toEqual({
      url: "/api/lists/items/create",
      method: "POST",
      body: { listId: "l1", content: "cake", quantity: 1 },
    });
    expect(
      savePlanFor(
        {
          id: "r2",
          kind: "chore",
          title: "Trash",
          dueDate: null,
          assignee: { kind: "account", id: "u1", name: "R" },
          checkPeople: false,
        },
        { peopleOnEvents: false, today: "2026-11-19" },
      ),
    ).toEqual({
      url: "/api/chores/create",
      method: "POST",
      body: {
        title: "Trash",
        assigned_to: "u1",
        due_date: "2026-11-19",
        frequency: "once",
      },
    });
    const meal = savePlanFor(
      {
        id: "r3",
        kind: "meal",
        title: "Tacos",
        date: "2026-11-20",
        slot: "dinner",
      },
      {
        peopleOnEvents: false,
        today: "x",
        meal: { userId: "u1", familyId: "f1" },
      },
    );
    expect(meal.url).toBe("/api/meals/create");
    expect(meal.body).toMatchObject({
      protocol: "herewoven.meal-create.v1",
      expected_user_id: "u1",
      expected_family_id: "f1",
      date: "2026-11-20",
      meal_type: "dinner",
      recipe_name: "Tacos",
    });
  });
});

describe("rowProblem", () => {
  it("holds rows that are not ready or not allowed", () => {
    expect(rowProblem(event, "teen")).toBeNull();
    expect(rowProblem({ ...event, startTime: null }, "parent")).toBe(
      "needsTime",
    );
    const chore: SmartRow = {
      id: "r",
      kind: "chore",
      title: "T",
      dueDate: null,
      assignee: null,
      checkPeople: false,
    };
    expect(rowProblem(chore, "teen")).toBe("parentsOnlyChores");
    expect(rowProblem(chore, "parent")).toBe("needsAssignee");
  });
});

describe("created ids, undo and keyed sends", () => {
  it("reads ids from each canonical reply shape", () => {
    expect(createdIdOf({ event: { id: "e1" } })).toBe("e1");
    expect(createdIdOf({ item: { id: "i1" } })).toBe("i1");
    expect(createdIdOf({ mealId: "m1" })).toBe("m1");
    expect(createdIdOf({ id: "c1" })).toBe("c1");
    expect(createdIdOf(null)).toBeNull();
  });

  it("undoes through the ordinary delete routes", () => {
    expect(undoPlanFor({ kind: "event", id: "e1" })).toEqual({
      url: "/api/events",
      method: "DELETE",
      body: { eventId: "e1" },
    });
    expect(undoPlanFor({ kind: "chore", id: "c1" }).body).toEqual({
      choreId: "c1",
    });
    expect(undoPlanFor({ kind: "grocery", id: "i/1" }).url).toBe(
      "/api/lists/items/i%2F1",
    );
    expect(
      undoPlanFor(
        { kind: "meal", id: "m1" },
        { userId: "u", familyId: "f", generation: 2 },
      ).url,
    ).toBe(
      "/api/meals/m1?id=m1&expected_user_id=u&expected_family_id=f&expected_generation=2",
    );
  });

  it("sends the same idempotency key it is given", async () => {
    const fetchMock = jest.fn(
      async (_url: string, _init?: RequestInit) =>
        new Response(JSON.stringify({ event: { id: "e1" } }), { status: 200 }),
    );
    const result = await sendKeyed(
      { url: "/api/events", method: "POST", body: { a: 1 } },
      "key-1234567890abcdef",
      fetchMock,
    );
    expect(result).toEqual({
      ok: true,
      status: 200,
      body: { event: { id: "e1" } },
    });
    expect(
      (fetchMock.mock.calls[0][1]?.headers as Record<string, string>)[
        "Idempotency-Key"
      ],
    ).toBe("key-1234567890abcdef");
  });
});
