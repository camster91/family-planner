import {
  buildDayPlans,
  formatMinutes,
  mealTitle,
  recipeMeta,
  type PlannedMeal,
} from "@/lib/meal-slots";

// Local-noon anchor so the local calendar day is unambiguous in any TZ.
const FROM = new Date(2026, 0, 5, 12, 0, 0);

const meal = (over: Partial<PlannedMeal>): PlannedMeal => ({
  id: "m",
  meal_type: "dinner",
  recipe_name: "Soup",
  date: "2026-01-05T00:00:00.000Z",
  ...over,
});

describe("buildDayPlans (gap 2.4.1: every meal per slot)", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(FROM);
  });
  afterEach(() => jest.useRealTimers());

  it("marks the actual viewer today, not the first day of a browsed week", () => {
    expect(
      buildDayPlans([], new Date(2026, 0, 12, 12)).some((d) => d.isToday),
    ).toBe(false);
    const week = buildDayPlans([], new Date(2026, 0, 3, 12));
    expect(week.filter((d) => d.isToday).map((d) => d.dateKey)).toEqual([
      "2026-01-05",
    ]);
  });
  it("keeps two meals in the same (day, meal type) slot, in API order", () => {
    const week = buildDayPlans(
      [
        meal({ id: "a", recipe_name: "Tacos" }),
        meal({ id: "b", recipe_name: "Salad" }),
      ],
      FROM,
    );
    const dinner = week[0].slots.find((s) => s.type === "dinner")!;
    expect(dinner.meals.map((m) => m.id)).toEqual(["a", "b"]);
  });

  it("builds seven days of four slots, today first", () => {
    const week = buildDayPlans([], FROM);
    expect(week).toHaveLength(7);
    expect(week[0].isToday).toBe(true);
    expect(week[0].label).toBe("Today");
    expect(week[0].dateKey).toBe("2026-01-05");
    expect(week[0].longLabel).toBe("Monday, January 5");
    expect(week[6].dateKey).toBe("2026-01-11");
    for (const day of week)
      expect(day.slots.map((s) => s.type)).toEqual([
        "breakfast",
        "lunch",
        "dinner",
        "snack",
      ]);
  });

  it("places meals by the UTC date-only prefix and ignores unknown meal types", () => {
    const week = buildDayPlans(
      [
        meal({
          id: "tomorrow",
          date: "2026-01-06T00:00:00.000Z",
          meal_type: "lunch",
        }),
        meal({ id: "odd", meal_type: "brunch" as never }),
        meal({ id: "outside", date: "2026-02-01T00:00:00.000Z" }),
      ],
      FROM,
    );
    expect(
      week[1].slots.find((s) => s.type === "lunch")!.meals.map((m) => m.id),
    ).toEqual(["tomorrow"]);
    const all = week.flatMap((d) =>
      d.slots.flatMap((s) => s.meals.map((m) => m.id)),
    );
    expect(all).toEqual(["tomorrow"]);
  });
});

describe("meal display helpers", () => {
  it("titles a meal by its name, else its recipe title", () => {
    expect(mealTitle({ recipe_name: " Pizza night ", recipe: null })).toBe(
      "Pizza night",
    );
    expect(
      mealTitle({
        recipe_name: "",
        recipe: {
          id: "r",
          title: "Lasagna",
          prep_time: null,
          cook_time: null,
          servings: null,
        },
      }),
    ).toBe("Lasagna");
    expect(mealTitle({ recipe_name: null, recipe: null })).toBe(
      "Untitled meal",
    );
  });

  it("formats minutes", () => {
    expect(formatMinutes(25)).toBe("25 min");
    expect(formatMinutes(60)).toBe("1 h");
    expect(formatMinutes(90)).toBe("1 h 30 min");
    expect(formatMinutes(0)).toBe("0 min");
    expect(formatMinutes(null)).toBeNull();
    expect(formatMinutes(-5)).toBeNull();
  });

  it("describes a linked recipe with its prep time; nothing for free text", () => {
    expect(recipeMeta(null)).toBeNull();
    expect(
      recipeMeta({
        id: "r",
        title: "T",
        prep_time: 25,
        cook_time: 10,
        servings: 4,
      }),
    ).toBe("Recipe · 25 min prep");
    expect(
      recipeMeta({
        id: "r",
        title: "T",
        prep_time: null,
        cook_time: null,
        servings: 4,
      }),
    ).toBe("Recipe");
  });
});
