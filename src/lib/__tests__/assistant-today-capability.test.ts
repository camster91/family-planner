import { isAssistantTodayEnabled } from "../assistant-today-capability";

it("enables Today context only for the exact server value 1", () => {
  expect(isAssistantTodayEnabled({})).toBe(false);
  expect(isAssistantTodayEnabled({ ASSISTANT_TODAY_ENABLED: "true" })).toBe(
    false,
  );
  expect(isAssistantTodayEnabled({ ASSISTANT_TODAY_ENABLED: "01" })).toBe(
    false,
  );
  expect(isAssistantTodayEnabled({ ASSISTANT_TODAY_ENABLED: "1" })).toBe(true);
});
