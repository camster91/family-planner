import {
  assistantReplySchema,
  canUseAssistantAction,
  assistantDestination,
} from "../assistant-actions";
import { defaultFeatures } from "../features";
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
