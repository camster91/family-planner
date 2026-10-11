import { assistantTodayContextSchema } from "../assistant-context-schema";

const context = {
  protocol: "herewoven.assistant-today.v1",
  generatedAt: "2026-10-09T12:00:00.000Z",
  expiresAt: "2026-10-09T12:01:00.000Z",
  viewer: {
    role: "parent",
    localDate: "2026-10-09",
    timeZone: "America/Toronto",
  },
  today: {
    events: [],
    chores: [],
    dinner: null,
    groceries: [],
    useSoon: [],
    weather: null,
    unavailable: ["weather"],
  },
};

it("accepts only the bounded Today projection", () => {
  expect(assistantTodayContextSchema.safeParse(context).success).toBe(true);
  expect(
    assistantTodayContextSchema.safeParse({
      ...context,
      secretRecordId: "record-1",
    }).success,
  ).toBe(false);
});

it("rejects an expired or overlarge projection", () => {
  expect(
    assistantTodayContextSchema.safeParse({
      ...context,
      expiresAt: context.generatedAt,
    }).success,
  ).toBe(false);
  expect(
    assistantTodayContextSchema.safeParse({
      ...context,
      today: {
        ...context.today,
        events: Array.from({ length: 21 }, () => ({
          title: "event",
          localStart: "09:00",
          localEnd: "10:00",
          isTask: false,
          source: null,
        })),
      },
    }).success,
  ).toBe(false);
});
