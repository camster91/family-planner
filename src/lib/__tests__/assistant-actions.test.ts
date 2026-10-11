import {
  assistantReplySchema,
  canUseAssistantAction,
  assistantDestination,
} from "../assistant-actions";
import { defaultFeatures } from "../features";
import { assistantEnglish, assistantSpanish } from "@/i18n/assistant";
it("rejects arbitrary URLs, code tools and record ids from AI", () => {
  expect(
    assistantReplySchema.safeParse({
      reply: "Done",
      action: { kind: "open", destination: "https://evil.test" },
    }).success,
  ).toBe(false);
  expect(
    assistantReplySchema.safeParse({
      reply: "Done",
      action: { kind: "list_delete", title: "Food", id: "foreign" },
    }).success,
  ).toBe(false);
  expect(
    assistantReplySchema.safeParse({
      reply: "Done",
      action: { kind: "execute", code: "fetch(...)" },
    }).success,
  ).toBe(false);
});
it("parent/teen create while deletion remains parent-only, and children cannot spend provider budget", () => {
  const f = defaultFeatures(),
    a = { kind: "list_delete", title: "Food" } as const;
  expect(canUseAssistantAction(a, "parent", f)).toBe(true);
  expect(canUseAssistantAction(a, "teen", f)).toBe(false);
  expect(
    canUseAssistantAction(
      { kind: "event_create", title: "Test", start: "a", end: "b" },
      "teen",
      f,
    ),
  ).toBe(true);
  expect(
    canUseAssistantAction({ kind: "grocery_add", title: "Milk" }, "child", f),
  ).toBe(false);
});
it("gates disabled domains and parent destinations", () => {
  const f = defaultFeatures();
  expect(
    canUseAssistantAction(
      { kind: "note_create", title: "Test", body: "Hi" },
      "parent",
      f,
    ),
  ).toBe(false);
  expect(
    canUseAssistantAction({ kind: "open", destination: "features" }, "teen", f),
  ).toBe(false);
  expect(assistantDestination("recipes")).toBe("/dashboard/meals/explore");
});
it("parses and localizes analytics navigation while enforcing role and dependency gates", () => {
  const allOn = {
    ...defaultFeatures(),
    gamification: true,
    analytics: true,
  };
  const action = { kind: "open", destination: "analytics" } as const;

  expect(
    assistantReplySchema.safeParse({ reply: "Open it", action }).success,
  ).toBe(true);
  expect(assistantDestination("analytics")).toBe("/dashboard/analytics");
  expect(canUseAssistantAction(action, "parent", allOn)).toBe(true);
  expect(canUseAssistantAction(action, "teen", allOn)).toBe(false);
  expect(canUseAssistantAction(action, "child", allOn)).toBe(false);
  expect(
    canUseAssistantAction(action, "parent", { ...allOn, gamification: false }),
  ).toBe(false);
  expect(
    canUseAssistantAction(action, "parent", { ...allOn, analytics: false }),
  ).toBe(false);
  expect(assistantEnglish.analytics).toBe("Analytics");
  expect(assistantSpanish.analytics).toBe("Análisis");
  expect(
    assistantReplySchema.safeParse({
      reply: "Open it",
      action: { kind: "open", destination: "Analytics" },
    }).success,
  ).toBe(false);
});
